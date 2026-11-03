import { describe, it, expect } from 'vitest';
import { ApiError, normalizeException, problemType } from '../errors';

/** Giả lập lỗi Prisma: filter nhận diện bằng `name`, không import runtime Prisma vào test. */
function prismaError(code: string) {
  const e = new Error(`Prisma ${code}`);
  e.name = 'PrismaClientKnownRequestError';
  Object.assign(e, { code });
  return e;
}

/** Lỗi do guard ném: Error thường được gắn `status`/`code` (xem core/security.ts). */
function guardError(status: number, code: string) {
  const e = new Error('guard');
  Object.assign(e, { status, code });
  return e;
}

describe('normalizeException — hợp đồng RFC 7807', () => {
  it('ApiError giữ nguyên status, code và meta', () => {
    const out = normalizeException(ApiError.quota(5, 5, 'COURSES_CREATED'));
    expect(out.status).toBe(402);
    expect(out.code).toBe('QUOTA_EXCEEDED');
    expect(out.meta).toEqual({ metric: 'COURSES_CREATED', limit: 5, used: 5 });
  });

  // Lỗi thật: nhánh fallback hardcode `type: '.../internal-error'` cho MỌI lỗi không phải
  // ApiError, nên 401/403/429 tự khai sai loại trong khi `code` lại đúng. `type` là định
  // danh máy đọc nên đây là sai hợp đồng API, không phải sai chính tả.
  it.each([
    [401, 'UNAUTHENTICATED'],
    [403, 'FORBIDDEN'],
    [429, 'RATE_LIMITED'],
  ] as const)('%i từ guard → type khớp code, không phải internal-error', (status, code) => {
    const out = normalizeException(guardError(status, code));
    expect(out.code).toBe(code);
    expect(problemType(out.code)).toBe(`https://learn.ai/errors/${code.toLowerCase()}`);
    expect(problemType(out.code)).not.toContain('internal-error');
  });

  it('lỗi không rõ → 500 và không lộ thông điệp nội bộ', () => {
    const out = normalizeException(new Error('connect ECONNREFUSED 10.0.0.5:5432'));
    expect(out.status).toBe(500);
    expect(out.code).toBe('INTERNAL_ERROR');
    expect(out.detail).not.toContain('ECONNREFUSED');
  });

  it('lỗi dưới 500 vẫn giữ thông điệp để client hiển thị', () => {
    const out = normalizeException(guardError(403, 'FORBIDDEN'));
    expect(out.detail).toBe('guard');
  });
});

describe('normalizeException — lỗi Prisma', () => {
  // Trước đây P2002 rơi xuống nhánh cuối và thành 500: bấm "Nộp bài" hai lần đụng
  // @@unique([userId, exerciseId, attemptNo]) và người dùng thấy "Có lỗi xảy ra".
  it('P2002 (trùng khoá unique) → 409 CONFLICT', () => {
    const out = normalizeException(prismaError('P2002'));
    expect(out.status).toBe(409);
    expect(out.code).toBe('CONFLICT');
  });

  it('P2025 (không tìm thấy bản ghi) → 404 NOT_FOUND', () => {
    const out = normalizeException(prismaError('P2025'));
    expect(out.status).toBe(404);
    expect(out.code).toBe('NOT_FOUND');
  });

  it('P2028 (transaction hết hạn) → 409 để client biết thử lại được', () => {
    expect(normalizeException(prismaError('P2028')).status).toBe(409);
  });

  it('mã Prisma chưa biết vẫn là 500, không đoán bừa', () => {
    const out = normalizeException(prismaError('P9999'));
    expect(out.status).toBe(500);
    expect(out.code).toBe('INTERNAL_ERROR');
  });

  it('Error thường có thuộc tính `code` trùng tên mã Prisma không bị nhận nhầm', () => {
    const notPrisma = new Error('x');
    Object.assign(notPrisma, { code: 'P2002' });
    expect(normalizeException(notPrisma).status).toBe(500);
  });
});
