export class UnsupportedFileError extends Error {
  constructor(mimeType: string) {
    super(`Định dạng tài liệu không được hỗ trợ: ${mimeType}`);
    this.name = 'UnsupportedFileError';
  }
}

export class ScannedPdfNotSupportedError extends Error {
  constructor() {
    super('Tài liệu là PDF scan (không có lớp text) — OCR chưa được hỗ trợ ở phiên bản này.');
    this.name = 'ScannedPdfNotSupportedError';
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
