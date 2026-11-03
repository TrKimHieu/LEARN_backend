import { Injectable } from '@nestjs/common';
import type { AdminMetrics } from '@learn/contracts';
import { ApiError } from '../../../core/exceptions/errors';
import { QueueService } from '../../../infra/services';
import { AdminRepository } from '../infrastructure/repositories/admin.repository';
import { AdminContext } from '../presentation/admin.decorators';

@Injectable()
export class AdminService {
  constructor(
    private readonly repo: AdminRepository,
    private readonly queue: QueueService,
  ) {}

  async metrics(): Promise<AdminMetrics> {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const weekAgo = new Date(today.getTime() - 7 * 86400_000);

    const [users, usersToday, courses, documents, jobs, jobsToday, submissions, cost, runs] =
      await Promise.all([
        this.repo.countUsers(false),
        this.repo.countUsers(false, today),
        this.repo.countCourses(),
        this.repo.countDocuments(),
        this.repo.countAiJobs(),
        this.repo.countAiJobs(today),
        this.repo.countSubmissions(),
        this.repo.sumGenerationCostUsd(),
        this.repo.recentRuns(weekAgo),
      ]);

    // Prisma groupBy trên `createdAt` (timestamp chính xác đến ms) gần như không gộp được dòng nào —
    // phải tự gộp theo ngày (UTC) ở tầng ứng dụng cho đúng "biểu đồ chi phí LLM theo ngày" (checklist admin).
    const byDay = new Map<
      string,
      {
        totalCostUsd: number;
        jobIds: Set<string>;
        totalInputTokens: number;
        totalOutputTokens: number;
      }
    >();
    for (const r of runs) {
      const day = r.createdAt.toISOString().slice(0, 10);
      const bucket = byDay.get(day) ?? {
        totalCostUsd: 0,
        jobIds: new Set<string>(),
        totalInputTokens: 0,
        totalOutputTokens: 0,
      };
      bucket.totalCostUsd += Number(r.costUsd);
      bucket.jobIds.add(r.aiJobId);
      bucket.totalInputTokens += r.inputTokens;
      bucket.totalOutputTokens += r.outputTokens;
      byDay.set(day, bucket);
    }
    const dailyCosts = Array.from(byDay.entries())
      .map(([date, b]) => ({
        date,
        totalCostUsd: Math.round(b.totalCostUsd * 1e6) / 1e6,
        jobCount: b.jobIds.size,
        totalInputTokens: b.totalInputTokens,
        totalOutputTokens: b.totalOutputTokens,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return {
      generatedAt: new Date().toISOString(),
      totals: {
        users,
        usersToday,
        courses,
        documents,
        aiJobs: jobs,
        aiJobsToday: jobsToday,
        submissions,
        totalCostUsd: Number(cost._sum.costUsd ?? 0),
      },
      dailyCosts,
    };
  }

  async users(q?: string) {
    const rows = await this.repo.searchUsers(q);
    return {
      users: rows.map((u) => ({
        id: u.id,
        email: u.email,
        displayName: u.displayName,
        role: u.role,
        locale: u.locale as 'vi' | 'en',
        emailVerifiedAt: u.emailVerifiedAt?.toISOString() ?? null,
        createdAt: u.createdAt.toISOString(),
        courseCount: u._count.courses,
        subscriptionCode: u.subscriptions[0]?.plan.code ?? null,
      })),
    };
  }

  async courses(q?: string) {
    const rows = await this.repo.searchCourses(q);
    return {
      courses: rows.map((c) => ({
        id: c.id,
        title: c.title,
        description: c.description,
        language: c.language,
        status: c.status,
        progress: { completed: 0, total: c._count.lessons },
        documentCount: c._count.documents,
        lessonCount: c._count.lessons,
        updatedAt: c.updatedAt.toISOString(),
        ownerEmail: c.owner.email,
      })),
    };
  }

  async subscriptions() {
    const rows = await this.repo.listSubscriptions();
    return {
      subscriptions: rows.map((s) => ({
        userId: s.userId,
        email: s.user.email,
        planCode: s.plan.code,
        status: s.status,
        currentPeriodEnd: s.currentPeriodEnd?.toISOString() ?? null,
      })),
    };
  }

  async aiJobs(status?: string) {
    const rows = await this.repo.listAiJobs(status);
    return {
      jobs: rows.map((j) => ({
        id: j.id,
        courseId: j.courseId,
        documentId: j.documentId,
        type: j.type,
        status: j.status,
        progress: j.progress,
        progressLabel: j.progressLabel,
        error: j.error,
        queuedAt: j.queuedAt.toISOString(),
        startedAt: j.startedAt?.toISOString() ?? null,
        finishedAt: j.finishedAt?.toISOString() ?? null,
        courseTitle: j.course.title,
        requesterEmail: j.requester.email,
      })),
    };
  }

  async aiJobDetail(id: string) {
    const job = await this.repo.findAiJobDetail(id);
    if (!job) throw ApiError.notFound('Không tìm thấy AI job.');
    const runs = await this.repo.listRunsForJob(job.id);
    return {
      id: job.id,
      courseId: job.courseId,
      documentId: job.documentId,
      type: job.type,
      status: job.status,
      progress: job.progress,
      progressLabel: job.progressLabel,
      error: job.error,
      queuedAt: job.queuedAt.toISOString(),
      startedAt: job.startedAt?.toISOString() ?? null,
      finishedAt: job.finishedAt?.toISOString() ?? null,
      attempt: job.attempt,
      inputParams: (job.inputParams ?? {}) as Record<string, unknown>,
      courseTitle: job.course.title,
      requesterEmail: job.requester.email,
      runs: runs.map((r) => ({
        id: r.id,
        step: r.step,
        model: r.model,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        latencyMs: r.latencyMs,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  /** Chạy lại job thất bại — chỉ hỗ trợ GENERATE_LESSONS (loại duy nhất thật sự tạo bản ghi AIJob;
   * EXTRACT_DOCUMENT chạy qua queue riêng theo Document.status, không có bản ghi AIJob). Ghi AuditLog. */
  async retryAiJob(id: string, admin: AdminContext) {
    const job = await this.repo.findAiJobDetail(id);
    if (!job) throw ApiError.notFound('Không tìm thấy AI job.');
    if (job.status !== 'FAILED')
      throw ApiError.conflict('Chỉ có thể chạy lại job đang ở trạng thái thất bại.');
    if (job.type !== 'GENERATE_LESSONS')
      throw ApiError.badRequest(`Chưa hỗ trợ chạy lại job loại ${job.type}.`);

    const previousError = job.error;
    const updated = await this.repo.resetJobForRetry(job.id);

    const params = job.inputParams as {
      documentIds: string[];
      language: 'vi' | 'en';
      difficulty: 'EASY' | 'MEDIUM' | 'HARD';
    };
    await this.queue.lessonGenerate.add(
      'GENERATE_LESSONS',
      { aiJobId: job.id, courseId: job.courseId, userId: job.requestedById, params },
      {
        jobId: `gen-${job.id}-retry-${Date.now()}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    );

    await this.repo.createAuditLog({
      actorId: admin.adminId,
      action: 'ai_job.retry',
      entityType: 'AIJob',
      entityId: job.id,
      metadata: { previousStatus: 'FAILED', previousError } as Record<string, unknown>,
    });

    return {
      id: updated.id,
      courseId: updated.courseId,
      documentId: updated.documentId,
      type: updated.type,
      status: updated.status,
      progress: updated.progress,
      progressLabel: updated.progressLabel,
      error: updated.error,
      queuedAt: updated.queuedAt.toISOString(),
      startedAt: updated.startedAt?.toISOString() ?? null,
      finishedAt: updated.finishedAt?.toISOString() ?? null,
    };
  }

  async aiJobAuditLog(id: string) {
    const rows = await this.repo.listAuditLog('AIJob', id);
    return {
      entries: rows.map((r) => ({
        id: r.id,
        actorEmail: r.actor?.email ?? null,
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        metadata: r.metadata,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }
}
