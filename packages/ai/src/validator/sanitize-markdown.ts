/**
 * Tầng 4 cho `contentMd` — vệ sinh **Markdown**, không phải HTML.
 *
 * Bản trước chạy `sanitize-html` lên Markdown. Thư viện đó coi đầu vào là HTML nên escape mọi
 * `<`, `>`, `&` trong văn bản và xoá `<String>` như một thẻ lạ: `Map<string, number>` trong code
 * thành `Map`, blockquote `> …` thành `&gt; …`. Nội dung bài học có code hỏng hẳn.
 *
 * Cách làm ở đây: cắt code (fence và inline) ra giữ nguyên văn, chỉ vệ sinh phần văn bản còn lại
 * — xoá khối nguy hiểm kèm nội dung, xoá thẻ HTML thô (giữ chữ bên trong), vô hiệu link có scheme
 * thực thi được. Ký tự `<`, `>`, `&` đứng một mình không bị đụng tới. Phía web vẫn DOMPurify sau
 * khi render (lớp phòng thủ thứ hai, `components/shared/markdown.tsx`).
 */

/** Code fence (``` hoặc ~~~, 3+ ký tự) tới fence đóng cùng loại, hoặc tới hết văn bản. */
const FENCE = /^(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^\1[^\S\n]*$|(?![\s\S]))/gm;
/** Inline code: chuỗi backtick mở và đóng cùng độ dài, không vắt qua dòng trống. */
const INLINE_CODE = /(`+)(?!`)[^\n]*?(?<!`)\1(?!`)/g;

const DANGEROUS_BLOCK =
  /<(script|style|iframe|object|embed|noscript|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
/** Thẻ mở của khối nguy hiểm mà không có thẻ đóng — xoá tới hết văn bản cho chắc. */
const DANGEROUS_OPEN = /<(script|style|iframe|object|embed|noscript|template)\b[\s\S]*$/gi;
const HTML_COMMENT = /<!--[\s\S]*?-->/g;
/** Chỉ khớp thẻ thật: `<tag …>` / `</tag>` / `<tag/>` với tên bắt đầu bằng chữ cái. */
const HTML_TAG = /<\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s[^<>]*)?\/?>/g;
/** Đích link cho phép một cấp ngoặc lồng, như `javascript:alert(1)`. */
const UNSAFE_LINK = /\]\(\s*(?:javascript|data|vbscript):(?:[^()\n]|\([^()\n]*\))*\)/gi;

function sanitizeProse(text: string): string {
  return text
    .replace(HTML_COMMENT, '')
    .replace(DANGEROUS_BLOCK, '')
    .replace(DANGEROUS_OPEN, '')
    .replace(HTML_TAG, '')
    .replace(UNSAFE_LINK, '](#)');
}

/** Cắt `text` theo `pattern`: đoạn khớp giữ nguyên, đoạn giữa đi qua `transform`. */
function mapOutside(text: string, pattern: RegExp, transform: (s: string) => string): string {
  let out = '';
  let last = 0;
  for (const m of text.matchAll(pattern)) {
    const start = m.index ?? 0;
    out += transform(text.slice(last, start)) + m[0];
    last = start + m[0].length;
  }
  return out + transform(text.slice(last));
}

export function sanitizeMarkdown(md: string): string {
  const normalized = md.replace(/\r\n?/g, '\n');
  return mapOutside(normalized, FENCE, (prose) => mapOutside(prose, INLINE_CODE, sanitizeProse));
}
