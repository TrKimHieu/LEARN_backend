import { describe, it, expect } from 'vitest';
import { DOCUMENT_ACCEPT, mimeFromFilename, resolveUploadMime } from '../document-types';

describe('mimeFromFilename', () => {
  it.each([
    ['bai-giang.pdf', 'application/pdf'],
    ['ghi-chu.md', 'text/markdown'],
    ['GHI-CHU.MD', 'text/markdown'],
    ['tom-tat.txt', 'text/plain'],
    ['v1.2.final.Md', 'text/markdown'],
    ['bao-cao.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['slide.PPTX', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  ])('%s → %s', (name, mime) => {
    expect(mimeFromFilename(name)).toBe(mime);
  });

  // .doc/.ppt đời cũ là định dạng nhị phân khác hẳn, chưa trích xuất được.
  it.each(['khong-duoi', 'virus.exe', '.md.exe', 'anh.png', '', 'cu.doc', 'cu.ppt'])(
    '%s → null',
    (name) => {
      expect(mimeFromFilename(name)).toBeNull();
    },
  );
});

describe('resolveUploadMime', () => {
  // Lỗi thật: Chrome trên Windows trả `file.type` rỗng cho .md, web gửi
  // `application/octet-stream`, API trả 415 và người dùng không tải được Markdown.
  it('.md khai rỗng hoặc octet-stream → nhận, MIME theo đuôi', () => {
    expect(resolveUploadMime('a.md', '')).toEqual({ ok: true, mime: 'text/markdown' });
    expect(resolveUploadMime('a.md', 'application/octet-stream')).toEqual({
      ok: true,
      mime: 'text/markdown',
    });
  });

  it('MIME khai khớp đuôi → nhận', () => {
    expect(resolveUploadMime('a.pdf', 'application/pdf')).toEqual({
      ok: true,
      mime: 'application/pdf',
    });
  });

  // Một số trình duyệt khai .md là text/plain hoặc text/x-markdown: cùng họ văn bản, vẫn nhận.
  it('.md khai text/plain hoặc text/x-markdown → nhận', () => {
    expect(resolveUploadMime('a.md', 'text/plain').ok).toBe(true);
    expect(resolveUploadMime('a.md', 'text/x-markdown').ok).toBe(true);
  });

  it('MIME khai mâu thuẫn với đuôi → từ chối', () => {
    expect(resolveUploadMime('a.md', 'application/pdf').ok).toBe(false);
    expect(resolveUploadMime('a.pdf', 'text/plain').ok).toBe(false);
  });

  it('đuôi không hỗ trợ → từ chối dù khai MIME hợp lệ', () => {
    expect(resolveUploadMime('a.exe', 'application/pdf').ok).toBe(false);
    expect(resolveUploadMime('a', 'text/plain').ok).toBe(false);
  });
});

describe('DOCUMENT_ACCEPT', () => {
  it('liệt kê đúng các đuôi được hỗ trợ cho thuộc tính accept', () => {
    expect(DOCUMENT_ACCEPT.split(',')).toEqual(
      expect.arrayContaining(['.pdf', '.txt', '.md', '.docx', '.pptx']),
    );
  });
});
