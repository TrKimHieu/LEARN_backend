import { createHash } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
import type { ImportTextDocumentInput } from '@learn/contracts';
import { ApiError } from '../../../../core/exceptions/errors';
import { DocumentsService } from '../documents.service';

const USER = 'u1';
const COURSE = 'c1';

function setup(opts: { pagesLimit?: number; course?: boolean; duplicate?: boolean } = {}) {
  const created: Array<{ doc: Record<string, unknown>; chunks: Array<Record<string, unknown>> }> =
    [];
  const documents = {
    findDuplicateInCourse: vi.fn(async () => (opts.duplicate ? { filename: 'cu.txt' } : null)),
    createExtracted: vi.fn(
      async (doc: Record<string, unknown>, chunks: Array<Record<string, unknown>>) => {
        created.push({ doc, chunks });
        return {
          ...doc,
          status: 'EXTRACTED',
          errorMessage: null,
          createdAt: new Date('2026-11-09T00:00:00Z'),
        };
      },
    ),
    findOwned: vi.fn(async (id: string) => ({
      id,
      status: 'EXTRACTED',
      storageKey: id.startsWith('t') ? `text/${id}` : `u1/documents/${id}.pdf`,
    })),
    delete: vi.fn(async () => undefined),
  };
  const courses = { findOwned: vi.fn(async () => (opts.course === false ? null : { id: COURSE })) };
  const s3 = {
    getDownloadUrl: vi.fn(async () => 'https://s3/x'),
    deleteObject: vi.fn(async () => undefined),
  };
  const consume = vi.fn(async (_u: string, _m: string, fn: (tx: unknown) => unknown) => fn({}));
  const usage = {
    consume,
    planForUser: vi.fn(async () => ({
      limits:
        opts.pagesLimit === undefined
          ? {}
          : { PAGES_PROCESSED: { limit: opts.pagesLimit, window: 'per_document' } },
    })),
  };
  const service = new DocumentsService(
    documents as never,
    courses as never,
    s3 as never,
    {} as never,
    usage as never,
  );
  return { service, documents, s3, usage, consume, created };
}

const input = (over: Partial<ImportTextDocumentInput> = {}): ImportTextDocumentInput => ({
  filename: 'ghi-chu.txt',
  sourceMimeType: 'text/plain',
  sourceSizeBytes: 100,
  method: 'TEXT',
  pages: [{ page: null, text: '# Tiêu đề\r\n\r\nNội dung\u0000 bài học.' }],
  ...over,
});

describe('DocumentsService.importText', () => {
  it('creates an EXTRACTED document with chunks and consumes quota', async () => {
    const { service, consume, created } = setup();
    const res = await service.importText(USER, COURSE, input());

    expect(consume).toHaveBeenCalledWith(USER, 'DOCUMENTS_UPLOADED', expect.any(Function));
    expect(created).toHaveLength(1);
    const { doc, chunks } = created[0]!;
    expect(doc).toMatchObject({
      uploaderId: USER,
      courseId: COURSE,
      filename: 'ghi-chu.txt',
      mimeType: 'text/plain',
      sizeBytes: 100,
      pageCount: null,
    });
    expect(String(doc.storageKey)).toMatch(/^text\//);
    const normalised = '# Tiêu đề\n\nNội dung bài học.';
    expect(doc.checksumSha256).toBe(createHash('sha256').update(normalised).digest('hex'));
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every((c) => c.pageFrom == null && c.pageTo == null)).toBe(true);
    expect(res).toMatchObject({
      status: 'EXTRACTED',
      pageCount: null,
      chunkCount: chunks.length,
      filename: 'ghi-chu.txt',
    });
  });

  it('keeps page numbers and pageCount for PDF_TEXT', async () => {
    const { service, created } = setup();
    await service.importText(
      USER,
      COURSE,
      input({
        method: 'PDF_TEXT',
        pages: [
          { page: 1, text: 'Trang một.' },
          { page: 2, text: 'Trang hai.' },
        ],
      }),
    );
    expect(created[0]!.doc.pageCount).toBe(2);
    expect(created[0]!.chunks[0]).toMatchObject({ pageFrom: 1 });
  });

  it('rejects whitespace-only text with 400', async () => {
    const { service, consume } = setup();
    const err = await service
      .importText(USER, COURSE, input({ pages: [{ page: null, text: ' \n\t\u0000 ' }] }))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(400);
    expect(consume).not.toHaveBeenCalled();
  });

  it('rejects text over the total character limit with 413', async () => {
    const { service } = setup();
    const pages = Array.from({ length: 11 }, (_, i) => ({
      page: i + 1,
      text: 'a'.repeat(190000),
    }));
    const err = await service
      .importText(USER, COURSE, input({ method: 'PDF_TEXT', pages }))
      .catch((e: unknown) => e);
    expect((err as ApiError).status).toBe(413);
  });

  it('returns 404 for an unknown course', async () => {
    const { service, consume } = setup({ course: false });
    const err = await service.importText(USER, COURSE, input()).catch((e: unknown) => e);
    expect((err as ApiError).status).toBe(404);
    expect(consume).not.toHaveBeenCalled();
  });

  it('returns 409 for a duplicate checksum', async () => {
    const { service, consume } = setup({ duplicate: true });
    const err = await service.importText(USER, COURSE, input()).catch((e: unknown) => e);
    expect((err as ApiError).status).toBe(409);
    expect((err as ApiError).message).toContain('cu.txt');
    expect(consume).not.toHaveBeenCalled();
  });

  it('enforces the per-plan page limit for paged methods', async () => {
    const { service, consume } = setup({ pagesLimit: 2 });
    const pages = [1, 2, 3].map((p) => ({ page: p, text: `Trang ${p}` }));
    const err = await service
      .importText(USER, COURSE, input({ method: 'OCR', pages }))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('QUOTA_EXCEEDED');
    expect(consume).not.toHaveBeenCalled();
  });

  it('allows paged input at the plan limit', async () => {
    const { service } = setup({ pagesLimit: 2 });
    const pages = [1, 2].map((p) => ({ page: p, text: `Trang ${p}` }));
    await expect(
      service.importText(USER, COURSE, input({ method: 'PDF_TEXT', pages })),
    ).resolves.toMatchObject({ pageCount: 2 });
  });
});

describe('text documents have no stored file', () => {
  it('getDownload returns 404 without touching S3', async () => {
    const { service, s3 } = setup();
    const err = await service.getDownload(USER, 't1').catch((e: unknown) => e);
    expect((err as ApiError).status).toBe(404);
    expect(s3.getDownloadUrl).not.toHaveBeenCalled();
  });

  it('remove deletes the row but not an S3 object', async () => {
    const { service, documents, s3 } = setup();
    await service.remove(USER, 't1');
    expect(documents.delete).toHaveBeenCalledWith('t1');
    expect(s3.deleteObject).not.toHaveBeenCalled();
  });

  it('remove still deletes the S3 object for uploaded files', async () => {
    const { service, s3 } = setup();
    await service.remove(USER, 'p1');
    expect(s3.deleteObject).toHaveBeenCalledTimes(1);
  });
});
