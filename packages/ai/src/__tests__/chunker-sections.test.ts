import { describe, it, expect } from 'vitest';
import { chunkPages, detectHeading, type DocumentChunk } from '../chunker';

function at<T>(arr: readonly T[], index: number): T {
  const value = arr[index];
  if (value === undefined) throw new Error(`Không có phần tử ở vị trí ${index}`);
  return value;
}

/** Một đoạn văn ~n token (4 ký tự ≈ 1 token). */
const para = (label: string, tokens = 150) =>
  `${label}: ${'nội dung học tập '.repeat(Math.ceil((tokens * 4) / 17))}`.trim() + '.';

const paths = (chunks: DocumentChunk[]) => chunks.map((c) => c.headingPath ?? null);

describe('detectHeading', () => {
  it.each([
    ['# Giới thiệu', 1, 'Giới thiệu'],
    ['### 2.1 Giao thức', 3, '2.1 Giao thức'],
    ['## Tiêu đề ##', 2, 'Tiêu đề'],
    ['Chương 2: Mạng máy tính', 1, 'Chương 2: Mạng máy tính'],
    ['CHƯƠNG IV. TỔNG KẾT', 1, 'CHƯƠNG IV. TỔNG KẾT'],
    ['Chapter 3 Networking', 1, 'Chapter 3 Networking'],
    ['Bài 5: Vòng lặp', 2, 'Bài 5: Vòng lặp'],
    ['2.1 Giao thức HTTP', 2, '2.1 Giao thức HTTP'],
    ['3.2.1. Mã trạng thái', 3, '3.2.1. Mã trạng thái'],
  ])('%s → cấp %i', (line, level, text) => {
    expect(detectHeading(line)).toEqual({ level, text });
  });

  it.each([
    'Đây là một câu bình thường.',
    '1. Mở trình duyệt',
    '2.1 là phiên bản được dùng rộng rãi nhất hiện nay, vì nó ổn định.',
    'Chương 2 trình bày các khái niệm cơ bản về mạng máy tính và giao thức truyền tải.',
    '#hashtag không phải heading',
    '',
  ])('không phải heading: %s', (line) => {
    expect(detectHeading(line)).toBeNull();
  });
});

