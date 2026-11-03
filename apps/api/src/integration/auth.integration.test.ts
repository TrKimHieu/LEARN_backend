import { requireSandbox } from './safety';
import { describe, it, expect, afterAll } from 'vitest';
import { prisma } from '@learn/db';

/**
 * Integration test thật — gọi thẳng vào API server thật đang chạy (KHÔNG mock, KHÔNG bootstrap
 * app riêng qua NestJS Testing). Đây là mảng còn thiếu nhiều nhất trong dự án (M2–M5 trước giờ chỉ
 * test tay qua browser/curl/psql) — bắt đầu từ auth vì là nền tảng mọi module khác phụ thuộc vào,
 * và refresh-token reuse detection là logic bảo mật quan trọng nhất.
 *
 * Vì sao gọi vào server thật thay vì bootstrap AppModule qua NestFactory.create() trong chính tiến
 * trình test (cách "chuẩn" hơn, đã thử trước): phát hiện thật — vitest dùng esbuild (qua Vite) để
 * biên dịch TS, và esbuild KHÔNG emit `design:paramtypes` cho decorator metadata, đúng lớp lỗi đã
 * ghi nhận ở M1 với `tsx` (xem STATE.md mục M1). Điều bất ngờ: DI của các provider/service thường
 * (`AuthService` 3 tham số) vẫn chạy đúng khi bootstrap qua vitest, nhưng DI của Guard áp qua
 * `@UseGuards(RateLimitGuard)` thì KHÔNG — `RateLimitGuard` (nhận `RedisService`; trước 2026-09-19
 * còn nhận thừa `SecurityService` không dùng) nhận `this.redis = undefined`, gây `500` ở mọi endpoint có `@Throttle`
 * (login, register lần 2 trở đi). Không rõ nguyên nhân sâu (khác biệt cách NestJS resolve Guard so
 * với Provider thường qua `GuardsContextCreator`) — không đáng bỏ thời gian điều tra sâu nội bộ
 * NestJS/Vite lúc này. Giải pháp thực dụng: test qua HTTP thật vào server đang chạy bằng `ts-node`
 * (không có vấn đề emit metadata, đã dùng ổn định suốt phiên làm việc qua curl thủ công).
 *
 * Yêu cầu để chạy: `docker compose up -d` (Postgres/Redis) + `npm run dev -w apps/api` (hoặc
 * `npm run dev` toàn repo) đang chạy ở `http://localhost:4000`. Không chạy được trong CI hiện tại
 * (chưa có Postgres/Redis service ở `ci.yml`, xem STATE.md next-actions #5) — nếu server chưa chạy,
 * các test sẽ fail rõ ràng ngay ở lần gọi fetch đầu (connection refused), không fail mập mờ.
 *
 * `/auth/login` có rate limit thật `@Throttle(5, 60)` theo IP (đã verify hành vi này đúng ở M1) —
 * các test bên dưới CỐ Ý gọi `/auth/login` tối thiểu (chỉ 2 lần cho toàn bộ suite: 1 lần sai mật
 * khẩu + 1 lần đúng), tái dùng token từ lần đăng nhập thành công cho mọi assertion còn lại (giống
 * hành vi client thật — không đăng nhập lại mỗi khi cần token). Vì vậy các `it()` bên dưới **có phụ
 * thuộc thứ tự** (chạy tuần tự trong cùng file, đúng mặc định của vitest) — không phải best practice
 * lý tưởng cho unit test độc lập, nhưng là đánh đổi hợp lý để không tự đụng rate limit thật của
 * chính app khi test lặp lại nhiều lần trong cùng 60 giây (nhất là khi chạy `npm run test` liên tục
 * trong một phiên làm việc dài như phiên này).
 */
const API_URL = requireSandbox();

interface AuthResponseBody {
  user: { email: string };
  accessToken: string;
}
interface MeResponseBody {
  user: { email: string };
  plan: { code: string };
}

