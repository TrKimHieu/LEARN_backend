import { Injectable } from '@nestjs/common';
import { newId, Prisma } from '@learn/db';
import { PrismaService, type Db } from '../../../../infra/services';

/**
 * Repository riêng cho admin dashboard. Các truy vấn ở đây băng qua nhiều bảng (user/course/
 * document/aIJob/submission/generationRun/subscription/auditLog) với include/_count đặc thù
 * màn admin — đặt một chỗ thay vì rải trong controller. Không lọc ownerId vì admin xem được
 * mọi hàng; quyền gating nằm ở `@Admin()` guard (admin.decorators).
 */
@Injectable()
export class AdminRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Metrics ─────────────────────────────────────────────────────────

  countUsers(deletedAt: boolean, since?: Date, db: Db = this.prisma.client) {
    return db.user.count({
      where: { deletedAt: null, ...(since ? { createdAt: { gte: since } } : {}) },
    });
  }

  countCourses(db: Db = this.prisma.client) {
    return db.course.count({ where: { deletedAt: null } });
  }

  countDocuments(db: Db = this.prisma.client) {
    return db.document.count();
  }

  countAiJobs(since?: Date, db: Db = this.prisma.client) {
    return db.aIJob.count({ where: since ? { queuedAt: { gte: since } } : {} });
  }

  countSubmissions(db: Db = this.prisma.client) {
    return db.submission.count();
  }

  sumGenerationCostUsd(db: Db = this.prisma.client) {
    return db.generationRun.aggregate({ _sum: { costUsd: true } });
  }

  /**
   * Các lượt gọi model 7 ngày gần đây cho biểu đồ chi phí theo ngày. Chỉ lấy cột cần thiết;
   * gộp theo ngày (UTC) làm ở tầng ứng dụng vì Prisma groupBy theo timestamp ms gần như không
   * gộp được dòng nào (xem ghi chú trong controller cũ).
   */
  recentRuns(since: Date, db: Db = this.prisma.client) {
    return db.generationRun.findMany({
      where: { createdAt: { gte: since } },
      select: {
        createdAt: true,
        costUsd: true,
        inputTokens: true,
        outputTokens: true,
        aiJobId: true,
      },
    });
  }

  // ─── Listings (có search chống SQL injection qua Prisma, không nối chuỗi tay) ──

  searchUsers(q: string | undefined, db: Db = this.prisma.client) {
    return db.user.findMany({
      where: {
        deletedAt: null,
        ...(q ? { email: { contains: q, mode: 'insensitive' as const } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        subscriptions: {
          where: { status: { in: ['ACTIVE', 'TRIALING'] } },
          orderBy: { updatedAt: 'desc' },
          take: 1,
          include: { plan: true },
        },
        _count: { select: { courses: { where: { deletedAt: null } } } },
      },
    });
  }

  searchCourses(q: string | undefined, db: Db = this.prisma.client) {
    return db.course.findMany({
      where: {
        deletedAt: null,
        ...(q ? { title: { contains: q, mode: 'insensitive' as const } } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take: 100,
      include: {
        owner: { select: { email: true } },
        _count: { select: { lessons: { where: { deletedAt: null } }, documents: true } },
      },
    });
  }

  listSubscriptions(db: Db = this.prisma.client) {
    return db.subscription.findMany({
      where: { status: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] } },
      orderBy: { updatedAt: 'desc' },
      take: 100,
      include: { plan: true, user: { select: { email: true } } },
    });
  }

  listAiJobs(status: string | undefined, db: Db = this.prisma.client) {
    return db.aIJob.findMany({
      where: status ? { status: status as never } : {},
      orderBy: { queuedAt: 'desc' },
      take: 100,
      include: { course: { select: { title: true } }, requester: { select: { email: true } } },
    });
  }

  findAiJobDetail(id: string, db: Db = this.prisma.client) {
    return db.aIJob.findUnique({
      where: { id },
      include: { course: { select: { title: true } }, requester: { select: { email: true } } },
    });
  }

  listRunsForJob(aiJobId: string, db: Db = this.prisma.client) {
    return db.generationRun.findMany({
      where: { aiJobId },
      orderBy: { createdAt: 'asc' },
      take: 20,
    });
  }

  /** Đặt lại job FAILED về QUEUED để chạy lại — ràng buộc trạng thái giữ ở service/controller. */
  resetJobForRetry(id: string, db: Db = this.prisma.client) {
    return db.aIJob.update({
      where: { id },
      data: {
        status: 'QUEUED',
        progress: 0,
        progressLabel: null,
        error: Prisma.DbNull,
        startedAt: null,
        finishedAt: null,
      },
    });
  }

  // ─── Audit ─────────────────────────────────────────────────────────

  createAuditLog(
    data: {
      actorId: string;
      action: string;
      entityType: 'AIJob';
      entityId: string;
      metadata: Record<string, unknown>;
    },
    db: Db = this.prisma.client,
  ) {
    return db.auditLog.create({
      data: {
        id: newId(),
        actorId: data.actorId,
        action: data.action,
        entityType: data.entityType,
        entityId: data.entityId,
        metadata: data.metadata as never,
      },
    });
  }

  listAuditLog(entityType: string, entityId: string, db: Db = this.prisma.client) {
    return db.auditLog.findMany({
      where: { entityType, entityId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { actor: { select: { email: true } } },
    });
  }
}
