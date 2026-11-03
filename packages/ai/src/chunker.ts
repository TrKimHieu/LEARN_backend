export interface ChunkMeta {
  pageFrom?: number;
  pageTo?: number;
  headingPath?: string;
}

export interface DocumentChunk extends ChunkMeta {
  index: number;
  content: string;
  tokenCount: number;
}

/** Ước lượng token bằng heuristic 4 ký tự ≈ 1 token (Tiếng Việt/Anh). */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.trim().length / 4);
}

export interface ChunkerOptions {
  targetTokens: number;
  overlapTokens: number;
  minTokens: number;
  /**
   * Mục có heading nhỏ hơn ngưỡng này mới bị gộp (`chunkPages`). Thấp hơn `minTokens` vì một mục có
   * tiêu đề riêng và ~80 token nội dung là một ý trọn vẹn, không phải mảnh vụn: gộp nó vào mục
   * trước làm dàn bài không còn thấy mục đó. Mặc định 50.
   */
  minSectionTokens?: number;
}

export const DEFAULT_CHUNKER_OPTIONS: ChunkerOptions = {
  targetTokens: 1200,
  overlapTokens: 150,
  minTokens: 100,
};

function splitIntoUnits(text: string): string[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const units: string[] = [];
  for (const p of paragraphs) {
    if (estimateTokens(p) <= 200) {
      units.push(p);
      continue;
    }
    // Đoạn quá dài: cắt theo câu
    for (const sentence of p.split(/(?<=[.!?…])\s+/)) {
      const s = sentence.trim();
      if (s) units.push(s);
    }
  }
  return units;
}

function lastNTokens(text: string, n: number): string {
  const tokens = Math.min(estimateTokens(text), n);
  const chars = tokens * 4;
  return text.length > chars ? text.slice(-chars) : text;
}

/**
 * Cắt tài liệu thành chunk — HANDBOOK §8.2: mục tiêu 1200 token, chồng lấn 150,
 * ranh giới ưu tiên heading > đoạn văn > câu. Chunk < 100 token gộp vào chunk trước.
 */
export function chunkDocument(
  text: string,
  meta: ChunkMeta,
  options: ChunkerOptions = DEFAULT_CHUNKER_OPTIONS,
): DocumentChunk[] {
  if (!text.trim()) return [];

  const units = splitIntoUnits(text);
  const chunks: DocumentChunk[] = [];
  let buffer: string[] = [];
  let bufferTokens = 0;

  const flush = (): void => {
    if (buffer.length === 0) return;
    const content = buffer.join('\n');
    const previous = chunks.at(-1);
    if (previous && estimateTokens(content) < options.minTokens) {
      previous.content = `${previous.content}\n${content}`;
      previous.tokenCount = estimateTokens(previous.content);
      buffer = [];
      bufferTokens = 0;
      return;
    }
    chunks.push({
      index: chunks.length,
      content,
      tokenCount: estimateTokens(content),
      ...meta,
    });
    buffer = [];
    bufferTokens = 0;
  };

  for (const unit of units) {
    const need = options.targetTokens - bufferTokens;
    if (bufferTokens > 0 && estimateTokens(unit) > need) {
      flush();
      buffer.push(lastNTokens(chunks.at(-1)?.content ?? '', options.overlapTokens));
      bufferTokens = estimateTokens(buffer[0] ?? '');
    }
    buffer.push(unit);
    bufferTokens += estimateTokens(unit);
  }
  flush();
  return chunks;
}

// ─── Chunk theo mục (heading) — FR-AI-10 ─────────────────────────────────────
//
// `chunkDocument` ở trên không biết heading: chunk cắt ngang ranh giới mục và `headingPath`
// luôn rỗng, nên bước outline chỉ thấy 200 ký tự đầu mỗi chunk và bỏ sót cả mục (đo thật ở
// phiên 20: tài liệu 6 mục ra 2 bài). Phần dưới đây tách tài liệu thành các mục theo heading
// trước, rồi mới đóng gói từng mục thành chunk — chunk không bao giờ vắt qua hai mục.
//
// Heading đến từ hai nguồn: Markdown `#` (file .md, và bộ trích PDF/DOCX/PPTX xuất ra dạng này
// từ cỡ chữ/style thật), cộng vài mẫu đánh số phổ biến trong văn bản thường ("Chương 2", "2.1 …").

export interface PageText {
  pageNumber: number;
  text: string;
}

export interface Heading {
  level: number;
  text: string;
}

const MD_HEADING = /^(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/;
/** Chương/Phần/Chapter/Part + số (Ả Rập hoặc La Mã) → cấp 1; Bài/Mục/Section/Lesson → cấp 2. */
const KEYWORD_HEADING =
  /^(chương|phần|chapter|part|bài|mục|section|lesson)\s+(\d+|[ivxlcdm]+)(?=$|[\s.:)\-–])(.*)$/iu;
/** "2.1 Tiêu đề", "3.2.1. Tiêu đề" — ít nhất hai cấp số, để không nhầm với danh sách "1. …". */
const NUMBERED_HEADING = /^(\d+(?:\.\d+){1,5})\.?\s+(\S.*)$/u;
const SENTENCE_END = /[.!?;:,…]$/;
const MAX_HEADING_CHARS = 100;
const TOP_LEVEL_KEYWORDS = new Set(['chương', 'phần', 'chapter', 'part']);

