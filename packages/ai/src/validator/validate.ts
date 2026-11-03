import sanitizeHtml from 'sanitize-html';
import { sanitizeMarkdown } from './sanitize-markdown';
import { LessonOutput } from '../schemas/output';
import type { LessonOutputT } from '../schemas/output';
import { estimateTokens } from '../chunker';

export interface ValidateLessonContext {
  /** Danh sách id chunk hợp lệ thuộc tài liệu đang xử lý. */
  availableChunkIds: string[];
  /** Map id chunk → nội dung, dùng cho kiểm tra bám nguồn. */
  chunkContentById: Map<string, string>;
  /** Tiêu đề lesson đã tồn tại trong Course (chống trùng). */
  existingLessonTitles: string[];
  existChunks?: 'all' | (string | null)[];
}

export type LessonValidationResult =
  | { ok: true; lesson: LessonOutputT; confidence: 'HIGH' | 'LOW'; confidenceReason?: string }
  | { ok: false; errors: string[] };

const FORBIDDEN_OPTIONS = [
  'tất cả đáp án',
  'tất cả các đáp án',
  'all of the above',
  'tất cả phương án',
];
const normalize = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim();

const VIETNAMESE_TOKEN_PATTERN = /\p{L}{6,}/gu;

/** Tầng 2 — luật nghiệp vụ. Trả về danh sách lỗi (rỗng = hợp lệ). */
export function businessRuleViolations(lesson: LessonOutputT): string[] {
  const errors: string[] = [];
  for (const ex of lesson.exercises) {
    for (const q of ex.questions) {
      const promptNorm = normalize(q.prompt);
      if (q.type === 'MULTIPLE_CHOICE') {
        const correct = q.options.filter((o) => o.isCorrect);
        if (correct.length !== 1) {
          errors.push(
            `Câu "${q.prompt.slice(0, 40)}..." phải có đúng một đáp án đúng (có ${correct.length}).`,
          );
        }
        const contents = q.options.map((o) => normalize(o.content));
        if (new Set(contents).size !== contents.length) {
          errors.push(`Câu "${q.prompt.slice(0, 40)}..." có hai lựa chọn trùng nội dung.`);
        }
        for (const o of q.options) {
          if (FORBIDDEN_OPTIONS.some((f) => normalize(o.content).includes(f))) {
            errors.push(`Câu "${q.prompt.slice(0, 40)}..." có lựa chọn kiểu "Tất cả đáp án trên".`);
          }
        }
        const correctLength = Math.max(...correct.map((o) => o.content.length));
        const avgWrongLength =
          q.options.filter((o) => !o.isCorrect).reduce((a, o) => a + o.content.length, 0) /
          Math.max(q.options.filter((o) => !o.isCorrect).length, 1);
        if (avgWrongLength > 0 && correctLength > avgWrongLength * 2) {
          errors.push(
            `Câu "${q.prompt.slice(0, 40)}..." đáp án đúng dài gấp đôi các lựa chọn khác.`,
          );
        }
      }
      if (q.explanation && normalize(q.explanation).includes(promptNorm)) {
        errors.push(`Câu "${q.prompt.slice(0, 40)}..." giải thích lặp nguyên văn câu hỏi.`);
      }
    }
  }
  if (lesson.contentMd.length < 200) errors.push('Nội dung lesson quá ngắn (< 200 ký tự).');
  if (/(<script|javascript:|onclick=)/i.test(lesson.contentMd)) {
    errors.push('Nội dung chứa HTML/script không hợp lệ.');
  }
  return errors;
}

