import { requireSandbox, deleteFixtureCourses } from './safety';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@learn/db';

/**
 * Hạn mức dưới tải đồng thời — integration thật, server + DB đang chạy.
 *
 * Vì sao phải là integration chứ không unit test: lỗi cần bắt là **kiểm-tra-rồi-hành-động**
 * giữa hai request song song. Mock Prisma thì không có transaction thật, không có advisory
 * lock thật, nên bug sẽ không tái hiện — test sẽ xanh cả trước lẫn sau khi sửa, tức là vô dụng.
 *
 * Chạy cùng điều kiện với `auth.integration.test.ts`: cần `docker compose up -d` và
 * `npm run dev -w apps/api` ở `http://localhost:4000`. Server chưa chạy thì fail ngay ở lần
 * fetch đầu (connection refused), không fail mập mờ.
 *
 * Người dùng dùng riêng cho test và xoá sạch ở `afterAll`, nên không đụng dữ liệu demo.
 */
const API_URL = requireSandbox();

/** Gói FREE trong `packages/db/prisma/seed.ts`: `COURSES_CREATED: { limit: 3, window: 'total' }`. */
const FREE_COURSE_LIMIT = 3;

interface AuthBody {
  accessToken: string;
}
interface ErrorBody {
  code: string;
  type: string;
  status: number;
}

describe('Hạn mức khoá học dưới tải đồng thời', () => {
  const email = `quota-it-${Date.now()}@learn.ai`;
  const password = 'QuotaTest@12345';
  let token: string;
  let userId: string;

  beforeAll(async () => {
    const res = await fetch(`${API_URL}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, displayName: 'Quota Test' }),
    });
    expect(res.status).toBe(201);
    token = ((await res.json()) as AuthBody).accessToken;

    const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    expect(user).not.toBeNull();
    userId = user!.id;
  });

  afterAll(async () => {
    // Course có khoá ngoại tới User nên phải xoá trước.
    await deleteFixtureCourses(userId, (ownerId) =>
      prisma.course.deleteMany({ where: { ownerId } }),
    );
    await prisma.user.deleteMany({ where: { email } });
  });

  const createCourse = (title: string) =>
    fetch(`${API_URL}/api/v1/courses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ title, language: 'vi' }),
    });

  /**
   * Đây là test then chốt. Trước khi sửa, `create()` chạy ba bước rời nhau —
   * `assertNotExceeded()` → `course.create()` → `increment()`. Tám request cùng lúc đều đọc
   * thấy `used = 0` trước khi bất kỳ ai kịp ghi, nên **cả tám** đều tạo được khoá học: gói
   * FREE giới hạn 3 nhưng thực tế vượt tuỳ tốc độ bấm.
   */
  it('8 request song song chỉ tạo được đúng 3 khoá học', async () => {
    const attempts = 8;
    const responses = await Promise.all(
      Array.from({ length: attempts }, (_, i) => createCourse(`Khoá song song ${i}`)),
    );
    const statuses = responses.map((r) => r.status);

    const created = statuses.filter((s) => s === 201).length;
    const rejected = statuses.filter((s) => s === 402).length;

    expect(created).toBe(FREE_COURSE_LIMIT);
    expect(rejected).toBe(attempts - FREE_COURSE_LIMIT);
    // Không có 500: vượt hạn mức là kết quả lường trước, không phải sự cố.
    expect(statuses.filter((s) => s >= 500)).toEqual([]);

    // Nguồn sự thật là DB, không phải mã trả về.
    const inDb = await prisma.course.count({ where: { ownerId: userId, deletedAt: null } });
    expect(inDb).toBe(FREE_COURSE_LIMIT);
  });

  it('request thứ tư tuần tự trả 402 với đúng hình dạng lỗi RFC 7807', async () => {
    const res = await createCourse('Khoá vượt hạn mức');
    expect(res.status).toBe(402);

    const body = (await res.json()) as ErrorBody;
    expect(body.code).toBe('QUOTA_EXCEEDED');
    // Lỗi cũ: nhánh fallback hardcode `type: '.../internal-error'` cho mọi lỗi không phải ApiError.
    expect(body.type).toBe('https://learn.ai/errors/quota_exceeded');
    expect(body.status).toBe(402);
  });

  /**
   * `COURSES_CREATED` có window `total` và đọc số thật từ bảng Course, nên xoá một khoá học
   * là trả lại một suất. (Bản trước còn `increment()` một bộ đếm theo tháng song song mà
   * không ai đọc — xoá khoá học vẫn trả suất, nhưng bộ đếm kia cứ tăng mãi.)
   */
  it('xoá một khoá học trả lại một suất', async () => {
    const victim = await prisma.course.findFirst({
      where: { ownerId: userId, deletedAt: null },
      select: { id: true },
    });
    expect(victim).not.toBeNull();

    const del = await fetch(`${API_URL}/api/v1/courses/${victim!.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(del.status).toBe(200);

    const res = await createCourse('Khoá dùng lại suất vừa trả');
    expect(res.status).toBe(201);
  });
});
