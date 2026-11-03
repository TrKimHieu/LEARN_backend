import { describe, it, expect } from 'vitest';
import { estimateTokens, chunkDocument } from '../chunker';

/**
 * Truy cập phần tử bắt buộc phải có. `noUncheckedIndexedAccess` khiến `arr[0]` có kiểu
 * `T | undefined`, và với union phân biệt thì `undefined` còn chặn luôn việc thu hẹp kiểu
 * theo `q.type`. Ném lỗi ngay tại chỗ cho thông báo rõ hơn là để `undefined` lan xuống.
 */
function at<T>(arr: readonly T[], index: number): T {
  const value = arr[index];
  if (value === undefined) throw new Error(`Không có phần tử ở vị trí ${index}`);
  return value;
}

describe('estimateTokens', () => {
  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('uses heuristic 4 chars ≈ 1 token', () => {
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcdefgh')).toBe(2);
  });

  it('rounds up for non-divisible lengths', () => {
    expect(estimateTokens('abc')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
  });

  it('trims whitespace before counting', () => {
    expect(estimateTokens('  abcd  ')).toBe(1);
  });
});

describe('chunkDocument', () => {
  const meta = { pageFrom: 1, headingPath: 'Ch.1 Intro' };

  it('returns empty array for blank input', () => {
    expect(chunkDocument('   ', meta)).toEqual([]);
  });

  it('single paragraph within target → one chunk', () => {
    const text = 'Học phần một. '.repeat(50); // ~700 tokens
    const chunks = chunkDocument(text, meta);
    expect(chunks).toHaveLength(1);
    expect(at(chunks, 0).index).toBe(0);
    expect(at(chunks, 0).pageFrom).toBe(1);
    expect(at(chunks, 0).headingPath).toBe('Ch.1 Intro');
    expect(at(chunks, 0).tokenCount).toBeGreaterThan(0);
  });

  it('large text splits into multiple chunks', () => {
    // ~3000 tokens (12000 chars)
    const text = 'Đây là nội dung tài liệu học tập rất dài. '.repeat(200);
    const chunks = chunkDocument(text, meta);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    // Indexes are sequential
    chunks.forEach((c, i) => expect(c.index).toBe(i));
  });

  it('small trailing chunk is merged into previous (minTokens rule)', () => {
    // Two big paragraphs + one tiny paragraph
    const big = 'Nội dung chính '.repeat(100); // ~400 tokens
    const tiny = 'Ghi chú ngắn'; // ~4 tokens < minTokens
    const text = `${big}\n\n${big}\n\n${tiny}`;
    const chunks = chunkDocument(text, meta);
    // Tiny chunk should have been merged; second chunk content contains the tiny text
    const lastContent = chunks.at(-1)!.content;
    expect(lastContent).toContain('Ghi chú ngắn');
  });

  it('custom options override defaults', () => {
    const text = 'Một đoạn văn bản dài. '.repeat(150); // ~500 tokens
    const smallOpts = { targetTokens: 200, overlapTokens: 50, minTokens: 30 };
    const chunks = chunkDocument(text, meta, smallOpts);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    for (const c of chunks) {
      // Each chunk should be ≤ target + some margin for merged content
      expect(c.tokenCount).toBeLessThanOrEqual(200 + 50);
    }
  });

  it('overlap preserves context between chunks', () => {
    const text = Array.from(
      { length: 30 },
      (_, i) => `Đoạn ${i + 1}: ${'nội dung '.repeat(30)}`,
    ).join('\n\n');
    const chunks = chunkDocument(text, meta);
    if (chunks.length >= 2) {
      // The second chunk should start with content from the end of the first
      const tail = at(chunks, 0).content.slice(-200);
      expect(at(chunks, 1).content).toContain(tail.trim().slice(0, 50));
    }
  });
});
