import { Injectable } from '@nestjs/common';
import { newId } from '@learn/db';
import type { Prisma } from '@learn/db';
import { PrismaService, type Db } from '../../../infra/services';

/**
 * Bài học còn sống và khoá chứa nó thuộc `userId` — cùng điều kiện với
 * `LessonRepository.assertAccessible` của domain learning, viết dạng `where` lồng để lọc cả danh
 * sách thẻ trong một truy vấn (chống IDOR, AGENTS.md).
 */
const accessibleLesson = (userId: string): Prisma.LessonWhereInput => ({
  deletedAt: null,
  course: { ownerId: userId, deletedAt: null },
});

const accessibleCard = (userId: string): Prisma.CardScheduleWhereInput => ({
  userId,
  question: { exercise: { lesson: accessibleLesson(userId) } },
});

@Injectable()
export class ReviewRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Câu hỏi đã nộp mà chưa có lịch, kèm kết quả ở lượt nộp gần nhất của bài tập chứa nó.
   * Bài tập chưa nộp lần nào không bao giờ xuất hiện (không lộ đáp án trước khi nộp).
   */
  async findSeeds(
    userId: string,
    db: Db = this.prisma.client,
  ): Promise<Array<{ questionId: string; isCorrect: boolean }>> {
    const exercises = await db.exercise.findMany({
      where: {
        lesson: accessibleLesson(userId),
        submissions: { some: { userId } },
        questions: { some: { cardSchedules: { none: { userId } } } },
      },
      select: {
        questions: {
          where: { cardSchedules: { none: { userId } } },
          select: { id: true },
        },
        submissions: {
          where: { userId },
          orderBy: [{ createdAt: 'desc' }, { attemptNo: 'desc' }],
          take: 1,
          select: { answers: { select: { questionId: true, isCorrect: true } } },
        },
      },
    });
    return exercises.flatMap((e) => {
      const latest = new Map(
        (e.submissions[0]?.answers ?? []).map((a) => [a.questionId, a.isCorrect]),
      );
      return e.questions.map((q) => ({ questionId: q.id, isCorrect: latest.get(q.id) === true }));
    });
  }

  async createSchedules(
    rows: Array<{ userId: string; questionId: string; dueAt: Date }>,
    db: Db = this.prisma.client,
  ): Promise<void> {
    if (rows.length === 0) return;
    // `skipDuplicates`: hai lần gọi `due` song song cùng sinh lịch không đụng `@@unique`.
    await db.cardSchedule.createMany({
      data: rows.map((r) => ({ id: newId(), ...r })),
      skipDuplicates: true,
    });
  }

  listDue(userId: string, now: Date, limit: number, db: Db = this.prisma.client) {
    return db.cardSchedule.findMany({
      where: { ...accessibleCard(userId), dueAt: { lte: now } },
      orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
      take: limit,
      include: {
        question: {
          select: {
            id: true,
            type: true,
            prompt: true,
            explanation: true,
            correctAnswer: true,
            options: {
              orderBy: { orderIndex: 'asc' },
              select: { content: true, isCorrect: true },
            },
            exercise: {
              select: {
                lesson: {
                  select: {
                    id: true,
                    title: true,
                    course: { select: { id: true, title: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
  }

  countDue(userId: string, now: Date, db: Db = this.prisma.client) {
    return db.cardSchedule.count({ where: { ...accessibleCard(userId), dueAt: { lte: now } } });
  }

  async nextDueAt(userId: string, now: Date, db: Db = this.prisma.client): Promise<Date | null> {
    const next = await db.cardSchedule.findFirst({
      where: { ...accessibleCard(userId), dueAt: { gt: now } },
      orderBy: { dueAt: 'asc' },
      select: { dueAt: true },
    });
    return next?.dueAt ?? null;
  }

  /** Lịch của thẻ, `null` khi chưa có hoặc khoá học/bài học đã bị xoá. */
  findSchedule(userId: string, questionId: string, db: Db = this.prisma.client) {
    return db.cardSchedule.findFirst({ where: { ...accessibleCard(userId), questionId } });
  }

  /** Khoá hàng lịch (`FOR UPDATE`) rồi đọc — hai lượt chấm cùng thẻ xếp hàng, mỗi lượt thấy trạng thái lượt trước. */
  async lockSchedule(tx: Prisma.TransactionClient, userId: string, questionId: string) {
    await tx.$queryRaw`
      SELECT "id" FROM "CardSchedule"
      WHERE "userId" = ${userId} AND "questionId" = ${questionId}
      FOR UPDATE
    `;
    return tx.cardSchedule.findUnique({ where: { userId_questionId: { userId, questionId } } });
  }

  findReviewByKey(userId: string, idempotencyKey: string, db: Db = this.prisma.client) {
    return db.cardReview.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey } },
      select: { requestHash: true, response: true },
    });
  }

  async createReview(
    tx: Prisma.TransactionClient,
    row: {
      userId: string;
      questionId: string;
      grade: string;
      reviewedAt: Date;
      idempotencyKey: string | null;
      requestHash: string | null;
      response: Prisma.InputJsonValue;
    },
  ): Promise<void> {
    await tx.cardReview.create({ data: { id: newId(), ...row } });
  }

  async updateSchedule(
    tx: Prisma.TransactionClient,
    id: string,
    data: {
      easeFactor: number;
      intervalDays: number;
      repetitions: number;
      lapses: number;
      dueAt: Date;
      lastReviewedAt: Date;
    },
  ): Promise<void> {
    await tx.cardSchedule.update({ where: { id }, data });
  }
}
