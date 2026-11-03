/**
 * Loại tài liệu được nhận — nguồn sự thật duy nhất cho web (thuộc tính `accept`, MIME gửi lên),
 * API (chuẩn hoá MIME lúc xin presigned URL) và tài liệu hiển thị.
 *
 * MIME luôn suy từ **đuôi file**, không tin `File.type` của trình duyệt: Chrome trên Windows trả
 * chuỗi rỗng cho `.md` (và cho `.txt` khi thiếu khoá registry), nên trước đây web gửi
 * `application/octet-stream` và API từ chối 415. Worker vẫn kiểm magic bytes sau khi tải về
 * (NFR-SEC-07), nên tin đuôi ở đây không mở ra lỗ hổng nào.
 */
export interface DocumentType {
  ext: string;
  mime: string;
  label: string;
  /** MIME khác mà trình duyệt/hệ điều hành hay khai cho cùng loại file — vẫn chấp nhận. */
  aliases: readonly string[];
}

export const DOCUMENT_TYPES: readonly DocumentType[] = [
  { ext: '.pdf', mime: 'application/pdf', label: 'PDF', aliases: [] },
  { ext: '.txt', mime: 'text/plain', label: 'TXT', aliases: [] },
  {
    ext: '.md',
    mime: 'text/markdown',
    label: 'Markdown',
    aliases: ['text/plain', 'text/x-markdown'],
  },
  {
    ext: '.docx',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    label: 'Word (DOCX)',
    aliases: [],
  },
  {
    ext: '.pptx',
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    label: 'PowerPoint (PPTX)',
    aliases: [],
  },
];

/** Giá trị cho `<input type="file" accept>`. */
export const DOCUMENT_ACCEPT = DOCUMENT_TYPES.map((t) => t.ext).join(',');

/** MIME hợp lệ mà API chấp nhận lưu vào `Document.mimeType`. */
export const DOCUMENT_MIME_TYPES: ReadonlySet<string> = new Set(DOCUMENT_TYPES.map((t) => t.mime));

function typeOf(filename: string): DocumentType | null {
  const dot = filename.lastIndexOf('.');
  if (dot <= 0 && !filename.startsWith('.')) return null;
  const ext = filename.slice(dot).toLowerCase();
  return DOCUMENT_TYPES.find((t) => t.ext === ext) ?? null;
}

export function mimeFromFilename(filename: string): string | null {
  return typeOf(filename)?.mime ?? null;
}

/** MIME client khai mà không mang thông tin gì — bỏ qua, dùng MIME theo đuôi. */
const UNINFORMATIVE_MIME = new Set(['', 'application/octet-stream']);

export type ResolvedMime = { ok: true; mime: string } | { ok: false; reason: string };

/**
 * Chuẩn hoá MIME cho một lượt tải lên: đuôi quyết định loại; MIME client khai chỉ dùng để phát
 * hiện mâu thuẫn (ví dụ `a.md` mà khai `application/pdf` — file đổi tên hoặc client lỗi).
 */
export function resolveUploadMime(filename: string, declared: string): ResolvedMime {
  const type = typeOf(filename);
  if (!type) {
    return {
      ok: false,
      reason: `Chỉ nhận ${DOCUMENT_TYPES.map((t) => t.label).join(', ')}.`,
    };
  }
  const claimed = declared.trim().toLowerCase();
  if (
    !UNINFORMATIVE_MIME.has(claimed) &&
    claimed !== type.mime &&
    !type.aliases.includes(claimed)
  ) {
    return { ok: false, reason: `Đuôi ${type.ext} không khớp loại file khai báo (${claimed}).` };
  }
  return { ok: true, mime: type.mime };
}
