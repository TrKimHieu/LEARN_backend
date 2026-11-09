import { ApiError } from '../../../core/exceptions/errors';

/**
 * `Idempotency-Key` cho `POST /reviews/:questionId`. Cùng quy ước với
 * `learning/application/submit-idempotency.ts` (định dạng khoá, P2002 trên `(userId, idempotencyKey)`,
 * 409 `IDEMPOTENCY_KEY_REUSED`); viết lại ở đây vì luật `boundary/no-cross-module-import`
 * không cho domain này import file nội bộ của `learning`.
 */
const KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

export function parseIdempotencyKey(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string' || !KEY_PATTERN.test(raw)) {
    throw ApiError.badRequest('Idempotency-Key phải gồm 8–128 ký tự chữ, số, "-" hoặc "_".');
  }
  return raw;
}

/** Prisma P2002 trên ràng buộc `(userId, idempotencyKey)`. */
export function isIdempotencyKeyViolation(e: unknown): boolean {
  if (!e || typeof e !== 'object' || (e as { code?: unknown }).code !== 'P2002') return false;
  const target = (e as { meta?: { target?: unknown } }).meta?.target;
  return JSON.stringify(target ?? '').includes('idempotencyKey');
}

export function idempotencyKeyReused(): ApiError {
  return new ApiError(409, 'CONFLICT', 'Idempotency-Key đã dùng cho một lượt chấm khác.', {
    reason: 'IDEMPOTENCY_KEY_REUSED',
  });
}
