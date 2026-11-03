import { describe, it, expect } from 'vitest';
import { sanitizeMarkdown } from '../validator/sanitize-markdown';

/**
 * Tầng 4 trước đây chạy `sanitize-html` lên Markdown: nó coi mọi thứ là HTML nên escape `<`,
 * `>`, `&` và xoá `<String>` như một thẻ. Code trong bài học hỏng (`Map<string, number>` thành
 * `Map`), blockquote `>` thành `&gt;`. Các test dưới đây ghim hành vi đúng.
 */
describe('sanitizeMarkdown — giữ nguyên nội dung hợp lệ', () => {
  it('code fence giữ nguyên từng ký tự, kể cả thứ trông như thẻ HTML', () => {
    const md = [
      '```ts',
      'const m = new Map<string, number>();',
      'if (a < b && c > d) {}',
      '<script>chỉ là chữ trong code</script>',
      '```',
    ].join('\n');
    expect(sanitizeMarkdown(md)).toBe(md);
  });

  it('fence bằng dấu ~ cũng được bảo vệ', () => {
    const md = '~~~\nList<String> xs;\n~~~';
    expect(sanitizeMarkdown(md)).toBe(md);
  });

  it('inline code giữ nguyên', () => {
    const md = 'Khai báo `List<String>` và `a && b`.';
    expect(sanitizeMarkdown(md)).toBe(md);
  });

  it('so sánh và ký hiệu trong văn bản thường không bị escape', () => {
    const md = 'Nếu a < b và c > d thì R&D tăng 5%.';
    expect(sanitizeMarkdown(md)).toBe(md);
  });

  it('blockquote đầu dòng giữ nguyên', () => {
    const md = '> Trích dẫn quan trọng\n> dòng hai';
    expect(sanitizeMarkdown(md)).toBe(md);
  });

  it('link http/https/mailto giữ nguyên', () => {
    const md = '[MDN](https://developer.mozilla.org) và [thư](mailto:a@b.c)';
    expect(sanitizeMarkdown(md)).toBe(md);
  });
});

describe('sanitizeMarkdown — loại bỏ nội dung nguy hiểm', () => {
  it('xoá khối script cả nội dung bên trong', () => {
    expect(sanitizeMarkdown('Trước<script>alert(1)</script>Sau')).toBe('TrướcSau');
  });

  it('xoá style/iframe/object/embed cả nội dung', () => {
    expect(sanitizeMarkdown('a<style>body{}</style>b<iframe src="x"></iframe>c')).toBe('abc');
  });

  it('xoá thẻ HTML thô nhưng giữ chữ bên trong', () => {
    expect(sanitizeMarkdown('<div onclick="x()">xin chào</div>')).toBe('xin chào');
  });

  it('xoá thẻ tự đóng và comment HTML', () => {
    expect(sanitizeMarkdown('a<img src=x onerror=alert(1)>b<!-- ẩn -->c')).toBe('abc');
  });

  it.each(['javascript:alert(1)', 'JavaScript:alert(1)', 'data:text/html,x', 'vbscript:x'])(
    'vô hiệu link %s',
    (href) => {
      expect(sanitizeMarkdown(`[bấm](${href})`)).toBe('[bấm](#)');
    },
  );

  it('script ngoài code vẫn bị xoá khi cùng bài có code fence', () => {
    const md = '```\n<b>x</b>\n```\n<script>x</script>xong';
    expect(sanitizeMarkdown(md)).toBe('```\n<b>x</b>\n```\nxong');
  });

  it('chuẩn hoá CRLF', () => {
    expect(sanitizeMarkdown('a\r\nb')).toBe('a\nb');
  });
});