describe('chunkPages — ranh giới theo heading', () => {
  it('mỗi mục thành chunk riêng, headingPath theo cấp', () => {
    const text = [
      '# Nhập môn HTTP',
      '',
      para('mở đầu'),
      '',
      '## Phương thức',
      '',
      para('phương thức'),
      '',
      '## Mã trạng thái',
      '',
      para('mã trạng thái'),
    ].join('\n');
    const chunks = chunkPages([{ pageNumber: 1, text }]);
    expect(paths(chunks)).toEqual([
      'Nhập môn HTTP',
      'Nhập môn HTTP > Phương thức',
      'Nhập môn HTTP > Mã trạng thái',
    ]);
    expect(at(chunks, 1).content).toContain('phương thức:');
    expect(at(chunks, 1).content).not.toContain('mã trạng thái:');
  });

  it('dòng heading nằm trong nội dung chunk đầu của mục (outline nhìn thấy tiêu đề)', () => {
    const text = `## Cookie\n\n${para('cookie')}`;
    const chunks = chunkPages([{ pageNumber: 1, text }]);
    expect(at(chunks, 0).content.startsWith('## Cookie')).toBe(true);
  });

  it('heading ngay sau heading không sinh chunk rỗng', () => {
    const text = ['# Chương 1', '## 1.1 Khái niệm', '', para('khái niệm')].join('\n');
    const chunks = chunkPages([{ pageNumber: 1, text }]);
    expect(chunks).toHaveLength(1);
    expect(at(chunks, 0).headingPath).toBe('Chương 1 > 1.1 Khái niệm');
  });

  it('heading cấp cao hơn đóng mục con', () => {
    const text = ['# A', '## A1', para('a1'), '# B', para('b')].join('\n\n');
    expect(paths(chunkPages([{ pageNumber: 1, text }]))).toEqual(['A > A1', 'B']);
  });

  it('ngăn xếp heading mang qua trang, pageFrom/pageTo đúng trang', () => {
    const chunks = chunkPages([
      { pageNumber: 1, text: `# Bộ nhớ đệm\n\n${para('trang một', 60)}` },
      { pageNumber: 2, text: para('trang hai', 60) },
      { pageNumber: 3, text: `## Cache-Control\n\n${para('trang ba')}` },
    ]);
    expect(at(chunks, 0).headingPath).toBe('Bộ nhớ đệm');
    expect(at(chunks, 0).pageFrom).toBe(1);
    expect(at(chunks, 0).pageTo).toBe(2);
    expect(at(chunks, 0).content).toContain('trang hai');
    expect(at(chunks, 1).headingPath).toBe('Bộ nhớ đệm > Cache-Control');
    expect(at(chunks, 1).pageFrom).toBe(3);
  });

  it('dấu # trong code fence không phải heading', () => {
    const text = [
      '# Cài đặt',
      '',
      para('cài đặt'),
      '',
      '```bash',
      '# cài gói',
      'npm install',
      '```',
    ].join('\n');
    const chunks = chunkPages([{ pageNumber: 1, text }]);
    expect(paths(chunks)).toEqual(['Cài đặt']);
    expect(at(chunks, 0).content).toContain('# cài gói');
  });

  it('mục dài vẫn cắt theo targetTokens, mọi mảnh giữ headingPath', () => {
    const body = Array.from({ length: 12 }, (_, i) => para(`đoạn ${i}`, 180)).join('\n\n');
    const chunks = chunkPages([{ pageNumber: 1, text: `# Dài\n\n${body}` }]);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    for (const c of chunks) {
      expect(c.headingPath).toBe('Dài');
      expect(c.tokenCount).toBeLessThanOrEqual(1200 + 200);
    }
  });

  it('mục rất nhỏ gộp vào chunk trước cùng chương, không gộp sang chương khác', () => {
    const text = [
      '# Chương 1',
      para('lớn', 300),
      '## Ghi chú',
      'Ngắn thôi.',
      '# Chương 2',
      'Cũng ngắn.',
    ].join('\n\n');
    const chunks = chunkPages([{ pageNumber: 1, text }]);
    expect(paths(chunks)).toEqual(['Chương 1', 'Chương 2']);
    expect(at(chunks, 0).content).toContain('## Ghi chú');
    expect(at(chunks, 1).content).toContain('Cũng ngắn.');
  });

  it('tài liệu không có heading: headingPath null, cắt như trước', () => {
    const text = Array.from({ length: 10 }, (_, i) => para(`đoạn ${i}`, 200)).join('\n\n');
    const chunks = chunkPages([{ pageNumber: 1, text }]);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks.every((c) => c.headingPath === undefined)).toBe(true);
  });

  it('index liên tục 0..n-1 trên toàn tài liệu', () => {
    const chunks = chunkPages([
      { pageNumber: 1, text: `# A\n\n${para('a')}\n\n# B\n\n${para('b')}` },
      { pageNumber: 2, text: `# C\n\n${para('c')}` },
    ]);
    chunks.forEach((c, i) => expect(c.index).toBe(i));
  });

  it('trang rỗng và tài liệu rỗng', () => {
    expect(chunkPages([])).toEqual([]);
    expect(chunkPages([{ pageNumber: 1, text: '   ' }])).toEqual([]);
  });

  // Tài liệu thật (DocsTest, 2026-09-28): "# Tiêu đề" + một câu giới thiệu ~30 token đứng thành
  // chunk riêng, rồi thành một "bài học" rỗng. Phần mở đầu ngắn phải đi cùng mục con ngay sau nó.
  it('mở đầu ngắn không có chunk trước → nhập vào mục kế tiếp cùng chương', () => {
    const text = ['# Git cơ bản', 'Tài liệu giới thiệu Git.', '## 1. Git là gì', para('git')].join(
      '\n\n',
    );
    const chunks = chunkPages([{ pageNumber: 1, text }]);
    expect(chunks).toHaveLength(1);
    expect(at(chunks, 0).headingPath).toBe('Git cơ bản > 1. Git là gì');
    expect(at(chunks, 0).content).toContain('Tài liệu giới thiệu Git.');
    expect(at(chunks, 0).content.startsWith('# Git cơ bản')).toBe(true);
  });

  it('lời mở đầu cấp chương dưới minTokens (~70 token) vẫn đi cùng mục con đầu tiên', () => {
    const text = ['# Git cơ bản', para('mở đầu', 70), '## 1. Git là gì', para('git')].join('\n\n');
    const chunks = chunkPages([{ pageNumber: 1, text }]);
    expect(paths(chunks)).toEqual(['Git cơ bản > 1. Git là gì']);
    expect(at(chunks, 0).content).toContain('mở đầu:');
  });

  it('mở đầu ngắn mà mục sau thuộc chương khác → vẫn giữ thành chunk riêng, không mất', () => {
    const text = ['# A', 'Ngắn.', '# B', para('b')].join('\n\n');
    const chunks = chunkPages([{ pageNumber: 1, text }]);
    expect(paths(chunks)).toEqual(['A', 'B']);
    expect(at(chunks, 0).content).toContain('Ngắn.');
  });

  // Mục "2. Câu lệnh điều kiện" (~90 token kể cả code) từng bị nhập vào mục 1 vì ngưỡng gộp
  // 100 token dành cho mảnh vụn của văn bản không heading — dàn bài không còn thấy mục đó.
  it('mục có heading và nội dung thật (~80 token) giữ chunk riêng', () => {
    const text = [
      '# Python',
      '## 1. Biến',
      para('biến', 150),
      '## 2. Điều kiện',
      para('if', 80),
    ].join('\n\n');
    expect(paths(chunkPages([{ pageNumber: 1, text }]))).toEqual([
      'Python > 1. Biến',
      'Python > 2. Điều kiện',
    ]);
  });
});
