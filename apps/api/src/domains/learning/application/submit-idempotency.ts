import { createHash } from 'node:crypto';
import type { SubmitExerciseInput } from '@learn/contracts';
import { ApiError } from '../../../core/exceptions/errors';

/**
 * `Idempotency-Key` cho `POST /lessons/:lessonId/exercise/submit`.
 *
 * App mobile xếp lượt nộp vào hàng chờ khi mất mạng rồi gửi lại; mạng chập chờn có thể làm cùng
 * một lượt tới server hai lần. Cùng người dùng + cùng key thì trả lại đúng kết quả lần đầu, không
 * chấm lại, không tạo Submission mới. Không có header thì giữ hành vi cũ.
 */
const KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

export function parseIdempotencyKey(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string' || !KEY_PATTERN.test(raw)) {
    throw ApiError.badRequest('Idempotency-Key phải gồm 8–128 ký tự chữ, số, "-" hoặc "_".');
  }
  return raw;
}

/** JSON với khoá sắp xếp — hai body cùng nội dung nhưng khác thứ tự khoá cho cùng một chuỗi. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Dấu vân tay của lượt nộp, để phát hiện cùng key nhưng nội dung khác. Thứ tự câu trả lời không tính. */
export function submissionFingerprint(lessonId: string, input: SubmitExerciseInput): string {
  const answers = [...input.answers].sort((a, b) =>
    a.questionId < b.questionId ? -1 : a.questionId > b.questionId ? 1 : 0,
  );
  return createHash('sha256')
    .update(stableStringify({ lessonId, ...input, answers }))
    .digest('hex');
}

/** Prisma P2002 trên ràng buộc `(userId, idempotencyKey)` — khác với đụng `attemptNo`. */
export function isIdempotencyKeyViolation(e: unknown): boolean {
  if (!e || typeof e !== 'object' || (e as { code?: unknown }).code !== 'P2002') return false;
  const target = (e as { meta?: { target?: unknown } }).meta?.target;
  return JSON.stringify(target ?? '').includes('idempotencyKey');
}

export function idempotencyKeyReused(): ApiError {
  return new ApiError(409, 'CONFLICT', 'Idempotency-Key đã dùng cho một lượt nộp khác.', {
    reason: 'IDEMPOTENCY_KEY_REUSED',
  });
}
