import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { extractDocx, extractPptx } from '../office';
import { extractText, UnsupportedFileError } from '../extract-text';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

function wPara(text: string, style?: string): string {
  const pPr = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : '';
  return `<w:p>${pPr}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
}

/** DOCX tối thiểu mà mammoth đọc được: content types, rels, document, styles (tên heading). */
async function buildDocx(bodyXml: string, pages?: number): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`,
  );
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  zip.file(
    'word/_rels/document.xml.rels',
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
  );
  zip.file(
    'word/styles.xml',
    `<?xml version="1.0" encoding="UTF-8"?><w:styles ${W}><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/></w:style><w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/></w:style></w:styles>`,
  );
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body>${bodyXml}</w:body></w:document>`,
  );
  if (pages !== undefined) {
    zip.file(
      'docProps/app.xml',
      `<?xml version="1.0" encoding="UTF-8"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Pages>${pages}</Pages></Properties>`,
    );
  }
  return zip.generateAsync({ type: 'nodebuffer' });
}

const P = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
const R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

function shape(paragraphs: string[], placeholder?: string): string {
  const ph = placeholder ? `<p:nvPr><p:ph type="${placeholder}"/></p:nvPr>` : '<p:nvPr/>';
  const body = paragraphs
    .map((t) => `<a:p><a:r><a:rPr lang="vi-VN"/><a:t>${t}</a:t></a:r></a:p>`)
    .join('');
  return `<p:sp><p:nvSpPr><p:cNvPr id="1" name="s"/><p:cNvSpPr/>${ph}</p:nvSpPr><p:txBody>${body}</p:txBody></p:sp>`;
}

/** PPTX tối thiểu: thứ tự slide lấy từ presentation.xml + rels, cố ý đảo tên file để kiểm. */
async function buildPptx(slides: string[][]): Promise<Buffer> {
  const zip = new JSZip();
  const ids = slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`).join('');
  zip.file(
    'ppt/presentation.xml',
    `<?xml version="1.0" encoding="UTF-8"?><p:presentation ${P} ${R}><p:sldIdLst>${ids}</p:sldIdLst></p:presentation>`,
  );
  // Slide thứ i trong trình chiếu nằm ở file slide{n-i}.xml — thứ tự file ≠ thứ tự trình chiếu.
  const n = slides.length;
  const rels = slides
    .map(
      (_, i) =>
        `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${n - i}.xml"/>`,
    )
    .join('');
  zip.file(
    'ppt/_rels/presentation.xml.rels',
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`,
  );
  slides.forEach((shapes, i) => {
    zip.file(
      `ppt/slides/slide${n - i}.xml`,
      `<?xml version="1.0" encoding="UTF-8"?><p:sld ${P} ${A} ${R}><p:cSld><p:spTree>${shapes.join('')}</p:spTree></p:cSld></p:sld>`,
    );
  });
  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('extractDocx', () => {
  it('heading Word thành heading Markdown, đoạn văn giữ nguyên, ký tự đặc biệt giải mã', async () => {
    const bytes = await buildDocx(
      [
        wPara('Nhập môn HTTP', 'Heading1'),
        wPara('HTTP là giao thức &amp; nền tảng của web.'),
        wPara('Phương thức', 'Heading2'),
        wPara('GET dùng để đọc dữ liệu, với a &lt; b.'),
      ].join(''),
    );
    const result = await extractDocx(bytes);
    expect(result.pages).toHaveLength(1);
    const text = result.pages[0]?.text ?? '';
    expect(text).toContain('# Nhập môn HTTP');
    expect(text).toContain('## Phương thức');
    expect(text).toContain('HTTP là giao thức & nền tảng của web.');
    expect(text).toContain('a < b');
    expect(text).not.toMatch(/<\/?p>/);
  });

  // Word (và python-docx `add_heading(level=0)`) đặt tên tài liệu bằng style "Title", không phải
  // "Heading 1". Mammoth mặc định không coi Title là heading: tên tài liệu rơi vào một chunk
  // "(không heading)" và các mục bên dưới không còn chung một chương.
  it('style Title thành heading cấp 1, Heading 1 lùi xuống cấp 2', async () => {
    const bytes = await buildDocx(
      [
        wPara('Mạng máy tính', 'Title'),
        wPara('Tài liệu nhập môn.', 'Subtitle'),
        wPara('1. Địa chỉ IP', 'Heading1'),
        wPara('IPv4 dài 32 bit.'),
      ].join(''),
    );
    const text = (await extractDocx(bytes)).pages[0]?.text ?? '';
    expect(text).toContain('# Mạng máy tính');
    expect(text).toContain('## 1. Địa chỉ IP');
    expect(text).toContain('Tài liệu nhập môn.');
    expect(text).not.toContain('# Tài liệu nhập môn.');
  });

  it('tài liệu không dùng Title thì Heading 1 vẫn là cấp 1', async () => {
    const text = (await extractDocx(await buildDocx(wPara('Chương 1', 'Heading1')))).pages[0]?.text;
    expect(text).toContain('# Chương 1');
    expect(text).not.toContain('## Chương 1');
  });

  it('số trang lấy từ docProps/app.xml nếu có (để áp hạn mức trang)', async () => {
    expect((await extractDocx(await buildDocx(wPara('Nội dung'), 12))).pageCount).toBe(12);
    expect((await extractDocx(await buildDocx(wPara('Nội dung')))).pageCount).toBeNull();
  });
});

describe('extractPptx', () => {
  it('mỗi slide một trang, theo thứ tự trình chiếu; tiêu đề slide thành heading', async () => {
    const bytes = await buildPptx([
      [shape(['Nhập môn HTTP'], 'ctrTitle'), shape(['Bài giảng tuần 1'], 'subTitle')],
      [shape(['Phương thức'], 'title'), shape(['GET đọc dữ liệu', 'POST gửi dữ liệu'])],
      [shape(['Mã trạng thái'], 'title'), shape(['200 OK', '404 Not Found'])],
    ]);
    const result = await extractPptx(bytes);
    expect(result.pageCount).toBe(3);
    expect(result.pages.map((p) => p.pageNumber)).toEqual([1, 2, 3]);
    expect(result.pages[0]?.text).toMatch(/^# Nhập môn HTTP/);
    expect(result.pages[1]?.text).toMatch(/^## Phương thức/);
    expect(result.pages[1]?.text).toContain('GET đọc dữ liệu\nPOST gửi dữ liệu');
    expect(result.pages[2]?.text).toContain('404 Not Found');
  });
});

describe('extractText — định dạng Office', () => {
  it('DOCX qua cổng chung', async () => {
    const bytes = await buildDocx(wPara('Xin chào', 'Heading1'));
    const result = await extractText(bytes, DOCX_MIME);
    expect(result.pages[0]?.text).toContain('# Xin chào');
  });

  it('file không phải ZIP khai là DOCX → từ chối (magic bytes)', async () => {
    await expect(extractText(Buffer.from('không phải zip'), DOCX_MIME)).rejects.toBeInstanceOf(
      UnsupportedFileError,
    );
  });

  it('ZIP hợp lệ nhưng không phải PPTX → từ chối', async () => {
    const zip = new JSZip();
    zip.file('a.txt', 'x');
    const bytes = await zip.generateAsync({ type: 'nodebuffer' });
    await expect(extractText(bytes, PPTX_MIME)).rejects.toBeInstanceOf(UnsupportedFileError);
  });
});
