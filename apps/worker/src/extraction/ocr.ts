import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ScannedPdfNotSupportedError, type ExtractResult } from './errors';

export class OcrPageLimitError extends Error {
  constructor(pageCount: number, maxPages: number) {
    super(`PDF scan có ${pageCount} trang, vượt giới hạn OCR ${maxPages} trang.`);
    this.name = 'OcrPageLimitError';
  }
}

export type CommandRunner = (file: string, args: string[]) => Promise<string>;

const RENDER_DPI = '200';
const COMMAND_TIMEOUT_MS = 120_000;
const MAX_PAGE_TEXT_BYTES = 10 * 1024 * 1024;

/**
 * Tệp PDF do người dùng tải lên là dữ liệu không tin cậy: chỉ truyền biến môi trường tối thiểu, để
 * lỗi parser không đọc được secret của worker. Giới hạn thread để OCR không chiếm hết CPU.
 */
const runCommand: CommandRunner = (file, args) =>
  new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        timeout: COMMAND_TIMEOUT_MS,
        maxBuffer: MAX_PAGE_TEXT_BYTES,
        env: {
          PATH: process.env.PATH,
          OMP_THREAD_LIMIT: '2',
          ...(process.env.TESSDATA_PREFIX ? { TESSDATA_PREFIX: process.env.TESSDATA_PREFIX } : {}),
        },
      },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
  });

const isCommandMissing = (err: unknown): boolean =>
  !!err && typeof err === 'object' && (err as { code?: unknown }).code === 'ENOENT';

/** Dựng ảnh từng trang bằng pdftoppm rồi đọc bằng tesseract. Lần lượt từng trang để giữ RAM thấp. */
export async function ocrPdf(
  bytes: Buffer,
  pageCount: number,
  options: { maxPages: number; run?: CommandRunner },
): Promise<ExtractResult> {
  if (pageCount > options.maxPages) throw new OcrPageLimitError(pageCount, options.maxPages);

  const run = options.run ?? runCommand;
  const dir = await mkdtemp(join(tmpdir(), 'learn-ocr-'));
  try {
    const input = join(dir, 'input.pdf');
    await writeFile(input, bytes);

    const pages: ExtractResult['pages'] = [];
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
      const page = String(pageNumber);
      const image = join(dir, `page-${page}`);
      await run('pdftoppm', [
        '-r',
        RENDER_DPI,
        '-gray',
        '-png',
        '-singlefile',
        '-f',
        page,
        '-l',
        page,
        input,
        image,
      ]);
      const text = await run('tesseract', [`${image}.png`, 'stdout', '-l', 'vie+eng']);
      await rm(`${image}.png`, { force: true });
      pages.push({ pageNumber, text });
    }

    if (pages.every((p) => !p.text.trim())) {
      throw new Error('OCR không đọc được chữ nào trong PDF scan.');
    }
    return { pages, pageCount };
  } catch (err) {
    if (isCommandMissing(err)) throw new ScannedPdfNotSupportedError();
    throw err;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