function startsUpper(s: string): boolean {
  const first = s.trimStart().charAt(0);
  return (
    first !== '' &&
    first === first.toLocaleUpperCase('vi') &&
    first !== first.toLocaleLowerCase('vi')
  );
}

/** Một dòng có phải heading không; `null` nếu là văn bản thường. */
export function detectHeading(rawLine: string): Heading | null {
  const line = rawLine.trim();
  if (!line) return null;

  const md = MD_HEADING.exec(line);
  if (md) return { level: (md[1] ?? '#').length, text: (md[2] ?? '').trim() };

  if (line.length > MAX_HEADING_CHARS || SENTENCE_END.test(line)) return null;

  const kw = KEYWORD_HEADING.exec(line);
  if (kw) {
    const rest = (kw[3] ?? '').trim();
    // "Bài 5: Vòng lặp", "Chapter 3 Networking" — nhưng không phải "Bài 5 rất khó".
    if (rest === '' || /^[.:)\-–]/.test(rest) || startsUpper(rest)) {
      const keyword = (kw[1] ?? '').toLocaleLowerCase('vi');
      return { level: TOP_LEVEL_KEYWORDS.has(keyword) ? 1 : 2, text: line };
    }
    return null;
  }

  const num = NUMBERED_HEADING.exec(line);
  if (num && startsUpper(num[2] ?? '')) {
    const depth = (num[1] ?? '').split('.').length;
    return { level: Math.min(depth, 6), text: line };
  }
  return null;
}

interface Unit {
  text: string;
  page: number;
}

interface Section {
  path: string[];
  /** Dòng heading (dạng Markdown) mở đầu mục, gồm cả heading cha rỗng ngay trước nó. */
  headingLines: string[];
  units: Unit[];
}

