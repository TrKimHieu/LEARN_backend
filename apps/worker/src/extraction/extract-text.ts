import { extractPdfText, isLikelyScanned } from './pdf';
import { extractDocx, extractPptx } from './office';
import { UnsupportedFileError, ScannedPdfNotSupportedError, type ExtractResult } from './errors';

export {
  UnsupportedFileError,
  ScannedPdfNotSupportedError,
  type ExtractedPage,
  type ExtractResult,
} from './errors';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
/** DOCX/PPTX là gói ZIP: bắt đầu bằng chữ ký local file header `PK\x03\x04`. */
const MAGIC_ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

const MAGIC_PDF = Buffer.from('%PDF-');

/** Kiểm tra magic bytes khớp mimeType đã khai — HANDBOOK §10.3, checklist 20.3. */
function verifyMagicBytes(bytes: Buffer, mimeType: string): void {
  if (mimeType === 'application/pdf') {
    if (!bytes.subarray(0, 5).equals(MAGIC_PDF)) {
      throw new UnsupportedFileError(
        'application/pdf (magic bytes không khớp — file có thể bị hỏng)',
      );
    }
    return;
  }
  if (mimeType === DOCX_MIME || mimeType === PPTX_MIME) {
    if (!bytes.subarray(0, 4).equals(MAGIC_ZIP)) {
      throw new UnsupportedFileError(`${mimeType} (magic bytes không khớp — file có thể bị hỏng)`);
    }
    return;
  }
  // text/plain, text/markdown: từ chối nếu có byte NUL (dấu hiệu file nhị phân đội lốt text).
  if (bytes.subarray(0, 2000).includes(0)) {
    throw new UnsupportedFileError(`${mimeType} (nội dung có vẻ là nhị phân, không phải text)`);
  }
}

/** Dọn text thô trước khi cắt chunk — HANDBOOK §8.2 (rút gọn: gộp dòng trống, nối gạch nối). */
export function normalizeText(text: string): string {
  return text
    .replace(/(\w)-\n(\w)/g, '$1$2') // nối từ bị gạch nối cuối dòng
    .replace(/\n{3,}/g, '\n\n') // gộp nhiều dòng trống
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

/** Trích text theo loại file — HANDBOOK §8.2. OCR cho PDF scan: chưa hỗ trợ (FR-DOC-10). */
export async function extractText(bytes: Buffer, mimeType: string): Promise<ExtractResult> {
  verifyMagicBytes(bytes, mimeType);

  if (mimeType === 'application/pdf') {
    const result = await extractPdfText(bytes);
    if (isLikelyScanned(result)) throw new ScannedPdfNotSupportedError();
    return {
      pages: result.pages.map((p) => ({ pageNumber: p.pageNumber, text: normalizeText(p.text) })),
      pageCount: result.pageCount,
    };
  }

  if (mimeType === DOCX_MIME || mimeType === PPTX_MIME) {
    const result = mimeType === DOCX_MIME ? await extractDocx(bytes) : await extractPptx(bytes);
    return {
      pages: result.pages.map((p) => ({ pageNumber: p.pageNumber, text: normalizeText(p.text) })),
      pageCount: result.pageCount,
    };
  }

  if (mimeType === 'text/plain' || mimeType === 'text/markdown') {
    return {
      pages: [{ pageNumber: 1, text: normalizeText(bytes.toString('utf-8')) }],
      pageCount: null,
    };
  }

  throw new UnsupportedFileError(mimeType);
}
