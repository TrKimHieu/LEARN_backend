import type { LlmGenerateParams, LlmGenerationResult, LlmProvider } from './provider';
import { findMatchingFixture, type MockFixtures } from './fixtures';

/**
 * Mock provider — HANDBOOK §15.4. Dùng cho CI, unit test, E2E và demo local khi chưa có LLM_API_KEY.
 * Không gọi mạng; sinh content từ chính chunk được truyền vào để output luôn bám nguồn.
 *
 * Nếu có `fixtures` (xem `fixtures.ts`) và nội dung chunk khớp `match` của 1 fixture, dùng nội dung
 * đã chuẩn bị sẵn (title/summary/contentMd/exercises) thay cho phần sinh chung chung — `sourceChunkIds`
 * vẫn lấy từ chunk thật để pipeline bám nguồn/validate không bị phá vỡ.
 */
export class MockLlmProvider implements LlmProvider {
  readonly defaultModel: string;
  constructor(
    chunkSize: number,
    private readonly fixtures: MockFixtures | null = null,
  ) {
    this.defaultModel = `mock/${chunkSize}`;
  }

  async generate(params: LlmGenerateParams): Promise<LlmGenerationResult> {
    const started = Date.now();
    const text = this.build(params.prompt);
    await sleep(80); // mô phỏng độ trễ
    return {
      text,
      inputTokens: Math.ceil(params.prompt.length / 4),
      outputTokens: Math.ceil(text.length / 4),
      latencyMs: Date.now() - started,
      model: this.defaultModel,
      attempt: 1,
    };
  }

