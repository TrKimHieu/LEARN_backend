/**
 * Dựng lại dòng, đoạn và heading của PDF từ toạ độ + cỡ chữ mà pdfjs trả về.
 *
 * Bản trước nối mọi mẩu chữ trong trang bằng dấu cách rồi gộp mọi khoảng trắng: cả trang thành
 * một dòng, mất hết ranh giới đoạn và heading, nên chunker không nhận ra mục nào (FR-AI-10).
 *
 * PDF không có khái niệm "heading" — chỉ có chữ ở toạ độ nào, cỡ bao nhiêu. Heading ở đây là
 * dòng có cỡ chữ lớn hơn hẳn cỡ chữ thân bài (tính trên cả tài liệu), đầu ra là Markdown `#`
 * để chunker dùng chung một đường với file .md. Hàm thuần, không phụ thuộc pdfjs.
 */

export interface PdfTextItem {
  str: string;
  /** Góc trái đường chân chữ, đơn vị điểm PDF; y tăng dần lên phía trên trang. */
  x: number;
  y: number;
  width: number;
  /** Chiều cao chữ ≈ cỡ chữ. */
  height: number;
  hasEOL: boolean;
}

interface Line {
  text: string;
  y: number;
  size: number;
}

/** Cỡ chữ lớn hơn thân bài ít nhất ngần này lần mới coi là heading. */
const HEADING_RATIO = 1.2;
/** Khoảng cách dọc giữa hai đường chân chữ lớn hơn ngần này lần cỡ chữ → sang đoạn mới. */
const PARAGRAPH_GAP_RATIO = 1.6;
const MAX_HEADING_CHARS = 120;
const MAX_HEADING_LEVEL = 3;

const round = (n: number): number => Math.round(n * 2) / 2;

function buildLines(items: PdfTextItem[]): Line[] {
  const lines: Line[] = [];
  let text = '';
  let y = 0;
  let size = 0;
  let prevEnd: number | null = null;

  const flush = (): void => {
    const t = text.replace(/\s+/g, ' ').trim();
    if (t) lines.push({ text: t, y, size });
    text = '';
    size = 0;
    prevEnd = null;
  };

  for (const item of items) {
    if (item.str !== '') {
      // Cùng dòng khi đường chân chữ gần như trùng; lệch quá nửa cỡ chữ là dòng mới.
      if (text && Math.abs(item.y - y) > Math.max(size, item.height) * 0.5) flush();
      if (!text) y = item.y;
      const gap = prevEnd === null ? 0 : item.x - prevEnd;
      const needsSpace =
        text !== '' && gap > item.height * 0.15 && !/\s$/.test(text) && !/^\s/.test(item.str);
      text += (needsSpace ? ' ' : '') + item.str;
      size = Math.max(size, item.height);
      prevEnd = item.x + item.width;
    }
    if (item.hasEOL) flush();
  }
  flush();
  return lines;
}

/** Cỡ chữ thân bài = cỡ chữ chiếm nhiều ký tự nhất trên toàn tài liệu. */
function bodySize(pages: Line[][]): number {
  const chars = new Map<number, number>();
  for (const line of pages.flat()) {
    const key = round(line.size);
    chars.set(key, (chars.get(key) ?? 0) + line.text.length);
  }
  let best = 0;
  let bestChars = -1;
  for (const [size, count] of chars) {
    if (count > bestChars) {
      best = size;
      bestChars = count;
    }
  }
  return best;
}

function isHeadingLine(line: Line, body: number): boolean {
  return (
    body > 0 &&
    line.size >= body * HEADING_RATIO &&
    line.text.length >= 2 &&
    line.text.length <= MAX_HEADING_CHARS &&
    !/[.,;]$/.test(line.text)
  );
}

export function layoutPdfPages(pages: PdfTextItem[][]): string[] {
  const linePages = pages.map(buildLines);
  const body = bodySize(linePages);

  const headingSizes = [
    ...new Set(
      linePages
        .flat()
        .filter((l) => isHeadingLine(l, body))
        .map((l) => round(l.size)),
    ),
  ].sort((a, b) => b - a);
  const levelOf = (size: number): number =>
    Math.min(headingSizes.indexOf(round(size)) + 1, MAX_HEADING_LEVEL);

  return linePages.map((lines) => {
    const blocks: string[] = [];
    let paragraph: string[] = [];
    let heading: { level: number; size: number; parts: string[] } | null = null;
    let prev: Line | null = null;

    const flushParagraph = (): void => {
      if (paragraph.length) blocks.push(paragraph.join('\n'));
      paragraph = [];
    };
    const flushHeading = (): void => {
      if (heading) blocks.push(`${'#'.repeat(heading.level)} ${heading.parts.join(' ')}`);
      heading = null;
    };

    for (const line of lines) {
      if (isHeadingLine(line, body)) {
        flushParagraph();
        const level = levelOf(line.size);
        // Heading dài xuống dòng: dòng kế tiếp cùng cỡ, sát ngay bên dưới → cùng một heading.
        const continues =
          heading !== null &&
          round(heading.size) === round(line.size) &&
          prev !== null &&
          prev.y - line.y <= line.size * PARAGRAPH_GAP_RATIO;
        if (continues && heading) {
          heading.parts.push(line.text);
        } else {
          flushHeading();
          heading = { level, size: line.size, parts: [line.text] };
        }
      } else {
        flushHeading();
        const gap = prev ? prev.y - line.y : 0;
        if (prev && (gap > Math.max(prev.size, line.size) * PARAGRAPH_GAP_RATIO || gap < 0)) {
          flushParagraph();
        }
        paragraph.push(line.text);
      }
      prev = line;
    }
    flushHeading();
    flushParagraph();
    return blocks.join('\n\n');
  });
}