/** Tầng 3 — kiểm tra bám nguồn. Lấy mẫu 2 thuật ngữ dài nhất, đối chiếu với chunk đã khai. */
export function confidenceScore(lesson: LessonOutputT, chunks: Map<string, string>): number {
  const declared = lesson.sourceChunkIds.filter((id) => chunks.has(id));
  if (declared.length === 0) return 0;
  const text = lesson.contentMd.toLowerCase();
  const terms = Array.from(text.matchAll(VIETNAMESE_TOKEN_PATTERN))
    .map((m) => m[0])
    .filter((t) => t.length >= 6 && !COMMON_WORDS.has(t))
    .sort((a, b) => b.length - a.length)
    .slice(0, 2);
  if (terms.length === 0) return 1;
  let matched = 0;
  for (const term of terms) {
    const hit = declared.some((id) => (chunks.get(id) ?? '').toLowerCase().includes(term));
    if (hit) matched += 1;
  }
  return matched / terms.length;
}

const COMMON_WORDS = new Set([
  'learning',
  'learn',
  'câu hỏi',
  'ghi chú',
  'vấn đề',
  'phương',
  'nhiệm vụ',
  'thông tin',
]);

/**
 * Tầng 4 — vệ sinh dữ liệu: bỏ thẻ HTML/JS, chuẩn hoá khoảng trắng, giới hạn độ dài.
 */
export function sanitizeLessonOutput(raw: LessonOutputT): LessonOutputT {
  const clean = (s: string, max: number): string =>
    sanitizeHtml(s, { allowedTags: [], allowedAttributes: {} })
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim()
      .slice(0, max);

  return {
    ...raw,
    title: clean(raw.title, 200),
    summary: clean(raw.summary, 500),
    // Markdown đi qua bộ vệ sinh riêng: `sanitize-html` escape `<`/`>`/`&` và xoá `<T>` như thẻ,
    // làm hỏng code trong bài (xem sanitize-markdown.ts).
    contentMd: sanitizeMarkdown(raw.contentMd).slice(0, 12000),
    exercises: raw.exercises.map((ex) => ({
      ...ex,
      title: clean(ex.title ?? '', 200),
      instruction: clean(ex.instruction ?? '', 500),
      questions: ex.questions.map((q) => {
        const base = {
          ...q,
          prompt: clean(q.prompt, 5000),
          explanation: clean(q.explanation, 5000),
        };
        if (base.type === 'MULTIPLE_CHOICE') {
          return {
            ...base,
            options: base.options.map((o) => ({ ...o, content: clean(o.content, 2000) })),
          };
        }
        return base;
      }),
    })),
  };
}

/**
 * Validation 4 tầng — HANDBOOK §8.4. Chạy tuần tự: schema → luật nghiệp vụ → bám nguồn → vệ sinh.
 */
export function validateLessonOutput(
  raw: unknown,
  ctx: ValidateLessonContext,
): LessonValidationResult {
  const parsed = LessonOutput.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    };
  }
  const ruleErrors = businessRuleViolations(parsed.data);
  if (ruleErrors.length > 0) return { ok: false, errors: ruleErrors };

  const invalidChunks = parsed.data.sourceChunkIds.filter(
    (id) => !ctx.availableChunkIds.includes(id),
  );
  if (invalidChunks.length > 0) {
    return {
      ok: false,
      errors: [`sourceChunkIds chứa id không tồn tại: ${invalidChunks.join(', ')}`],
    };
  }
  if (ctx.existingLessonTitles.includes(parsed.data.title.trim().toLowerCase())) {
    return { ok: false, errors: [`Tiêu đề lesson trùng bài đã có: "${parsed.data.title}"`] };
  }

  const cleaned = sanitizeLessonOutput(parsed.data);
  if (estimateTokens(cleaned.contentMd) < 50) {
    return { ok: false, errors: ['Nội dung sau khi làm sạch quá ngắn.'] };
  }

  const score = confidenceScore(cleaned, ctx.chunkContentById);
  return {
    ok: true,
    lesson: cleaned,
    confidence: score >= 0.5 ? 'HIGH' : 'LOW',
    confidenceReason:
      score < 0.5 ? 'Nội dung có thể lệch khỏi tài liệu gốc — hãy kiểm tra lại.' : undefined,
  };
}
