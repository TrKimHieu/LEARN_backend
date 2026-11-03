import type { OutlineNodeOutputT, OutlineOutputT } from '../schemas/output';

/**
 * outline@2: thêm luật bao phủ + preview dài hơn + heading path thật (chunker theo mục). Đo thật
 * ở outline@1: tài liệu 6 mục chỉ ra 2 bài — model chỉ thấy 200 ký tự đầu mỗi chunk, không có
 * heading nào, và không bị yêu cầu phủ hết tài liệu.
 */
export const OUTLINE_PROMPT_VERSION = 'outline@2';

/** Số ký tự đầu mỗi chunk đưa vào prompt outline. */
export const OUTLINE_PREVIEW_CHARS = 400;

export interface OutlineContext {
  language: 'vi' | 'en';
  chunks: Array<{ id: string; headingPath: string; preview: string }>;
  previousError?: string;
}

export function outlinePrompt(ctx: OutlineContext): string {
  const lines = [
    `Bạn là kiến trúc sư nội dung cho nền tảng học tập LEARN.`,
    `Nhiệm vụ: lập outline (dàn bài) khóa học từ tài liệu người dùng cung cấp.`,
    ``,
    `LUẬT BẮT BUỘC:`,
    `- CHỈ dùng thông tin trong tài liệu được cung cấp. KHÔNG thêm kiến thức ngoài.`,
    `- Ngôn ngữ đầu ra: ${ctx.language === 'vi' ? 'tiếng Việt' : 'tiếng Anh'}.`,
    `- Mỗi node phải khai chunkIds là các id thật có trong danh sách bên dưới.`,
    `- Tối đa 20 node. Mỗi node là một bài học độc lập, theo đúng trình tự của tài liệu.`,
    `- BAO PHỦ: mọi chunk có nội dung học được phải thuộc ít nhất một node. Mỗi mục lớn`,
    `  (phần đầu của heading path) phải có ít nhất một node. Không bỏ sót mục nào.`,
    `- Mục quá nhỏ thì gộp với mục kề bên trong cùng một node, không tách thành bài riêng.`,
    `- Bỏ qua được: mục lục, lời nói đầu, tài liệu tham khảo, trang bìa.`,
  ];
  if (ctx.previousError) {
    lines.push(``, `LẦN TRƯỚC LỖI — SỬA LẠI:`, ctx.previousError);
  }
  lines.push(
    ``,
    `DANH SÁCH CHUNK (heading path + ${OUTLINE_PREVIEW_CHARS} ký tự đầu):`,
    ...ctx.chunks.map(
      // Mỗi chunk đúng một dòng: preview có thể chứa xuống dòng (dòng heading, đoạn văn).
      (c) =>
        `- id=${c.id} | heading=${c.headingPath || '(không có)'} | preview=${c.preview.replace(/\s+/g, ' ').trim()}`,
    ),
    ``,
    `Trả về JSON khớp schema: { courseTitle, language, nodes: [{ title, description, chunkIds }] }`,
  );
  return lines.join('\n');
}

/** Tỷ lệ chunk không thuộc node nào mà vẫn chấp nhận được (mục lục, lời nói đầu…). */
export const OUTLINE_MAX_UNCOVERED_RATIO = 0.25;

export interface OutlineCoverage {
  uncoveredIds: string[];
  /** Heading path của các chunk bị sót, không trùng lặp, theo thứ tự tài liệu. */
  uncoveredHeadings: string[];
  ratio: number;
}

/** Outline bỏ sót những chunk nào — hàm thuần, worker dùng để yêu cầu lập lại. */
export function outlineCoverage(
  outline: Pick<OutlineOutputT, 'nodes'>,
  chunks: ReadonlyArray<{ id: string; headingPath: string }>,
): OutlineCoverage {
  const covered = new Set(outline.nodes.flatMap((n) => n.chunkIds));
  const missing = chunks.filter((c) => !covered.has(c.id));
  return {
    uncoveredIds: missing.map((c) => c.id),
    uncoveredHeadings: [...new Set(missing.map((c) => c.headingPath).filter(Boolean))],
    ratio: chunks.length === 0 ? 0 : missing.length / chunks.length,
  };
}

/** Phản hồi gửi lại model khi outline sót quá nhiều. */
export function coverageFeedback(coverage: OutlineCoverage): string {
  const where =
    coverage.uncoveredHeadings.length > 0
      ? `Các mục bị sót: ${coverage.uncoveredHeadings.slice(0, 15).join('; ')}.`
      : `Các chunk bị sót: ${coverage.uncoveredIds.slice(0, 30).join(', ')}.`;
  return (
    `Outline bỏ sót ${Math.round(coverage.ratio * 100)}% chunk của tài liệu. ${where} ` +
    `Thêm node cho các mục này hoặc gắn chunk vào node phù hợp.`
  );
}

export type { OutlineNodeOutputT };
