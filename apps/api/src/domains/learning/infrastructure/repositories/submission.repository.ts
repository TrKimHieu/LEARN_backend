import { Injectable } from '@nestjs/common';
import { newId } from '@learn/db';
import type { Prisma } from '@learn/db';
import { PrismaService, type Db } from '../../../../infra/services';

@Injectable()
export class SubmissionRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lượt nộp điểm cao nhất (hoà thì lượt mới hơn) — `null` khi chưa nộp lần nào.
   * Bản trước sắp theo `attemptNo desc` nên thực chất trả lượt MỚI NHẤT: làm lại và trượt thì
   * "điểm tốt nhất" trên màn bài tập tụt theo.
   */
  findBest(userId: string, exerciseId: string, db: Db = this.prisma.client) {
    return db.submission.findFirst({
      where: { userId, exerciseId },
      orderBy: [{ score: 'desc' }, { attemptNo: 'desc' }],
    });
  }

  /** Điểm cao nhất của người dùng theo từng bài tập — một câu GROUP BY. */
  async bestScoresForExercises(
    userId: string,
    exerciseIds: string[],
    db: Db = this.prisma.client,
  ): Promise<Map<string, number>> {
    if (exerciseIds.length === 0) return new Map();
    const rows = await db.submission.groupBy({
      by: ['exerciseId'],
      where: { userId, exerciseId: { in: exerciseIds } },
      _max: { score: true },
    });
    return new Map(
      rows.filter((r) => r._max.score !== null).map((r) => [r.exerciseId, r._max.score as number]),
    );
  }

  /** Lượt nộp kế tiếp — tính TRONG transaction để hai nộp song song không đụng `@@unique`. */
  maxAttemptNo(userId: string, exerciseId: string, tx: Prisma.TransactionClient) {
    return tx.submission.aggregate({
      where: { userId, exerciseId },
      _max: { attemptNo: true },
    });
  }

  /**
   * Ghi Submission + SubmissionAnswer trong MỘT transaction.
   *
   * `attemptNo` tính từ `_max` thật trong transaction; nếu đụng khoá (P2002) service thử lại.
   */
  async createWithAnswers(
    tx: Prisma.TransactionClient,
    args: {
      userId: string;
      exerciseId: string;
      percent: number;
      maxScore: number;
      durationMs: number | null;
      results: Array<{
        questionId: string;
        rawAnswer: Prisma.InputJsonValue;
        isCorrect: boolean;
        pointsEarned: number;
        explanation: string | null;
      }>;
    },
  ): Promise<{ id: string; attemptNo: number; createdAt: Date }> {
    const previous = await this.maxAttemptNo(args.userId, args.exerciseId, tx);
    const attemptNo = (previous._max.attemptNo ?? 0) + 1;
    const id = newId();

    const submission = await tx.submission.create({
      data: {
        id,
        userId: args.userId,
        exerciseId: args.exerciseId,
        attemptNo,
        score: args.percent,
        maxScore: args.maxScore,
        durationMs: args.durationMs,
      },
    });

    // Một INSERT nhiều dòng thay cho N round-trip tuần tự trong transaction.
    await tx.submissionAnswer.createMany({
      data: args.results.map((r) => ({
        id: newId(),
        submissionId: id,
        questionId: r.questionId,
        rawAnswer: r.rawAnswer,
        isCorrect: r.isCorrect,
        pointsEarned: r.pointsEarned,
        feedback: r.explanation,
      })),
    });

    return { id, attemptNo, createdAt: submission.createdAt };
  }

  /** Điểm (0-100) cao nhất của một người ở từng bài tập — tính trong Postgres. */
  bestScoresForUser(userId: string, db: Db = this.prisma.client) {
    return db.submission.groupBy({
      by: ['exerciseId'],
      where: { userId },
      _max: { score: true },
    });
  }

  /**
   * Một trang lịch sử nộp bài, mới nhất trước, kèm tên bài tập/bài học/khoá học.
   *
   * Cursor-based (NFR-PERF-02): `cursor` là id lượt nộp cuối của trang trước. Thứ tự có `id`
   * làm khoá phụ vì hai lượt nộp có thể trùng `createdAt` tới mili-giây; thiếu nó thì cursor
   * không xác định và một dòng có thể lặp hoặc rơi mất giữa hai trang. Cursor chỉ là điểm mốc
   * thứ tự: dù ai đó đưa id lượt nộp của người khác, `where.userId` vẫn giới hạn kết quả vào lượt
   * nộp của chính người gọi.
   */
  page(userId: string, limit: number, cursor?: string, db: Db = this.prisma.client) {
    return db.submission.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        exercise: {
          select: {
            title: true,
            passScore: true,
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
    });
  }

  /**
   * Các ngày (theo giờ địa phương) người dùng có lượt nộp — đầu vào tính chuỗi ngày liên tiếp.
   * `date_trunc` chạy trong Postgres; cửa sổ nhìn lại chặn cứng để không tải toàn bộ lịch sử.
   * Logic múi giờ được giải thích trong ProgressService.activeStreak.
   */
  distinctStudyDays(
    userId: string,
    since: Date,
    timeZone: string,
    limit: number,
    db: Db = this.prisma.client,
  ) {
    return db.$queryRaw<Array<{ day: Date }>>`
      SELECT DISTINCT date_trunc('day', ("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${timeZone}) AS day
      FROM "Submission"
      WHERE "userId" = ${userId} AND "createdAt" >= ${since}
      ORDER BY day DESC
      LIMIT ${limit}
    `;
  }
}
