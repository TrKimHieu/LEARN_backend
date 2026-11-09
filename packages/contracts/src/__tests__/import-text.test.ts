import { describe, expect, it } from 'vitest';
import { importTextDocumentSchema, importTextLimits } from '../document';

const base = {
  filename: 'giao-trinh.pdf',
  sourceMimeType: 'application/pdf',
  sourceSizeBytes: 1024,
  method: 'PDF_TEXT' as const,
  pages: [{ page: 1, text: 'Chương 1' }],
};

describe('importTextDocumentSchema', () => {
  it('accepts per-page text extracted on the device', () => {
    expect(importTextDocumentSchema.parse(base)).toEqual(base);
  });
  it('accepts unpaged plain text', () => {
    const r = importTextDocumentSchema.safeParse({
      ...base,
      method: 'TEXT',
      pages: [{ page: null, text: 'x' }],
    });
    expect(r.success).toBe(true);
  });
  it('rejects unknown keys so raw files cannot ride along', () => {
    expect(importTextDocumentSchema.safeParse({ ...base, fileBase64: 'AAAA' }).success).toBe(false);
    expect(
      importTextDocumentSchema.safeParse({
        ...base,
        pages: [{ page: 1, text: 'x', image: 'data:' }],
      }).success,
    ).toBe(false);
  });
  it('enforces the page and size limits', () => {
    const pages = Array.from({ length: importTextLimits.maxPages + 1 }, (_, i) => ({
      page: i + 1,
      text: 'x',
    }));
    expect(importTextDocumentSchema.safeParse({ ...base, pages }).success).toBe(false);
    expect(importTextDocumentSchema.safeParse({ ...base, pages: [] }).success).toBe(false);
    expect(importTextDocumentSchema.safeParse({ ...base, sourceSizeBytes: 26214401 }).success).toBe(
      false,
    );
    expect(
      importTextDocumentSchema.safeParse({
        ...base,
        pages: [{ page: 1, text: 'x'.repeat(importTextLimits.maxCharsPerPage + 1) }],
      }).success,
    ).toBe(false);
  });
});
