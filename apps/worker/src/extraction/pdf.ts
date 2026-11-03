import type * as PdfJsModule from 'pdfjs-dist/legacy/build/pdf.mjs';
import { layoutPdfPages, type PdfTextItem } from './pdf-layout';

/**
 * pdfjs-dist v4 chỉ phân phối bản ESM (.mjs) — TypeScript compile ra CommonJS sẽ hạ `import()`
 * thành `require()`, không load được. Ép dùng dynamic import thật qua `new Function` để né downlevel.
 */
const dynamicImport = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<typeof PdfJsModule>;

const STANDARD_FONT_DATA_URL = `${require.resolve('pdfjs-dist/package.json').replace(/package\.json$/, '')}standard_fonts/`;

export interface PdfPage {
  pageNumber: number;
  text: string;
}

export interface PdfExtractResult {
  pages: PdfPage[];
  pageCount: number;
}

/** Trích text theo từng trang, giữ layer text — HANDBOOK §8.2. */
export async function extractPdfText(bytes: Buffer): Promise<PdfExtractResult> {
  const pdfjs = await dynamicImport('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: true,
    isEvalSupported: false,
    standardFontDataUrl: STANDARD_FONT_DATA_URL,
  }).promise;

  const rawPages: PdfTextItem[][] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    rawPages.push(
      content.items.flatMap((item) => {
        if (!('str' in item)) return [];
        const [, , c = 0, d = 0, x = 0, y = 0] = item.transform as number[];
        return [
          {
            str: item.str,
            x,
            y,
            width: item.width,
            // Một số font báo `height` = 0; cỡ chữ vẫn suy được từ ma trận biến đổi.
            height: item.height || Math.hypot(c, d),
            hasEOL: item.hasEOL,
          },
        ];
      }),
    );
  }
  // Giữ dòng/đoạn/heading thay vì nối cả trang thành một dòng — xem pdf-layout.ts.
  const pages: PdfPage[] = layoutPdfPages(rawPages).map((text, i) => ({
    pageNumber: i + 1,
    text,
  }));
  await doc.destroy();
  return { pages, pageCount: doc.numPages };
}

/** Nhận diện PDF scan (không có text layer) — HANDBOOK §8.2: tổng ký tự / số trang < 100. */
export function isLikelyScanned(result: PdfExtractResult): boolean {
  const totalChars = result.pages.reduce((sum, p) => sum + p.text.length, 0);
  return result.pageCount > 0 && totalChars / result.pageCount < 100;
}
