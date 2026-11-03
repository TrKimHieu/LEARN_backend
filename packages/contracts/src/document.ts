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
