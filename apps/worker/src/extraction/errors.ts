export class UnsupportedFileError extends Error {
  constructor(mimeType: string) {
    super(`Định dạng tài liệu không được hỗ trợ: ${mimeType}`);
    this.name = 'UnsupportedFileError';
  }
}

export class ScannedPdfNotSupportedError extends Error {
  constructor() {
    super('Tài liệu là PDF scan (không có lớp text) — máy chủ này chưa cài OCR.');
    this.name = 'ScannedPdfNotSupportedError';
  }
}

export class DocumentTooShortError extends Error {
  constructor() {
    super('Tài liệu có quá ít nội dung để tạo bài học. Hãy tải lên tài liệu dài hơn.');
    this.name = 'DocumentTooShortError';
  }
}

export interface ExtractedPage {
  pageNumber: number;
  text: string;
}

export interface ExtractResult {
  pages: ExtractedPage[];
  pageCount: number | null;
}
