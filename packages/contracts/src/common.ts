import { z } from 'zod';

/** Mã lỗi ổn định — HANDBOOK §7.3. Frontend so khớp bằng `code`, không bằng `detail`. */
export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_FILE_TYPE',
  'QUOTA_EXCEEDED',
  'RATE_LIMITED',
  'AI_GENERATION_FAILED',
  'AI_GENERATION_TIMEOUT',
  'UPSTREAM_UNAVAILABLE',
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const errorSchema = z.object({
  type: z.string().url().or(z.string()),
  title: z.string(),
  status: z.number().int(),
  code: z.enum(ERROR_CODES),
  detail: z.string(),
  requestId: z.string().optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
});

export const cursorPaginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
  sort: z.string().default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

export const paginatedSchema = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
  });

export const idParamSchema = z.object({ id: z.string().uuid('uuid7') });

export const requestIdSchema = z.string().min(1).max(64);