describe('Auth (integration thật, server + DB/Redis thật)', () => {
  const testEmail = `it-test-${Date.now()}@learn.ai`;
  const testPassword = 'IntegrationTest@123';
  let accessToken: string;
  let refreshToken1: string;

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: testEmail } });
  });

  it('đăng ký thành công, tạo user + gói FREE mặc định', async () => {
    const res = await fetch(`${API_URL}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        password: testPassword,
        displayName: 'Integration Test User',
      }),
    });
    const body = (await res.json()) as AuthResponseBody;

    expect(res.status).toBe(201);
    expect(body.user.email).toBe(testEmail);
    expect(body.accessToken).toBeTruthy();
    expect(res.headers.get('set-cookie')).toMatch(/^refresh_token=/);

    const dbUser = await prisma.user.findUnique({ where: { email: testEmail } });
    expect(dbUser).not.toBeNull();
    const sub = await prisma.subscription.findFirst({
      where: { userId: dbUser!.id },
      include: { plan: true },
    });
    expect(sub?.plan.code).toBe('FREE');
  });

  it('đăng ký trùng email → 409', async () => {
    const res = await fetch(`${API_URL}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: testPassword, displayName: 'Duplicate' }),
    });
    expect(res.status).toBe(409);
  });

  it('đăng nhập sai mật khẩu → 401 (lần gọi /auth/login #1/2)', async () => {
    const res = await fetch(`${API_URL}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: 'wrong-password' }),
    });
    expect(res.status).toBe(401);
  });

  it('đăng nhập đúng → nhận accessToken + cookie refresh_token (lần gọi /auth/login #2/2, duy nhất cho các test còn lại)', async () => {
    const res = await fetch(`${API_URL}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: testPassword }),
    });
    const body = (await res.json()) as AuthResponseBody;
    expect(res.status).toBe(201);
    expect(body.accessToken).toBeTruthy();
    const cookie = res.headers.get('set-cookie');
    expect(cookie).toMatch(/^refresh_token=/);

    accessToken = body.accessToken;
    refreshToken1 = extractCookieValue(cookie);
  });

  it('/auth/me không có access token → 401', async () => {
    const res = await fetch(`${API_URL}/api/v1/auth/me`);
    expect(res.status).toBe(401);
  });

  it('/auth/me có access token hợp lệ (tái dùng từ lần đăng nhập trên) → trả đúng hồ sơ + gói', async () => {
    const res = await fetch(`${API_URL}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const body = (await res.json()) as MeResponseBody;
    expect(res.status).toBe(200);
    expect(body.user.email).toBe(testEmail);
    expect(body.plan.code).toBe('FREE');
  });

  it('refresh không có cookie → 401', async () => {
    const res = await fetch(`${API_URL}/api/v1/auth/refresh`, { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('rotation + reuse detection: xoay vòng token, replay token cũ bị thu hồi cả family (kể cả token mới hợp lệ)', async () => {
    // Rotation: xoay vòng token1 (từ lần đăng nhập ở trên) → token2 khác token1.
    const refreshed = await fetch(`${API_URL}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { Cookie: `refresh_token=${refreshToken1}` },
    });
    expect(refreshed.status).toBe(201);
    const token2 = extractCookieValue(refreshed.headers.get('set-cookie'));
    expect(token2).toBeTruthy();
    expect(token2).not.toBe(refreshToken1);

    // Reuse detection: replay token1 đã bị thu hồi bởi lượt rotate ở trên — mô phỏng kẻ tấn công
    // dùng lại token cũ bị lộ.
    const replay = await fetch(`${API_URL}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { Cookie: `refresh_token=${refreshToken1}` },
    });
    expect(replay.status).toBe(401);

    // token2 hợp lệ, CHƯA từng bị lộ — phải bị thu hồi theo (thu hồi cả family), không chỉ chặn
    // riêng token1 bị replay. Đây là hành vi bảo mật cốt lõi của HANDBOOK §10.1.
    const legit = await fetch(`${API_URL}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { Cookie: `refresh_token=${token2}` },
    });
    expect(legit.status).toBe(401);
  });
});

function extractCookieValue(setCookieHeader: string | null): string {
  if (!setCookieHeader) throw new Error('refresh_token cookie không có trong response');
  const match = /refresh_token=([^;]+)/.exec(setCookieHeader);
  if (!match) throw new Error('refresh_token cookie không có trong response');
  return match[1]!;
}
