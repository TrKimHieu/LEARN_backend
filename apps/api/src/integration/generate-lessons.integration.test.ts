import { requireSandbox, deleteFixtureCourses } from './safety';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, newId } from '@learn/db';

/**
 * Bài thực hành "từ yêu cầu đến kiểm thử": chức năng *Sinh bài học từ tài liệu đã tải lên*.
 * Thao tác ghi duy nhất được chấm là `AIJob` (kèm Lesson do worker ghi sau đó).
 *
 *   TC01 → R1  có tài liệu EXTRACTED          → 201, đúng 1 AIJob mới
 *   TC02 → R2  đã có job QUEUED/RUNNING        → trả lại job cũ, không tạo AIJob thứ hai
 *   TC03 → R3  không có tài liệu EXTRACTED     → 409, không tạo AIJob
 *
 * Cần sandbox đang chạy như `quota.integration.test.ts`. Người dùng riêng cho test, xoá ở `afterAll`.
 */
const API_URL = requireSandbox();

describe('Sinh bài học: R1–R3', () => {
  const email = `gen-it-${Date.now()}@learn.ai`;
  let token: string;
  let userId: string;
  let readyCourseId: string;
  let emptyCourseId: string;

  const post = (path: string, body: unknown) =>
    fetch(`${API_URL}/api/v1${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  const generate = (courseId: string) => post(`/ai/courses/${courseId}/generate-lessons`, {});
  const jobCount = (courseId: string) => prisma.aIJob.count({ where: { courseId } });

  beforeAll(async () => {
    const reg = await fetch(`${API_URL}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'GenTest@12345', displayName: 'Gen Test' }),
    });
    expect(reg.status).toBe(201);
    token = ((await reg.json()) as { accessToken: string }).accessToken;
    userId = (await prisma.user.findUniqueOrThrow({ where: { email } })).id;

    const ready = await post('/courses', { title: 'Khóa có tài liệu', language: 'vi' });
    readyCourseId = ((await ready.json()) as { id: string }).id;
    const empty = await post('/courses', { title: 'Khóa trống', language: 'vi' });
    emptyCourseId = ((await empty.json()) as { id: string }).id;

    const id = newId();
    await prisma.document.create({
      data: {
        id,
        uploaderId: userId,
        courseId: readyCourseId,
        filename: 'fixture.md',
        mimeType: 'text/markdown',
        sizeBytes: 100,
        checksumSha256: 'f'.repeat(64),
        storageKey: `${userId}/documents/${id}.fixture.md`,
        status: 'EXTRACTED',
      },
    });
  });

  afterAll(async () => {
    await prisma.aIJob.deleteMany({ where: { requestedById: userId } });
    await prisma.document.deleteMany({ where: { uploaderId: userId } });
    await deleteFixtureCourses(userId, (ownerId) =>
      prisma.course.deleteMany({ where: { ownerId } }),
    );
    await prisma.user.deleteMany({ where: { email } });
  });

  it('TC03 → R3: không có tài liệu EXTRACTED thì 409 và không tạo AIJob', async () => {
    const before = await jobCount(emptyCourseId);
    const res = await generate(emptyCourseId);
    expect(res.status).toBe(409);
    expect(await jobCount(emptyCourseId)).toBe(before);
  });

  it('TC01 → R1: có tài liệu EXTRACTED thì 201 và đúng một AIJob mới', async () => {
    const before = await jobCount(readyCourseId);
    const res = await generate(readyCourseId);
    expect(res.status).toBe(201);
    expect(await jobCount(readyCourseId)).toBe(before + 1);
  });

  it('TC02 → R2: gọi lại khi job còn chạy thì trả job cũ, không tạo AIJob thứ hai', async () => {
    // Ép job của TC01 về RUNNING để ca không phụ thuộc việc worker có chạy hay đã xong.
    await prisma.aIJob.updateMany({
      where: { courseId: readyCourseId },
      data: { status: 'RUNNING' },
    });
    const first = await prisma.aIJob.findFirstOrThrow({ where: { courseId: readyCourseId } });
    const before = await jobCount(readyCourseId);
    const res = await generate(readyCourseId);
    expect(((await res.json()) as { id: string }).id).toBe(first.id);
    expect(await jobCount(readyCourseId)).toBe(before);
  });
});
