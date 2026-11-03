import { describe, it, expect } from 'vitest';
import { layoutPdfPages, type PdfTextItem } from '../pdf-layout';

/**
 * Bản trước nối mọi mẩu chữ của trang bằng dấu cách rồi gộp mọi khoảng trắng: cả trang thành
 * MỘT dòng, mất hết ranh giới đoạn và heading. Chunker không thể nhận ra mục nào.
 */

/** Dựng một dòng chữ ở toạ độ y với cỡ chữ size, bắt đầu tại x = 72. */
function line(str: string, y: number, size = 11): PdfTextItem[] {
  return [
    { str, x: 72, y, width: str.length * size * 0.5, height: size, hasEOL: false },
    { str: '', x: 72 + str.length * size * 0.5, y, width: 0, height: 0, hasEOL: true },
  ];
}

describe('layoutPdfPages', () => {
  it('giữ xuống dòng, tách đoạn theo khoảng trống dọc', () => {
    const [page] = layoutPdfPages([
      [
        ...line('Dòng một của đoạn đầu', 700),
        ...line('dòng hai của đoạn đầu.', 686),
        // khoảng trống lớn → đoạn mới
        ...line('Đoạn thứ hai bắt đầu ở đây.', 650),
      ],
    ]);
    expect(page).toBe(
      'Dòng một của đoạn đầu\ndòng hai của đoạn đầu.\n\nĐoạn thứ hai bắt đầu ở đây.',
    );
  });

  it('dòng cỡ chữ lớn thành heading Markdown, cấp theo thứ hạng cỡ chữ', () => {
    const body = (y: number) => line('Nội dung bình thường của tài liệu học tập.', y);
    const [page] = layoutPdfPages([
      [
        ...line('Nhập môn HTTP', 760, 20),
        ...body(730),
        ...body(716),
        ...line('Phương thức yêu cầu', 690, 15),
        ...body(665),
        ...body(651),
        ...body(637),
      ],
    ]);
    expect(page).toContain('# Nhập môn HTTP');
    expect(page).toContain('## Phương thức yêu cầu');
    expect(page).not.toContain('# Nội dung');
  });

  it('cỡ chữ thân bài tính trên cả tài liệu, không theo từng trang', () => {
    const pages = layoutPdfPages([
      [...line('Chương lớn', 760, 18), ...line('Thân bài trang một.', 730)],
      [...line('Thân bài trang hai.', 760), ...line('Thêm thân bài.', 746)],
    ]);
    expect(pages[0]).toContain('# Chương lớn');
    expect(pages[1]).not.toContain('#');
  });

  it('heading xuống hai dòng cùng cỡ chữ gộp thành một heading', () => {
    const [page] = layoutPdfPages([
      [
        ...line('Giao thức truyền tải', 760, 18),
        ...line('siêu văn bản', 740, 18),
        ...line('Thân bài đủ dài để làm cỡ chữ chuẩn của tài liệu.', 710),
        ...line('Thân bài đủ dài để làm cỡ chữ chuẩn của tài liệu.', 696),
      ],
    ]);
    expect(page).toContain('# Giao thức truyền tải siêu văn bản');
  });

  it('dòng chữ lớn kết thúc bằng dấu chấm không phải heading (trích dẫn to)', () => {
    const [page] = layoutPdfPages([
      [
        ...line('Đây là một câu được in to.', 760, 18),
        ...line('Thân bài bình thường của tài liệu học tập.', 730),
        ...line('Thân bài bình thường của tài liệu học tập.', 716),
      ],
    ]);
    expect(page).not.toContain('#');
  });

  it('mẩu chữ rời trên cùng dòng được nối, có dấu cách khi có khoảng hở', () => {
    const items: PdfTextItem[] = [
      { str: 'Mã', x: 72, y: 700, width: 12, height: 11, hasEOL: false },
      { str: '200', x: 88, y: 700, width: 18, height: 11, hasEOL: false },
      { str: 'OK', x: 106, y: 700, width: 14, height: 11, hasEOL: true },
    ];
    expect(layoutPdfPages([items])[0]).toBe('Mã 200OK');
  });

  it('trang không có chữ → chuỗi rỗng', () => {
    expect(layoutPdfPages([[]])).toEqual(['']);
  });
});
