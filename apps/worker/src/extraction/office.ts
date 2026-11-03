import JSZip from 'jszip';
import mammoth from 'mammoth';
import { UnsupportedFileError, type ExtractResult } from './errors';

/**
 * Trích DOCX/PPTX (FR-DOC-09). Đầu ra là văn bản dạng Markdown — heading thật của Word và tiêu
 * đề slide thành `#` — để chunker cắt theo mục y như file .md (FR-AI-10).
 */

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

async function openZip(bytes: Buffer, mimeType: string, requiredPart: string): Promise<JSZip> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new UnsupportedFileError(`${mimeType} (không đọc được nội dung, file có thể bị hỏng)`);
  }
  if (!zip.file(requiredPart)) {
    throw new UnsupportedFileError(
      `${mimeType} (thiếu ${requiredPart}, không phải tài liệu Office hợp lệ)`,
    );
  }
  return zip;
}

export function decodeXmlEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

const stripTags = (s: string): string => s.replace(/<[^>]+>/g, '');
const inline = (html: string): string =>
  decodeXmlEntities(stripTags(html.replace(/<br\s*\/?>/gi, '\n')))
    .replace(/[ \t]+/g, ' ')
    .trim();

/**
 * HTML của mammoth → Markdown tối giản: heading, đoạn, mục danh sách, hàng bảng. Mammoth chỉ
 * sinh một tập thẻ nhỏ và đã đóng đủ, nên đọc tuần tự theo khối là đủ, không cần parser DOM.
 */
export function mammothHtmlToMarkdown(html: string): string {
  const blocks: string[] = [];
  // Có tên tài liệu (style Title, xem DOCX_STYLE_MAP) thì nó là cấp 1 và mọi Heading lùi một cấp,
  // để các mục của tài liệu nằm chung một "chương" như file .md và PDF.
  const hasTitle = /<h1 class="doc-title">/.test(html);
  const blockRe = /<(h[1-6]|p|li|tr)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  for (const m of html.matchAll(blockRe)) {
    const tag = (m[1] ?? '').toLowerCase();
    const attrs = m[2] ?? '';
    const inner = m[3] ?? '';
    if (tag === 'tr') {
      const cells = [...inner.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) =>
        inline(c[1] ?? ''),
      );
      if (cells.some(Boolean)) blocks.push(cells.join(' | '));
      continue;
    }
    // Đoạn nằm trong ô bảng đã được lấy qua hàng `tr` ở trên — bỏ qua để khỏi lặp.
    const before = html.slice(0, m.index ?? 0);
    const openCells = (before.match(/<td\b/gi) ?? []).length;
    const closedCells = (before.match(/<\/td>/gi) ?? []).length;
    if (openCells > closedCells) continue;

    const text = inline(inner);
    if (!text) continue;
    if (tag.startsWith('h')) {
      const isTitle = attrs.includes('doc-title');
      const level =
        isTitle || !hasTitle ? Number(tag.slice(1)) : Math.min(Number(tag.slice(1)) + 1, 6);
      blocks.push(`${'#'.repeat(level)} ${text}`);
    } else if (tag === 'li') blocks.push(`- ${text}`);
    else blocks.push(text);
  }
  return blocks.join('\n\n');
}

/**
 * Word đặt tên tài liệu bằng style "Title" (không phải "Heading 1"), mammoth mặc định coi nó là đoạn
 * thường — tên tài liệu rơi vào chunk "(không heading)". Tên style built-in lưu bằng tiếng Anh trong
 * styles.xml dù giao diện Word là tiếng Việt, nên so theo tên là đủ.
 */
const DOCX_STYLE_MAP = [
  "p[style-name='Title'] => h1.doc-title:fresh",
  "p[style-name='Subtitle'] => p:fresh",
];

export async function extractDocx(bytes: Buffer): Promise<ExtractResult> {
  const zip = await openZip(bytes, DOCX_MIME, 'word/document.xml');
  const { value: html } = await mammoth.convertToHtml(
    { buffer: bytes },
    { styleMap: DOCX_STYLE_MAP },
  );

  // DOCX không có trang cố định; Word ghi số trang lúc lưu vào docProps/app.xml. Có thì dùng để
  // áp hạn mức trang như PDF, không có thì coi như TXT (không giới hạn theo trang).
  const app = await zip.file('docProps/app.xml')?.async('string');
  const pagesMatch = app ? /<Pages>(\d+)<\/Pages>/.exec(app) : null;
  const pageCount = pagesMatch ? Number(pagesMatch[1]) : null;

  return { pages: [{ pageNumber: 1, text: mammothHtmlToMarkdown(html) }], pageCount };
}

/** Thứ tự slide theo trình chiếu (presentation.xml + rels), không theo tên file. */
async function slidePaths(zip: JSZip): Promise<string[]> {
  const presentation = (await zip.file('ppt/presentation.xml')?.async('string')) ?? '';
  const rels = (await zip.file('ppt/_rels/presentation.xml.rels')?.async('string')) ?? '';
  const targetById = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[0])?.[1];
    const target = /\bTarget="([^"]+)"/.exec(m[0])?.[1];
    if (id && target) targetById.set(id, target.replace(/^\/?(ppt\/)?/, 'ppt/'));
  }
  const ordered = [...presentation.matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"/g)]
    .map((m) => targetById.get(m[1] ?? ''))
    .filter((p): p is string => Boolean(p && zip.file(p)));
  if (ordered.length > 0) return ordered;

  // Dự phòng: file không có danh sách slide — xếp theo số trong tên file.
  return Object.keys(zip.files)
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
    .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)?.[1]) - Number(/(\d+)\.xml$/.exec(b)?.[1]));
}

function shapeParagraphs(shapeXml: string): string[] {
  return [...shapeXml.matchAll(/<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g)]
    .map((p) =>
      decodeXmlEntities(
        [...(p[1] ?? '').matchAll(/<a:t>([\s\S]*?)<\/a:t>|<a:br\s*\/>/g)]
          .map((t) => (t[0].startsWith('<a:br') ? '\n' : (t[1] ?? '')))
          .join(''),
      ).trim(),
    )
    .filter(Boolean);
}

/**
 * Tiêu đề slide 1 thành `#` (tên bài trình chiếu), tiêu đề các slide sau thành `##` — để các
 * slide ngắn cùng một bài được chunker gộp lại (cùng "chương") thay vì mỗi slide một chunk vụn.
 */
export async function extractPptx(bytes: Buffer): Promise<ExtractResult> {
  const zip = await openZip(bytes, PPTX_MIME, 'ppt/presentation.xml');
  const paths = await slidePaths(zip);

  const pages = await Promise.all(
    paths.map(async (path, i) => {
      const xml = (await zip.file(path)?.async('string')) ?? '';
      const lines: string[] = [];
      for (const sp of xml.matchAll(/<p:sp\b[\s\S]*?<\/p:sp>/g)) {
        const shapeXml = sp[0];
        const isTitle = /<p:ph\b[^>]*\btype="(title|ctrTitle)"/.test(shapeXml);
        const paragraphs = shapeParagraphs(shapeXml);
        if (paragraphs.length === 0) continue;
        if (isTitle) {
          lines.unshift(`${i === 0 ? '#' : '##'} ${paragraphs.join(' ').replace(/\s+/g, ' ')}`, '');
        } else {
          lines.push(paragraphs.join('\n'), '');
        }
      }
      return { pageNumber: i + 1, text: lines.join('\n').trim() };
    }),
  );

  return { pages, pageCount: pages.length };
}
