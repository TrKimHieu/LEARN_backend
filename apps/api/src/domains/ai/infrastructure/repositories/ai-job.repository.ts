import { Injectable } from '@nestjs/common';
import { newId } from '@learn/db';
import { PrismaService, type Db } from '../../../../infra/services';

export type AIJobTypeName = 'EXTRACT_DOCUMENT' | 'GENERATE_LESSONS' | 'REGENERATE_LESSON';

@Injectable()
export class AIJobRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Job thuộc người dùng — lọc `requestedById` tại truy vấn (chống IDOR). */
  findOwned(id: string, userId: string, db: Db = this.prisma.client) {
    return db.aIJob.findFirst({ where: { id, requestedById: userId } });
  }

  /** Chỉ kiểm tra tồn tại + quyền — không kéo toàn bộ payload. */
  existsOwned(id: string, userId: string, db: Db = this.prisma.client) {
    return db.aIJob.findFirst({
      where: { id, requestedById: userId },
      select: { id: true },
    });
  }

  /** Job GENERATE_LESSONS đang chạy cho (course, params) — chống nộp trùng khi tạo. */
  findPendingGenerate(
    courseId: string,
    userId: string,
    params: Record<string, unknown>,
    db: Db = this.prisma.client,
  ) {
    return db.aIJob.findFirst({
      where: {
        courseId,
        requestedById: userId,
        type: 'GENERATE_LESSONS',
        status: { in: ['QUEUED', 'RUNNING'] },
        inputParams: { equals: params as never },
      },
    });
  }

  create(
    data: {
      courseId: string;
      requestedById: string;
      type: AIJobTypeName;
      idempotencyKey: string;
      params: Record<string, unknown>;
      queuedAt: Date;
    },
    db: Db,
  ) {
    return db.aIJob.create({
      data: {
        id: newId(),
        courseId: data.courseId,
        requestedById: data.requestedById,
        type: data.type,
        idempotencyKey: data.idempotencyKey,
        inputParams: data.params as never,
        queuedAt: data.queuedAt,
      },
    });
  }

  listOwned(userId: string, courseId?: string, db: Db = this.prisma.client) {
    return db.aIJob.findMany({
      where: { requestedById: userId, ...(courseId ? { courseId } : {}) },
      orderBy: { queuedAt: 'desc' },
      take: 50,
    });
  }

  /**
   * Huỷ job đang QUEUED/RUNNING — MỘT câu UPDATE có điều kiện. Lọc `requestedById` trong `where`
   * nên vẫn chống IDOR; trả `null` khi không có dòng nào khớp (không tồn tại / sai trạng thái).
   */
  cancelIfQueuedOrRunning(id: string, userId: string, db: Db = this.prisma.client) {
    return db.aIJob
      .update({
        where: { id, requestedById: userId, status: { in: ['QUEUED', 'RUNNING'] } },
        data: { status: 'CANCELLED' },
      })
      .catch(() => null);
  }
}
