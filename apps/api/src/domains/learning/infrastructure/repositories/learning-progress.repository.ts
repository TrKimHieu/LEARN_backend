import { Injectable } from '@nestjs/common';
import { newId } from '@learn/db';
import type { Prisma } from '@learn/db';
import { PrismaService, type Db } from '../../../../infra/services';

@Injectable()
export class LearningProgressRepository {
  constructor(private readonly prisma: PrismaService) {}

  findManyForUser(userId: string, courseId: string, db: Db = this.prisma.client) {
    return db.learningProgress.findMany({ where: { userId, courseId } });
  }

  /** Tiến độ của (userId, lessonId) — khoá tự nhiên tạo bởi @@unique. */
  findUnique(userId: string, lessonId: string, db: Db = this.prisma.client) {
    return db.learningProgress.findUnique({
      where: { userId_lessonId: { userId, lessonId } },
    });
  }

  create(
    data: { userId: string; courseId: string; lessonId: string },
    db: Db = this.prisma.client,
  ) {
    return db.learningProgress.create({
      data: { id: newId(), ...data, status: 'IN_PROGRESS', startedAt: new Date() },
    });
  }

  /** Số bài học COMPLETED của một người (toàn bộ khoá học) — đầu vào active streak. */
  countCompleted(userId: string, db: Db = this.prisma.client) {
    return db.learningProgress.count({ where: { userId, status: 'COMPLETED' } });
  }

  /** Số bài COMPLETED gộp theo course — thay cho N câu COUNT khi hiển thị danh sách. */
  completedByCourse(userId: string, db: Db = this.prisma.client) {
    return db.learningProgress.groupBy({
      by: ['courseId'],
      where: { userId, status: 'COMPLETED' },
      _count: { _all: true },
    });
  }

  /**
   * Đọc tiến độ hiện tại rồi upsert khi nộp bài — chạy TRONG transaction của submission.
   * `lessonComplete` do service tính theo luật "mọi bài tập đều đạt" (lesson-completion.ts).
   */
  async upsertAfterSubmission(
    tx: Prisma.TransactionClient,
    args: {
      userId: string;
      courseId: string;
      lessonId: string;
      percent: number;
      lessonComplete: boolean;
    },
  ): Promise<void> {
    const { userId, courseId, lessonId, percent, lessonComplete: passed } = args;
    const now = new Date();
    const existing = await tx.learningProgress.findUnique({
      where: { userId_lessonId: { userId, lessonId } },
      select: { status: true, bestScore: true, completedAt: true },
    });

    await tx.learningProgress.upsert({
      where: { userId_lessonId: { userId, lessonId } },
      create: {
        id: newId(),
        userId,
        courseId,
        lessonId,
        status: passed ? 'COMPLETED' : 'IN_PROGRESS',
        bestScore: percent,
        attempts: 1,
        startedAt: now,
        completedAt: passed ? now : null,
      },
      update: {
        // Đã COMPLETED thì không hạ cấp khi làm lại và trượt.
        status: passed || existing?.status === 'COMPLETED' ? 'COMPLETED' : 'IN_PROGRESS',
        bestScore: Math.max(existing?.bestScore ?? 0, percent),
        // `increment` để hai lượt nộp song song không ghi đè bộ đếm của nhau
        // (đọc-rồi-ghi `existing.attempts + 1` làm mất một lượt).
        attempts: { increment: 1 },
        completedAt: passed ? (existing?.completedAt ?? now) : existing?.completedAt,
      },
    });
  }

  /** Tiến độ (lessonId, status, bestScore) trong một khoá học — cho màn tiến độ chi tiết. */
  findForCourse(userId: string, courseId: string, db: Db = this.prisma.client) {
    return db.learningProgress.findMany({
      where: { userId, courseId },
      select: { lessonId: true, status: true, bestScore: true },
    });
  }
}