const FENCE_LINE = /^\s*(```|~~~)/;

/** Tách các trang thành mục theo heading; ngăn xếp heading mang qua ranh giới trang. */
function splitSections(pages: PageText[]): Section[] {
  const sections: Section[] = [];
  const stack: Heading[] = [];
  let current: Section = { path: [], headingLines: [], units: [] };
  let paragraph: string[] = [];
  let paragraphPage = 0;
  let inFence = false;

  const flushParagraph = (): void => {
    const text = paragraph.join('\n').trim();
    if (text) current.units.push({ text, page: paragraphPage });
    paragraph = [];
  };
  const closeSection = (): void => {
    flushParagraph();
    if (current.units.length > 0) sections.push(current);
  };

  for (const page of pages) {
    for (const line of page.text.split('\n')) {
      const fenceLine = FENCE_LINE.test(line);
      const heading = inFence || fenceLine ? null : detectHeading(line);
      if (fenceLine) inFence = !inFence;

      if (heading) {
        closeSection();
        // Mục trước rỗng (heading nối heading) thì dòng heading của nó chuyển sang mục mới,
        // để nội dung chunk vẫn mang đủ tiêu đề cha.
        const carried = current.units.length === 0 ? current.headingLines : [];
        while (stack.length > 0 && (stack.at(-1)?.level ?? 0) >= heading.level) stack.pop();
        stack.push(heading);
        current = {
          path: stack.map((h) => h.text),
          headingLines: [...carried, `${'#'.repeat(heading.level)} ${heading.text}`],
          units: [],
        };
        continue;
      }

      if (line.trim() === '' && !inFence) {
        flushParagraph();
        continue;
      }
      if (paragraph.length === 0) paragraphPage = page.pageNumber;
      paragraph.push(line);
    }
    // Hết trang thì hết đoạn — đoạn vắt trang thành hai unit, mỗi unit đúng số trang của nó.
    if (!inFence) flushParagraph();
  }
  closeSection();
  return sections;
}

/** Đoạn dài hơn 200 token tách theo câu — ranh giới ưu tiên đoạn > câu (HANDBOOK §8.2). */
function splitLongUnits(units: Unit[]): Unit[] {
  return units.flatMap((u) => {
    if (estimateTokens(u.text) <= 200 || FENCE_LINE.test(u.text)) return [u];
    return u.text
      .split(/(?<=[.!?…])\s+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((text) => ({ text, page: u.page }));
  });
}

/**
 * Cắt tài liệu nhiều trang thành chunk theo mục — HANDBOOK §8.2: mục tiêu 1200 token, chồng lấn
 * 150 (chỉ trong cùng mục), ranh giới heading > đoạn > câu. Mục nhỏ hơn `minTokens` gộp vào
 * chunk trước nếu cùng chương (heading cấp cao nhất) và không vượt `targetTokens`.
 */
export function chunkPages(
  pages: PageText[],
  options: ChunkerOptions = DEFAULT_CHUNKER_OPTIONS,
): DocumentChunk[] {
  const chunks: DocumentChunk[] = [];
  const chapterOf = new Map<DocumentChunk, string>();
  const minSection = options.minSectionTokens ?? 50;

  /**
   * Mục nhỏ chưa có chunk trước cùng chương để nhập vào — thường là phần mở đầu "# Tiêu đề" + một
   * câu giới thiệu. Giữ lại để dán vào đầu mục kế tiếp cùng chương, thay vì thành một chunk vụn
   * (và một "bài học" rỗng ở bước outline).
   */
  let carry: { text: string; pages: number[]; chapter: string; headingPath?: string } | null = null;

  const pushChunk = (chunk: DocumentChunk, chapter: string): void => {
    chunks.push(chunk);
    chapterOf.set(chunk, chapter);
  };
  const flushCarry = (): void => {
    if (!carry) return;
    pushChunk(
      {
        index: 0,
        content: carry.text,
        tokenCount: estimateTokens(carry.text),
        ...(carry.pages.length
          ? { pageFrom: Math.min(...carry.pages), pageTo: Math.max(...carry.pages) }
          : {}),
        ...(carry.headingPath ? { headingPath: carry.headingPath } : {}),
      },
      carry.chapter,
    );
    carry = null;
  };

  for (const section of splitSections(pages)) {
    const headingPath = section.path.length > 0 ? section.path.join(' > ') : undefined;
    const chapter = section.path[0] ?? '';
    const units = splitLongUnits(section.units);
    const unitPages = units.map((u) => u.page);

    // Mục nhỏ: gộp nguyên mục (kèm dòng heading) vào chunk trước cùng chương; không có chunk trước
    // cùng chương thì giữ lại chờ mục kế tiếp.
    const sectionText = [section.headingLines.join('\n'), ...units.map((u) => u.text)]
      .filter(Boolean)
      .join('\n\n');
    // Mục cấp chương (chỉ có heading cao nhất) thường là lời mở đầu của cả tài liệu/chương: nó
    // thuộc về mục con đầu tiên hơn là đứng thành một bài riêng, nên dùng ngưỡng rộng hơn.
    const threshold = section.path.length === 1 ? options.minTokens : minSection;
    if (estimateTokens(sectionText) < threshold) {
      const previous = chunks.at(-1);
      if (
        !carry &&
        previous &&
        chapterOf.get(previous) === chapter &&
        previous.tokenCount + estimateTokens(sectionText) <= options.targetTokens
      ) {
        previous.content = `${previous.content}\n\n${sectionText}`;
        previous.tokenCount = estimateTokens(previous.content);
        previous.pageTo = Math.max(previous.pageTo ?? 0, ...unitPages);
        continue;
      }
      if (carry && carry.chapter === chapter) {
        carry.text = `${carry.text}\n\n${sectionText}`;
        carry.pages.push(...unitPages);
      } else {
        flushCarry();
        carry = { text: sectionText, pages: unitPages, chapter, headingPath };
      }
      continue;
    }

    // Phần mở đầu đang chờ: cùng chương thì dán vào đầu mục này, khác chương thì đứng riêng.
    let header = section.headingLines.join('\n');
    let carriedPages: number[] = [];
    if (carry && carry.chapter === chapter) {
      header = `${carry.text}\n\n${header}`;
      carriedPages = carry.pages;
      carry = null;
    } else {
      flushCarry();
    }

    let buffer: Unit[] = [];
    let bufferTokens = 0;
    let first = true;
    const sectionStart = chunks.length;

    const flush = (): void => {
      if (buffer.length === 0) return;
      const body = buffer.map((u) => u.text).join('\n\n');
      const content = first && header ? `${header}\n\n${body}` : body;
      const pagesInChunk = [...buffer.map((u) => u.page), ...(first ? carriedPages : [])];
      const last = chunks.at(-1);
      // Mảnh cuối quá nhỏ của một mục dài gộp vào mảnh trước CÙNG mục.
      if (
        !first &&
        last &&
        chunks.length > sectionStart &&
        estimateTokens(content) < options.minTokens
      ) {
        last.content = `${last.content}\n\n${content}`;
        last.tokenCount = estimateTokens(last.content);
        last.pageTo = Math.max(last.pageTo ?? 0, ...pagesInChunk);
      } else {
        const chunk: DocumentChunk = {
          index: 0,
          content,
          tokenCount: estimateTokens(content),
          pageFrom: Math.min(...pagesInChunk),
          pageTo: Math.max(...pagesInChunk),
          ...(headingPath ? { headingPath } : {}),
        };
        pushChunk(chunk, chapter);
      }
      first = false;
      buffer = [];
      bufferTokens = 0;
    };

    for (const unit of units) {
      const tokens = estimateTokens(unit.text);
      if (bufferTokens > 0 && bufferTokens + tokens > options.targetTokens) {
        const tail = buffer.at(-1);
        flush();
        if (tail) {
          const overlap = lastNTokens(tail.text, options.overlapTokens);
          buffer.push({ text: overlap, page: tail.page });
          bufferTokens = estimateTokens(overlap);
        }
      }
      buffer.push(unit);
      bufferTokens += tokens;
    }
    flush();
  }
  flushCarry();

  chunks.forEach((c, i) => (c.index = i));
  return chunks;
}
