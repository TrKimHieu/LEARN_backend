import { z } from 'zod';
import { LessonOutput } from '../schemas/output';

/**
 * lesson@4: đưa luật độ dài đáp án vào prompt và dùng mã chunk ngắn C1..Cn. Đo ở model thật: khoảng
 * 23% bài bị loại vì hai lỗi này (luật chỉ có ở validator, model chép sai UUID).
 * lesson@3: nhận độ khó người dùng chọn khi sinh bài (trước đây `params.difficulty` bị bỏ qua).
 * lesson@2: nhúng JSON Schema đầy đủ — lesson@1 chỉ nêu tên trường, model thật bịa giá trị enum.
 */
export const LESSON_PROMPT_VERSION = 'lesson@4';

export type LessonDifficulty = 'EASY' | 'MEDIUM' | 'HARD';

const DIFFICULTY_GUIDE: Record<LessonDifficulty, string> = {
  EASY: 'Dễ: câu hỏi nhận biết, nhắc lại định nghĩa và ý chính nêu thẳng trong tài liệu.',
  MEDIUM: 'Vừa: câu hỏi hiểu và vận dụng, so sánh các khái niệm, giải thích vì sao.',
  HARD: 'Khó: câu hỏi phân tích tình huống, kết hợp nhiều ý trong tài liệu, phân biệt trường hợp dễ nhầm.',
};

/**
 * Sinh từ chính Zod schema dùng ở tầng 1, nên prompt không thể lệch khỏi luật kiểm tra: thêm loại
 * câu hỏi hay đổi enum ở `schemas/output.ts` là prompt tự cập nhật theo.
 */
const LESSON_JSON_SCHEMA = JSON.stringify(z.toJSONSchema(LessonOutput));

export interface LessonContext {
  language: 'vi' | 'en';
  courseTitle: string;
  nodeTitle: string;
  nodeDescription: string;
  chunks: Array<{ id: string; content: string }>;
  /** Độ khó người dùng chọn; bỏ trống = MEDIUM. */
  difficulty?: LessonDifficulty;
  previousError?: string;
}

const chunkCode = (index: number): string => `C${index + 1}`;

/**
 * Đổi mã C1..Cn trong output về id thật. Mã lạ giữ nguyên để validator loại, không gán sang chunk
 * khác: gán sai làm bài học trích dẫn sai nguồn.
 */
export function restoreChunkIds(raw: unknown, chunks: Array<{ id: string }>): unknown {
  if (raw === null || typeof raw !== 'object') return raw;
  const byCode = new Map(chunks.map((c, i) => [chunkCode(i), c.id]));
  const restore = (value: unknown): unknown =>
    typeof value === 'string' ? (byCode.get(value.trim().toUpperCase()) ?? value) : value;

  const lesson = raw as { sourceChunkIds?: unknown; exercises?: unknown };
  return {
    ...lesson,
    ...(Array.isArray(lesson.sourceChunkIds)
      ? { sourceChunkIds: lesson.sourceChunkIds.map(restore) }
      : {}),
    ...(Array.isArray(lesson.exercises)
      ? {
          exercises: lesson.exercises.map((exercise: unknown) => {
            const ex = exercise as { questions?: unknown } | null;
            if (!ex || !Array.isArray(ex.questions)) return exercise;
            return {
              ...ex,
              questions: ex.questions.map((question: unknown) => {
                const q = question as { sourceChunkId?: unknown } | null;
                return q && typeof q === 'object' && 'sourceChunkId' in q
                  ? { ...q, sourceChunkId: restore(q.sourceChunkId) }
                  : question;
              }),
            };
          }),
        }
      : {}),
  };
}

export function lessonPrompt(ctx: LessonContext): string {
  const lines = [
    `Bạn là nhà giáo khoa học chuyên soạn bài học tương tác cho LEARN.`,
    `Khóa học: "${ctx.courseTitle}".`,
    `Bài học cần soạn: "${ctx.nodeTitle}" — ${ctx.nodeDescription}`,
    ``,
    `LUẬT BẮT BUỘC:`,
    `- CHỈ dùng toàn văn các chunk được cung cấp bên dưới. KHÔNG thêm kiến thức ngoài tài liệu.`,
    `- Ngôn ngữ: ${ctx.language === 'vi' ? 'tiếng Việt' : 'tiếng Anh'}.`,
    `- contentMd là Markdown hợp lệ, tối thiểu 200 ký tự.`,
    `- sourceChunkIds và sourceChunkId dùng đúng mã chunk đã cho (C1, C2, ...), đừng bịa mã khác.`,
    `- Bài tập: 1–5 exercise, mỗi exercise 1–10 câu hỏi.`,
    `- MULTIPLE_CHOICE phải đúng 4 options, đúng một đáp án đúng, không có "Tất cả đáp án trên".`,
    `- Đáp án đúng KHÔNG DÀI QUÁ 2 LẦN độ dài trung bình của ba đáp án sai; viết bốn đáp án dài tương đương.`,
    `- giải thích (explanation) không được lặp nguyên văn prompt.`,
    `- Độ khó bài tập: "difficulty" của mọi exercise là "${ctx.difficulty ?? 'MEDIUM'}". ${DIFFICULTY_GUIDE[ctx.difficulty ?? 'MEDIUM']}`,
  ];
  if (ctx.previousError) {
    lines.push(``, `LẦN TRƯỚC LỖI — SỬA LẠI:`, ctx.previousError);
  }
  lines.push(
    ``,
    `TOÀN VĂN CHUNK:`,
    ...ctx.chunks.map((c, i) => `---- chunk ${chunkCode(i)} ----\n${c.content}`),
  );
  lines.push(
    ``,
    `Trả về DUY NHẤT một object JSON khớp JSON Schema dưới đây. Giá trị enum/const ("difficulty",`,
    `"type") phải giữ nguyên đúng chuỗi trong schema — viết hoa, không dịch theo ngôn ngữ bài học.`,
    `Mỗi câu hỏi chỉ có các trường thuộc đúng loại "type" của nó.`,
    LESSON_JSON_SCHEMA,
  );
  return lines.join('\n');
}