  private build(prompt: string): string {
    if (prompt.includes('DANH SÁCH CHUNK (heading path')) {
      return this.buildOutline(prompt);
    }
    // Lấy dòng "---- chunk <id> ----" và content sau nó để tựa vào nội dung thật.
    const parts = prompt.split(/---- chunk ([0-9a-fA-F-]+) ----/);
    if (parts.length < 3) {
      return fallbackLessonJson();
    }
    const chunkIds: string[] = [];
    const contents: string[] = [];
    for (let i = 1; i < parts.length; i += 2) {
      chunkIds.push(parts[i] as string);
      // Chunk cuối kéo theo phần đuôi prompt (từ lesson@2, JSON Schema nằm SAU các chunk) — cắt
      // ở dòng chỉ dẫn trả về, bằng không mock chép cả schema vào nội dung bài học.
      contents.push((parts[i + 1] as string).split(/\n\s*Trả về DUY NHẤT/)[0]?.trim() ?? '');
    }
    const body = contents.join('\n\n').slice(0, 2000);

    const fixture = findMatchingFixture(this.fixtures, contents.join('\n\n'));
    if (fixture) {
      const lesson = {
        title: fixture.title,
        summary: fixture.summary,
        contentMd: fixture.contentMd,
        estimatedMinutes: fixture.estimatedMinutes,
        sourceChunkIds: chunkIds,
        exercises: fixture.exercises.map((ex) => ({
          title: ex.title,
          instruction: ex.instruction,
          difficulty: ex.difficulty,
          questions: ex.questions.map((q) => {
            const sourceChunkId = chunkIds[0] ?? '';
            if (q.type === 'MULTIPLE_CHOICE') {
              return {
                type: 'MULTIPLE_CHOICE',
                prompt: q.prompt,
                options: q.options ?? [],
                explanation: q.explanation,
                sourceChunkId,
              };
            }
            if (q.type === 'TRUE_FALSE') {
              return {
                type: 'TRUE_FALSE',
                prompt: q.prompt,
                statement: q.statement ?? q.prompt,
                answer: q.answer === true || q.answer === 'true',
                explanation: q.explanation,
                sourceChunkId,
              };
            }
            if (q.type === 'SHORT_ANSWER') {
              return {
                type: 'SHORT_ANSWER',
                prompt: q.prompt,
                modelAnswer: q.modelAnswer ?? '',
                explanation: q.explanation,
                sourceChunkId,
              };
            }
            return {
              type: 'FILL_BLANK',
              prompt: q.prompt,
              blankHint: q.blankHint ?? '',
              answer: String(q.answer ?? ''),
              explanation: q.explanation,
              sourceChunkId,
            };
          }),
        })),
      };
      return JSON.stringify(lesson);
    }

    // Tiêu đề theo mục outline đang soạn. Bản trước lấy 4 ký tự đầu của chunk id — id là uuidv7
    // (tiền tố là thời gian) nên mọi chunk tạo cùng lúc trùng tiền tố, mọi bài trùng tiêu đề và
    // bị tầng 2 loại vì "trùng bài đã có": tài liệu 6 mục chỉ ra 1 bài ở chế độ mock.
    const nodeTitle = /Bài học cần soạn: "([^"]+)"/.exec(prompt)?.[1]?.split(' > ').at(-1);
    const title = nodeTitle
      ? nodeTitle.slice(0, 200).padEnd(5, '.')
      : chunkIds[0]
        ? `Bài học từ tài liệu (${chunkIds[0].slice(-6)})`
        : 'Bài học';
    const lesson = {
      title,
      summary: `${title}. Nội dung biên soạn bám theo tài liệu gốc ở chế độ mock.`,
      contentMd: `# ${title}\n\nNội dung rút gọn từ tài liệu do LLM mock sinh ra để chạy end-to-end.\n\n${body}`,
      estimatedMinutes: 8,
      sourceChunkIds: chunkIds,
      exercises: [
        {
          title: 'Kiểm tra nhanh',
          instruction: 'Chọn câu trả lời đúng duy nhất.',
          difficulty: 'EASY',
          questions: [
            {
              type: 'MULTIPLE_CHOICE',
              prompt: `Khái niệm được nhắc đến trong bài là gì?`,
              options: [
                { content: 'Nội dung trích từ tài liệu', isCorrect: true },
                { content: 'Khái niệm không có trong tài liệu', isCorrect: false },
                { content: 'Một câu loại trừ', isCorrect: false },
                { content: 'Một câu loại trừ khác', isCorrect: false },
              ],
              explanation: 'Đáp án dựa đúng vào nội dung tài liệu được cung cấp.',
              sourceChunkId: chunkIds[0] ?? '',
            },
          ],
        },
      ],
    };
    return JSON.stringify(lesson);
  }

  private buildOutline(prompt: string): string {
    const lineRe = /^- id=(\S+) \| heading=(.*?) \| preview=(.*)$/gm;
    const nodes: { title: string; description: string; chunkIds: string[] }[] = [];
    let match: RegExpExecArray | null;
    let i = 0;
    while ((match = lineRe.exec(prompt)) && nodes.length < 20) {
      const [, id, heading, preview] = match;
      i += 1;
      const label = heading && heading !== '(không có)' ? heading : `Phần ${i}`;
      nodes.push({
        title: label.slice(0, 200) || `Phần ${i}`,
        description: (preview || `Nội dung phần ${i} của tài liệu.`).slice(0, 500).padEnd(10, '.'),
        chunkIds: [id as string],
      });
    }
    const language = prompt.includes('tiếng Anh') ? 'en' : 'vi';
    const outline = {
      courseTitle: 'Khóa học sinh tự động (mock)',
      language,
      nodes:
        nodes.length > 0
          ? nodes
          : [
              {
                title: 'Bài học tổng quan',
                description: 'Nội dung tổng quan.',
                chunkIds: ['unknown'],
              },
            ],
    };
    return JSON.stringify(outline);
  }
}

function fallbackLessonJson(): string {
  return JSON.stringify({
    title: 'Bài học mẫu',
    summary: 'Bài học mẫu khi LLM mock không nhận được chunk.',
    contentMd: `# Bài học mẫu\n\nĐây là nội dung fallback.\n\nBài này được sinh bởi mock provider mà không có dữ liệu chunk.`,
    estimatedMinutes: 5,
    sourceChunkIds: [],
    exercises: [],
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
