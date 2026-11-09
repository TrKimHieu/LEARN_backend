import { z } from 'zod';

export const documentStatusSchema = z.enum([
  'PENDING',
  'UPLOADED',
  'EXTRACTING',
  'EXTRACTED',
  'FAILED',
]);
export type DocumentStatus = z.infer<typeof documentStatusSchema>;

export const uploadUrlSchema = z
  .object({
    filename: z.string().min(1).max(255),
    mimeType: z.string().min(1).max(100),
    sizeBytes: z.number().int().positive().max(26214400),
    checksumSha256: z.string().length(64),
  })
  .strict();

export const uploadUrlResponseSchema = z.object({
  documentId: z.string(),
  uploadUrl: z.string(),
  expiresInSec: z.number().int(),
});

export const confirmUploadSchema = z
  .object({
    sizeBytes: z.number().int().positive(),
  })
  .strict();

export const documentListSchema = z.object({
  id: z.string(),
  filename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  status: documentStatusSchema,
  pageCount: z.number().int().nullable(),
  chunkCount: z.number().int().default(0),
  errorMessage: z.string().nullable(),
  createdAt: z.string(),
});

export type UploadUrlInput = z.infer<typeof uploadUrlSchema>;
export type UploadUrlResponse = z.infer<typeof uploadUrlResponseSchema>;
export type ConfirmUploadInput = z.infer<typeof confirmUploadSchema>;
export type DocumentList = z.infer<typeof documentListSchema>;

/**
 * Nhập tài liệu từ điện thoại — app trích chữ tại máy (PDF, ảnh, văn bản) và chỉ gửi văn bản,
 * không bao giờ gửi tệp gốc. `POST /courses/:courseId/documents/text` (mobile R3).
 */
export const importTextLimits = {
  maxPages: 100,
  maxCharsPerPage: 200000,
  maxTotalChars: 2000000,
} as const;

export const importTextMethodSchema = z.enum(['TEXT', 'PDF_TEXT', 'OCR']);

export const importTextDocumentSchema = z
  .object({
    filename: z.string().min(1).max(255),
    /** Loại của tệp gốc trên máy (chỉ để hiển thị); nội dung gửi lên luôn là văn bản. */
    sourceMimeType: z.string().min(1).max(100),
    sourceSizeBytes: z.number().int().positive().max(26214400),
    method: importTextMethodSchema,
    pages: z
      .array(
        z
          .object({
            /** Số trang trong tệp gốc; `null` với văn bản không chia trang (TXT/MD). */
            page: z.number().int().positive().nullable(),
            text: z.string().max(importTextLimits.maxCharsPerPage),
          })
          .strict(),
      )
      .min(1)
      .max(importTextLimits.maxPages),
  })
  .strict();

export type ImportTextMethod = z.infer<typeof importTextMethodSchema>;
export type ImportTextDocumentInput = z.infer<typeof importTextDocumentSchema>;
