import { readFile } from 'node:fs/promises';
import { describe, it, expect, vi } from 'vitest';
import { ScannedPdfNotSupportedError } from '../errors';
import { extractText } from '../extract-text';
import type * as PdfModule from '../pdf';
import { OcrPageLimitError, ocrPdf, type CommandRunner } from '../ocr';

// pdfjs nạp bằng dynamic import thật, không chạy được trong vitest; luồng thật được kiểm trên image.
vi.mock('../pdf', async (importOriginal) => ({
  ...(await importOriginal<typeof PdfModule>()),
  extractPdfText: vi.fn().mockResolvedValue({ pageCount: 1, pages: [{ pageNumber: 1, text: '' }] }),
}));

const bytes = Buffer.from('%PDF-1.4 scan');

/** Giả pdftoppm/tesseract; trả text theo trang từ tên ảnh. */
const fakeRunner = (): ReturnType<typeof vi.fn> & CommandRunner =>
  vi.fn(async (file: string, args: string[]) => {
    if (file === 'tesseract') return `Chữ trang ${/page-(\d+)/.exec(args[0] ?? '')?.[1]}\n`;
    return '';
  }) as never;

describe('ocrPdf', () => {
  it('đọc từng trang theo thứ tự, ưu tiên tiếng Việt kèm tiếng Anh', async () => {
    const run = fakeRunner();
    const result = await ocrPdf(bytes, 2, { maxPages: 50, run });
    expect(result).toEqual({
      pageCount: 2,
      pages: [
        { pageNumber: 1, text: 'Chữ trang 1\n' },
        { pageNumber: 2, text: 'Chữ trang 2\n' },
      ],
    });
    const tesseractCall = run.mock.calls.find(([file]) => file === 'tesseract');
    expect(tesseractCall?.[1]).toEqual(expect.arrayContaining(['-l', 'vie+eng']));
  });

  it('truyền đúng tệp PDF tạm cho pdftoppm và dọn thư mục tạm', async () => {
    let tempPdf = '';
    const run: CommandRunner = async (file, args) => {
      if (file === 'pdftoppm') {
        tempPdf = args.find((a) => a.endsWith('input.pdf')) ?? '';
        expect((await readFile(tempPdf)).equals(bytes)).toBe(true);
        return '';
      }
      return 'Chữ';
    };
    await ocrPdf(bytes, 1, { maxPages: 50, run });
    await expect(readFile(tempPdf)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('vượt OCR_MAX_PAGES thì từ chối trước khi chạy lệnh nào', async () => {
    const run = fakeRunner();
    await expect(ocrPdf(bytes, 51, { maxPages: 50, run })).rejects.toBeInstanceOf(
      OcrPageLimitError,
    );
    expect(run).not.toHaveBeenCalled();
  });

  it('máy chưa cài OCR thì báo chưa hỗ trợ', async () => {
    const run: CommandRunner = async () => {
      throw Object.assign(new Error('spawn pdftoppm ENOENT'), { code: 'ENOENT' });
    };
    await expect(ocrPdf(bytes, 1, { maxPages: 50, run })).rejects.toBeInstanceOf(
      ScannedPdfNotSupportedError,
    );
  });

  it('không đọc được chữ nào thì báo lỗi, không tạo tài liệu rỗng', async () => {
    const run: CommandRunner = async () => '   \n';
    await expect(ocrPdf(bytes, 1, { maxPages: 50, run })).rejects.toThrow(/không đọc được/i);
  });

  it('lỗi khác của lệnh được ném nguyên', async () => {
    const run: CommandRunner = async () => {
      throw new Error('tesseract crashed');
    };
    await expect(ocrPdf(bytes, 1, { maxPages: 50, run })).rejects.toThrow('tesseract crashed');
  });
});

describe('extractText với PDF không có lớp chữ', () => {
  const PDF_BYTES = Buffer.from('%PDF-1.4 scan');

  it('chuyển sang OCR và chuẩn hoá kết quả', async () => {
    const ocr = vi.fn().mockResolvedValue({
      pageCount: 1,
      pages: [{ pageNumber: 1, text: 'Dòng một\n\n\n\nDòng hai  \n' }],
    });
    const result = await extractText(PDF_BYTES, 'application/pdf', { ocrMaxPages: 50, ocr });
    expect(ocr).toHaveBeenCalledWith(PDF_BYTES, 1, { maxPages: 50 });
    expect(result).toEqual({
      pageCount: 1,
      pages: [{ pageNumber: 1, text: 'Dòng một\n\nDòng hai' }],
    });
  });
});

describe('extractText khi không cấu hình OCR', () => {
  it('từ chối PDF scan', async () => {
    await expect(
      extractText(Buffer.from('%PDF-1.4 scan'), 'application/pdf'),
    ).rejects.toBeInstanceOf(ScannedPdfNotSupportedError);
  });
});
