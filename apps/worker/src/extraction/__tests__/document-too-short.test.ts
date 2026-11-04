import { describe, expect, it } from 'vitest';
import { assertEnoughText, DocumentTooShortError, MIN_DOCUMENT_CHARS } from '../extract-text';

const pages = (...texts: string[]) => ({
  pageCount: texts.length,
  pages: texts.map((text, i) => ({ pageNumber: i + 1, text })),
});

describe('assertEnoughText', () => {
  it('từ chối tài liệu gần như không có chữ', () => {
    expect(() => assertEnoughText(pages('ngan'))).toThrow(DocumentTooShortError);
  });

  it('không đếm khoảng trắng', () => {
    expect(() => assertEnoughText(pages(' '.repeat(MIN_DOCUMENT_CHARS * 2)))).toThrow(
      DocumentTooShortError,
    );
  });

  it('cộng chữ của mọi trang', () => {
    const half = 'a'.repeat(MIN_DOCUMENT_CHARS / 2);
    expect(() => assertEnoughText(pages(half, half))).not.toThrow();
  });
});
