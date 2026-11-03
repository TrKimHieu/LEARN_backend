import { z } from 'zod';
import { LessonOutput } from '../schemas/output';

/**
 * lesson@3: nhận độ khó người dùng chọn khi sinh bài (trước đây `params.difficulty` bị bỏ qua).
 * lesson@2: nhúng JSON Schema đầy đủ — lesson@1 chỉ nêu tên trường, model thật bịa giá trị enum.
 */
export const LESSON_PROMPT_VERSION = 'lesson@3';

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
    `- sourceChunkIds phải là id thật của các chunk đã dùng (đừng bịa).`,
    `- Bài tập: 1–5 exercise, mỗi exercise 1–10 câu hỏi.`,
    `- MULTIPLE_CHOICE phải đúng 4 options, đúng một đáp án đúng, không có "Tất cả đáp án trên".`,
    `- giải thích (explanation) không được lặp nguyên văn prompt.`,
    `- Độ khó bài tập: "difficulty" của mọi exercise là "${ctx.difficulty ?? 'MEDIUM'}". ${DIFFICULTY_GUIDE[ctx.difficulty ?? 'MEDIUM']}`,
  ];
  if (ctx.previousError) {
    lines.push(``, `LẦN TRƯỚC LỖI — SỬA LẠI:`, ctx.previousError);
  }
  lines.push(
    ``,
    `TOÀN VĂN CHUNK:`,
    ...ctx.chunks.map((c) => `---- chunk ${c.id} ----\n${c.content}`),
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
