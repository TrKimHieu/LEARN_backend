import { requireSandbox } from './safety';
import { describe, it, expect, afterAll } from 'vitest';
import { prisma } from '@learn/db';

/**
 * Chế độ client native (app mobile — ADR 016): refresh token đi qua body, không cookie.
 *
 * Cùng cách chạy với `auth.integration.test.ts`: gọi HTTP vào server thật đang chạy ở :4000
 * (`docker compose up -d` + `npm run dev -w apps/api`). Chỉ dùng `/auth/register` để có phiên,
 * không đụng `/auth/login` — suite kia đã dùng gần hết hạn mức 5 lần/phút của login.
 *
 * Các `it()` phụ thuộc thứ tự (chạy tuần tự trong file), giống suite auth web.
 */
const API_URL = requireSandbox();
const NATIVE = { 'x-learn-client': 'native' } as const;

interface NativeSession {
  user: { email: string };
  accessToken: string;
  refreshToken: string;
}

function refresh(body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${API_URL}/api/v1/auth/refresh`, {
    method: 'POST',
    headers: { ...NATIVE, 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('Auth — client native (integration thật)', () => {
  const email = `it-native-${Date.now()}@learn.ai`;
  let session: NativeSession;

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email } });
  });

  it('đăng ký native → refresh token nằm trong body, không set cookie', async () => {
    const res = await fetch(`${API_URL}/api/v1/auth/register`, {
      method: 'POST',
      headers: { ...NATIVE, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'NativeTest@123', displayName: 'Native Test' }),
    });
    session = (await res.json()) as NativeSession;

    expect(res.status).toBe(201);
    expect(session.user.email).toBe(email);
    expect(session.accessToken).toBeTruthy();
    expect(session.refreshToken.length).toBeGreaterThanOrEqual(20);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('header native + cookie hợp lệ nhưng không có body → 401 (native không bao giờ đọc cookie)', async () => {
    const res = await fetch(`${API_URL}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { ...NATIVE, Cookie: `refresh_token=${session.refreshToken}` },
    });
    expect(res.status).toBe(401);
  });

  it('body sai hình dạng → 401', async () => {
    const res = await refresh({ refreshToken: session.refreshToken, extra: true });
    expect(res.status).toBe(401);
  });

  it('refresh native bằng body → xoay vòng, token mới trong body, không set cookie', async () => {
    const res = await refresh({ refreshToken: session.refreshToken });
    const next = (await res.json()) as NativeSession;

    expect(res.status).toBe(201);
    expect(next.accessToken).toBeTruthy();
    expect(next.refreshToken).not.toBe(session.refreshToken);
    expect(res.headers.get('set-cookie')).toBeNull();

    // Token cũ đã bị thu hồi khi xoay vòng: replay → 401 và thu hồi cả family.
    const replay = await refresh({ refreshToken: session.refreshToken });
    expect(replay.status).toBe(401);
    const legit = await refresh({ refreshToken: next.refreshToken });
    expect(legit.status).toBe(401);
  });

  it('đăng xuất native thu hồi đúng token gửi trong body', async () => {
    // Family cũ đã bị thu hồi ở test trên — đăng ký phiên mới bằng tài khoản khác.
    const email2 = `it-native-2-${Date.now()}@learn.ai`;
    const reg = await fetch(`${API_URL}/api/v1/auth/register`, {
      method: 'POST',
      headers: { ...NATIVE, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email2, password: 'NativeTest@123', displayName: 'Native 2' }),
    });
    const s = (await reg.json()) as NativeSession;

    try {
      const out = await fetch(`${API_URL}/api/v1/auth/logout`, {
        method: 'POST',
        headers: {
          ...NATIVE,
          'Content-Type': 'application/json',
          Authorization: `Bearer ${s.accessToken}`,
        },
        body: JSON.stringify({ refreshToken: s.refreshToken }),
      });
      expect(out.status).toBe(201);
      expect(out.headers.get('set-cookie')).toBeNull();

      const after = await refresh({ refreshToken: s.refreshToken });
      expect(after.status).toBe(401);
    } finally {
      await prisma.user.deleteMany({ where: { email: email2 } });
    }
  });
});
