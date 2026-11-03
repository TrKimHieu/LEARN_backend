import { Injectable } from '@nestjs/common';
import { newId } from '@learn/db';
import type { UsageMetric } from '@learn/db';
import { PrismaService, type Db } from '../../../../infra/services';

/**
 * Truy vấn tầng hạn mức: bộ đếm theo tháng + số khoá học đang có (metric `derived`).
 * Lọc sở hữu (`ownerId`/`userId`) nằm ngay trong câu truy vấn, không phụ thuộc người gọi.
 */
@Injectable()
export class UsageCounterRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Cộng dồn bộ đếm theo kỳ tháng — kiểm-tra-rồi-ghi phải nằm trong cùng transaction ở service. */
  increment(userId: string, period: string, metric: UsageMetric, db: Db) {
    return db.usageCounter.upsert({
      where: { userId_period_metric: { userId, period, metric } },
      update: { value: { increment: 1 } },
      create: { id: newId(), userId, period, metric, value: 1 },
    });
  }

  findValue(userId: string, period: string, metric: UsageMetric, db: Db) {
    return db.usageCounter.findUnique({
      where: { userId_period_metric: { userId, period, metric } },
    });
  }

  /** Số khoá học chưa xoá của người dùng — nguồn cho metric `derived` COURSES_CREATED. */
  countOwnedCourses(userId: string, db: Db) {
    return db.course.count({ where: { ownerId: userId, deletedAt: null } });
  }

  /** Giữ advisory lock theo (userId, metric) — chỉ tồn tại trong transaction (xem UsageService). */
  lockQuota(userId: string, metric: UsageMetric, db: Db) {
    return db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`quota:${userId}:${metric}`}))`;
  }
}
