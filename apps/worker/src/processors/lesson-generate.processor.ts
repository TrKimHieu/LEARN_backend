import { Injectable, Logger } from '@nestjs/common';
import { prisma, newId, Prisma } from '@learn/db';
import {
  outlinePrompt,
  outlineCoverage,
  coverageFeedback,
  OUTLINE_PROMPT_VERSION,
  OUTLINE_PREVIEW_CHARS,
  OUTLINE_MAX_UNCOVERED_RATIO,
  OutlineOutput,
  lessonPrompt,
  LESSON_PROMPT_VERSION,
  validateLessonOutput,
  extractJson,
  type LlmProvider,
  type OutlineOutputT,
  type LessonOutputT,
} from '@learn/ai';
import { RedisPublisher } from '../common/redis';
import { createLlmProvider, estimateCostUsd } from '../common/llm';
import { env } from '../environment';

export interface LessonGenerateJobData {
  aiJobId: string;
  courseId: string;
  userId: string;
  params: { documentIds: string[]; language: 'vi' | 'en'; difficulty: 'EASY' | 'MEDIUM' | 'HARD' };
}

interface RunRecord {
  step: string;
  model: string;
  promptVersion: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  attempt: number;
  validationReport?: unknown;
}

@Injectable()
export class LessonGenerateProcessor {
  private readonly logger = new Logger(LessonGenerateProcessor.name);
  private readonly llm: LlmProvider = createLlmProvider();

  constructor(private readonly redis: RedisPublisher) {}

  async process(data: LessonGenerateJobData): Promise<void> {
    const { aiJobId, courseId, params } = data;
    const job = await prisma.aIJob.findUnique({ where: { id: aiJobId } });
    if (!job) {
      this.logger.warn(`AIJob ${aiJobId} không tồn tại — bỏ qua.`);
      return;
    }
    if (job.status !== 'QUEUED') {
      this.logger.log(`AIJob ${aiJobId} status=${job.status}, bỏ qua (idempotent).`);
      return;
    }
    const claimed = await prisma.aIJob.updateMany({
      where: { id: aiJobId, status: 'QUEUED' },
      data: { status: 'RUNNING', startedAt: new Date(), attempt: { increment: 1 } },
    });
    if (claimed.count === 0) return; // worker khác đã nhận

    const deadline = Date.now() + env.AI_JOB_TIMEOUT_MS;
    const runs: RunRecord[] = [];
    let costSoFar = 0;

    try {
      await this.publish(aiJobId, {
        status: 'RUNNING',
        progress: 5,
        label: 'Đang chuẩn bị dữ liệu',
      });
      await this.assertNotCancelled(aiJobId);

      const course = await prisma.course.findUniqueOrThrow({ where: { id: courseId } });
      const chunks = await prisma.documentChunk.findMany({
        where: {
          document: {
            courseId,
            status: 'EXTRACTED',
            ...(params.documentIds.length ? { id: { in: params.documentIds } } : {}),
          },
        },
        orderBy: [{ documentId: 'asc' }, { index: 'asc' }],
      });
      if (chunks.length === 0) {
        throw new JobError(
          'NO_EXTRACTED_CONTENT',
          'Chưa có tài liệu nào trích xuất xong trong khóa học này để sinh bài học.',
        );
      }

      const chunkContentById = new Map(chunks.map((c) => [c.id, c.content]));
      const availableChunkIds = chunks.map((c) => c.id);
      const language = params.language ?? (course.language as 'vi' | 'en');

      // ── Giai đoạn A: Outline (1 lần gọi, retry tối đa 2 lần lỗi schema) — HANDBOOK §8.3 ──
      await this.publish(aiJobId, { status: 'RUNNING', progress: 15, label: 'Đang lập outline' });
      const outline = await this.generateOutline(
        aiJobId,
        {
          language,
          chunks: chunks.map((c) => ({
            id: c.id,
            headingPath: c.headingPath ?? '',
            preview: c.content.slice(0, OUTLINE_PREVIEW_CHARS),
          })),
        },
        runs,
        (cost) => (costSoFar += cost),
        deadline,
      );
      await this.assertNotCancelled(aiJobId);

      // ── Giai đoạn B: Lesson + Exercise (song song tối đa AI_MAX_CONCURRENT_CALLS) ──
      const existingLessonTitles = (
        await prisma.lesson.findMany({
          where: { courseId, deletedAt: null },
          select: { title: true },
        })
      ).map((l) => l.title.trim().toLowerCase());

      // Kết quả ghi theo CHỈ SỐ của node trong outline, không `push` theo thứ tự hoàn thành.
      // Các lượt gọi chạy song song nên thứ tự về đích là ngẫu nhiên; `push` làm `orderIndex`
      // của bài học phụ thuộc bài nào LLM trả lời nhanh hơn, tức trình tự sư phạm của outline
      // bị xáo mỗi lần chạy.
      type NodeResult =
        | { ok: true; lesson: LessonOutputT; confidence: 'HIGH' | 'LOW' }
        | { ok: false; node: OutlineOutputT['nodes'][number]; errors: string[] };
      const slots: Array<NodeResult | undefined> = new Array(outline.nodes.length);
      const titlesSoFar = [...existingLessonTitles];

      let completed = 0;
      let cancelled = false;
      await mapLimit(outline.nodes, env.AI_MAX_CONCURRENT_CALLS, async (node, nodeIndex) => {
        if (cancelled) return;
        if (await this.isCancelled(aiJobId)) {
          cancelled = true;
          return;
        }
        if (Date.now() > deadline) {
          slots[nodeIndex] = { ok: false, node, errors: ['Hết thời gian job (timeout).'] };
          return;
        }
        if (costSoFar >= env.AI_JOB_MAX_COST_USD) {
          slots[nodeIndex] = {
            ok: false,
            node,
            errors: ['Vượt trần chi phí job (AI_JOB_MAX_COST_USD).'],
          };
          return;
        }
        const nodeChunks = node.chunkIds
          .filter((id) => chunkContentById.has(id))
          .map((id) => ({ id, content: chunkContentById.get(id) as string }));
        const outcome = await this.generateLesson(
          aiJobId,
          {
            language,
            courseTitle: course.title,
            nodeTitle: node.title,
            nodeDescription: node.description,
            chunks: nodeChunks,
            difficulty: params.difficulty,
          },
          { availableChunkIds, chunkContentById, existingLessonTitles: titlesSoFar },
          runs,
          (cost) => (costSoFar += cost),
        );
        if (outcome.ok) {
          titlesSoFar.push(outcome.lesson.title.trim().toLowerCase());
          slots[nodeIndex] = { ok: true, lesson: outcome.lesson, confidence: outcome.confidence };
        } else {
          slots[nodeIndex] = { ok: false, node, errors: outcome.errors };
        }
        completed += 1;
        await this.publish(aiJobId, {
          status: 'RUNNING',
          progress: 20 + Math.round((completed / outline.nodes.length) * 70),
          label: `Đã sinh ${completed}/${outline.nodes.length} bài học`,
        });
      });

      if (cancelled) {
        throw new JobCancelledError();
      }

      const results = slots.filter((r): r is NodeResult => r !== undefined);
      const succeeded = results.filter(
        (r): r is { ok: true; lesson: LessonOutputT; confidence: 'HIGH' | 'LOW' } => r.ok,
      );
      const failed = results.filter(
        (r): r is { ok: false; node: OutlineOutputT['nodes'][number]; errors: string[] } => !r.ok,
      );

      if (succeeded.length === 0) {
        throw new JobError('ALL_LESSONS_FAILED', 'Không sinh được bài học nào hợp lệ.', {
          failures: failed.map((f) => ({ node: f.node.title, errors: f.errors })),
        });
      }

      // ── Ghi DB trong một transaction — HANDBOOK §8.3/§8.4 ──
      //
      // Trước đây khối này `create()` từng dòng một trong bốn vòng lặp lồng nhau. Một lượt
      // sinh 10 bài học × 2 bài tập × 5 câu hỏi × 4 phương án = 10 + 20 + 100 + 400 ≈ **530
      // round-trip tuần tự** giữ khoá và một kết nối trong suốt thời gian đó. Transaction
      // tương tác của Prisma mặc định hết hạn sau 5 giây, nên lượt sinh lớn sẽ P2028 và mất
      // sạch kết quả — sau khi đã trả tiền cho toàn bộ lời gọi LLM.
      //
      // Nay: dựng toàn bộ dòng trong bộ nhớ trước (id sinh sẵn nên biết khoá ngoại mà không
      // cần INSERT … RETURNING), rồi 4 lệnh `createMany` theo đúng thứ tự phụ thuộc.
      const rows = buildLessonRows(succeeded, {
        courseId,
        aiJobId,
        startIndex: await nextOrderIndex(courseId),
      });

      await prisma.$transaction(
        async (tx) => {
          await tx.lesson.createMany({ data: rows.lessons });
          if (rows.exercises.length) await tx.exercise.createMany({ data: rows.exercises });
          if (rows.questions.length) await tx.question.createMany({ data: rows.questions });
          if (rows.options.length) await tx.answerOption.createMany({ data: rows.options });
        },
        // Cận trên rộng rãi cho lượt sinh lớn; 4 câu lệnh thì vẫn về trong tích tắc.
        { timeout: 30_000, maxWait: 10_000 },
      );
      const lessonIds = rows.lessons.map((l) => l.id);

      const partialFailures =
        failed.length > 0
          ? failed.map((f) => ({ node: f.node.title, errors: f.errors }))
          : undefined;

      await prisma.aIJob.update({
        where: { id: aiJobId },
        data: {
          status: 'SUCCEEDED',
          progress: 100,
          progressLabel: 'Hoàn tất',
          finishedAt: new Date(),
          error: partialFailures
            ? ({
                code: 'PARTIAL_FAILURES',
                message: 'Một số bài học không sinh được.',
                detail: { partialFailures },
              } as never)
            : undefined,
        },
      });
      await this.publish(aiJobId, {
        status: 'SUCCEEDED',
        progress: 100,
        label: 'Hoàn tất',
        lessonIds,
        lessonCount: lessonIds.length,
      });
      this.logger.log(
        `AIJob ${aiJobId} SUCCEEDED — ${lessonIds.length} lesson, ${failed.length} lỗi.`,
      );
    } catch (err) {
      await this.fail(aiJobId, err);
    }
  }

  private async generateOutline(
    aiJobId: string,
    ctx: {
      language: 'vi' | 'en';
      chunks: Array<{ id: string; headingPath: string; preview: string }>;
    },
    runs: RunRecord[],
    addCost: (n: number) => void,
    deadline: number,
  ): Promise<OutlineOutputT> {
    let previousError: string | undefined;
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (Date.now() > deadline) throw new JobError('AI_GENERATION_TIMEOUT', 'Hết thời gian job.');
      const prompt = outlinePrompt({ ...ctx, previousError });
      const res = await this.callLlm(prompt);
      const cost = estimateCostUsd(res.model, res.inputTokens, res.outputTokens);
      addCost(cost);
      await this.recordRun(
        aiJobId,
        'outline',
        res.model,
        OUTLINE_PROMPT_VERSION,
        res,
        cost,
        attempt,
      );

      let raw: unknown;
      try {
        raw = extractJson(res.text);
      } catch (e) {
        previousError = e instanceof Error ? e.message : 'Output không phải JSON hợp lệ.';
        if (attempt >= 3) throw new JobError('OUTLINE_SCHEMA_INVALID', previousError);
        continue;
      }
      const parsed = OutlineOutput.safeParse(raw);
      if (parsed.success) {
        // Outline hợp lệ về schema nhưng bỏ sót nhiều mục thì lập lại một lần nữa, kèm danh sách
        // mục bị sót. Hết lượt thì vẫn nhận: một khoá học thiếu vài mục tốt hơn job thất bại.
        const coverage = outlineCoverage(parsed.data, ctx.chunks);
        if (coverage.ratio <= OUTLINE_MAX_UNCOVERED_RATIO || attempt >= 3) return parsed.data;
        previousError = coverageFeedback(coverage);
        this.logger.warn(`AIJob ${aiJobId} outline lần ${attempt}: ${previousError}`);
        continue;
      }
      previousError = parsed.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ');
      if (attempt >= 3) throw new JobError('OUTLINE_SCHEMA_INVALID', previousError);
    }
    throw new JobError(
      'OUTLINE_SCHEMA_INVALID',
      previousError ?? 'Không sinh được outline hợp lệ.',
    );
  }

  private async generateLesson(
    aiJobId: string,
    ctx: {
      language: 'vi' | 'en';
      courseTitle: string;
      nodeTitle: string;
      nodeDescription: string;
      chunks: Array<{ id: string; content: string }>;
      difficulty?: 'EASY' | 'MEDIUM' | 'HARD';
    },
    validateCtx: {
      availableChunkIds: string[];
      chunkContentById: Map<string, string>;
      existingLessonTitles: string[];
    },
    runs: RunRecord[],
    addCost: (n: number) => void,
  ): Promise<
    | { ok: true; lesson: LessonOutputT; confidence: 'HIGH' | 'LOW' }
    | { ok: false; errors: string[] }
  > {
    let previousError: string | undefined;
    const MAX_SCHEMA_RETRY = 2;
    const MAX_RULE_RETRY = 1;
    let schemaAttempts = 0;
    let ruleAttempts = 0;

    for (let attempt = 1; attempt <= MAX_SCHEMA_RETRY + MAX_RULE_RETRY + 1; attempt++) {
      const prompt = lessonPrompt({ ...ctx, previousError });
      const res = await this.callLlm(prompt);
      const cost = estimateCostUsd(res.model, res.inputTokens, res.outputTokens);
      addCost(cost);

      let raw: unknown;
      try {
        raw = extractJson(res.text);
      } catch (e) {
        await this.recordRun(
          aiJobId,
          `lesson:${ctx.nodeTitle}`,
          res.model,
          LESSON_PROMPT_VERSION,
          res,
          cost,
          attempt,
        );
        previousError = e instanceof Error ? e.message : 'Output không phải JSON hợp lệ.';
        schemaAttempts += 1;
        if (schemaAttempts > MAX_SCHEMA_RETRY) return { ok: false, errors: [previousError] };
        continue;
      }

      const result = validateLessonOutput(raw, validateCtx);
      await this.recordRun(
        aiJobId,
        `lesson:${ctx.nodeTitle}`,
        res.model,
        LESSON_PROMPT_VERSION,
        res,
        cost,
        attempt,
        result.ok ? { confidence: result.confidence } : { errors: result.errors },
      );

      if (result.ok) return { ok: true, lesson: result.lesson, confidence: result.confidence };

      previousError = result.errors.join('; ');
      const isSchemaError = result.errors.some((e) => e.includes(':')); // path: message → tầng 1
      if (isSchemaError) {
        schemaAttempts += 1;
        if (schemaAttempts > MAX_SCHEMA_RETRY) return { ok: false, errors: result.errors };
      } else {
        ruleAttempts += 1;
        if (ruleAttempts > MAX_RULE_RETRY) return { ok: false, errors: result.errors };
      }
    }
    return { ok: false, errors: [previousError ?? 'Không sinh được lesson hợp lệ.'] };
  }

  private async callLlm(prompt: string) {
    // Timeout 120s mỗi lần gọi — HANDBOOK §8.5.
    return Promise.race([
      this.llm.generate({ prompt }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('LLM call timeout (120s)')), 120_000),
      ),
    ]);
  }

  private async recordRun(
    aiJobId: string,
    step: string,
    model: string,
    promptVersion: string,
    res: { inputTokens: number; outputTokens: number; latencyMs: number },
    costUsd: number,
    attempt: number,
    validationReport?: unknown,
  ): Promise<void> {
    await prisma.generationRun.create({
      data: {
        id: newId(),
        aiJobId,
        step,
        model,
        promptVersion,
        inputTokens: res.inputTokens,
        outputTokens: res.outputTokens,
        costUsd: new Prisma.Decimal(costUsd.toFixed(6)),
        latencyMs: res.latencyMs,
        attempt,
        validationReport: (validationReport ?? undefined) as never,
      },
    });
  }

  private async publish(aiJobId: string, event: Record<string, unknown>): Promise<void> {
    await prisma.aIJob.updateMany({
      where: { id: aiJobId, status: { in: ['RUNNING', 'QUEUED'] } },
      data: {
        progress: (event.progress as number) ?? undefined,
        progressLabel: (event.label as string) ?? undefined,
      },
    });
    await this.redis.publishJobEvent(aiJobId, event);
  }

  /** Job bị đánh dấu CANCELLED (bởi admin/chính người dùng) từ nơi khác trong lúc đang chạy? */
  private async isCancelled(aiJobId: string): Promise<boolean> {
    const row = await prisma.aIJob.findUnique({
      where: { id: aiJobId },
      select: { status: true },
    });
    return row?.status === 'CANCELLED';
  }

  private async assertNotCancelled(aiJobId: string): Promise<void> {
    if (await this.isCancelled(aiJobId)) throw new JobCancelledError();
  }

  private async fail(aiJobId: string, err: unknown): Promise<void> {
    if (err instanceof JobCancelledError) {
      // Status đã là CANCELLED (do endpoint huỷ đặt) — chỉ ghi finishedAt + publish sự kiện.
      await prisma.aIJob.updateMany({
        where: { id: aiJobId, status: 'CANCELLED' },
        data: { finishedAt: new Date() },
      });
      await this.redis.publishJobEvent(aiJobId, {
        status: 'CANCELLED',
        code: 'CANCELLED_BY_USER',
        message: 'Job đã được huỷ.',
      });
      this.logger.log(`AIJob ${aiJobId} CANCELLED theo yêu cầu người dùng.`);
      return;
    }
    const jobErr =
      err instanceof JobError
        ? err
        : new JobError('AI_GENERATION_FAILED', err instanceof Error ? err.message : String(err));
    await prisma.aIJob.update({
      where: { id: aiJobId },
      data: {
        status: 'FAILED',
        finishedAt: new Date(),
        error: {
          code: jobErr.code,
          message: jobErr.message,
          detail: jobErr.detail ?? null,
        } as never,
      },
    });
    await this.redis.publishJobEvent(aiJobId, {
      status: 'FAILED',
      code: jobErr.code,
      message: jobErr.message,
    });
    this.logger.error(`AIJob ${aiJobId} FAILED [${jobErr.code}]: ${jobErr.message}`);
  }
}

class JobError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'JobError';
  }
}

class JobCancelledError extends JobError {
  constructor() {
    super('CANCELLED_BY_USER', 'Job đã được huỷ theo yêu cầu người dùng.');
    this.name = 'JobCancelledError';
  }
}

/**
 * Chạy tối đa `limit` promise song song — HANDBOOK §8.3: giới hạn 3 lần gọi cùng lúc.
 * Truyền cả chỉ số để caller ghi kết quả vào đúng ô, không phụ thuộc thứ tự hoàn thành.
 */
async function mapLimit<T>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const i = index++;
      await fn(items[i] as T, i);
    }
  });
  await Promise.all(workers);
}

/**
 * `orderIndex` kế tiếp cho Course.
 *
 * Phải là `MAX(orderIndex) + 1` của các Lesson **chưa xoá**, không phải `count()`:
 * `deleteLesson()` đẩy Lesson đã xoá mềm xuống orderIndex ÂM để không đụng
 * `@@unique([courseId, orderIndex])`, nên `count()` đếm cả chúng và thổi phồng chỉ số —
 * lộ trình bài học hiện ra các khoảng trống.
 */
async function nextOrderIndex(courseId: string): Promise<number> {
  const { _max } = await prisma.lesson.aggregate({
    where: { courseId, deletedAt: null },
    _max: { orderIndex: true },
  });
  return (_max.orderIndex ?? -1) + 1;
}

interface BuiltRows {
  lessons: Prisma.LessonCreateManyInput[];
  exercises: Prisma.ExerciseCreateManyInput[];
  questions: Prisma.QuestionCreateManyInput[];
  options: Prisma.AnswerOptionCreateManyInput[];
}

/**
 * Chuyển kết quả LLM đã hợp lệ thành 4 mảng dòng sẵn sàng `createMany`.
 * Hàm thuần — unit-test được mà không cần DB.
 */
export function buildLessonRows(
  succeeded: Array<{ lesson: LessonOutputT; confidence: 'HIGH' | 'LOW' }>,
  ctx: { courseId: string; aiJobId: string; startIndex: number },
): BuiltRows {
  const rows: BuiltRows = { lessons: [], exercises: [], questions: [], options: [] };

  succeeded.forEach(({ lesson, confidence }, i) => {
    const lessonId = newId();
    rows.lessons.push({
      id: lessonId,
      courseId: ctx.courseId,
      aiJobId: ctx.aiJobId,
      orderIndex: ctx.startIndex + i,
      title: lesson.title,
      summary: lesson.summary,
      contentMd: lesson.contentMd,
      estimatedMinutes: lesson.estimatedMinutes,
      sourceChunkIds: lesson.sourceChunkIds,
      confidence,
      status: 'DRAFT',
    });

    lesson.exercises.forEach((ex, ei) => {
      const exerciseId = newId();
      rows.exercises.push({
        id: exerciseId,
        lessonId,
        orderIndex: ei,
        title: ex.title,
        instruction: ex.instruction,
        difficulty: ex.difficulty,
      });

      ex.questions.forEach((q, qi) => {
        const questionId = newId();
        rows.questions.push({
          id: questionId,
          exerciseId,
          orderIndex: qi,
          type: q.type,
          prompt: q.prompt,
          explanation: q.explanation,
          correctAnswer: correctAnswerOf(q) as never,
          sourceChunkId: q.sourceChunkId,
        });

        if (q.type === 'MULTIPLE_CHOICE') {
          q.options.forEach((o, oi) => {
            rows.options.push({
              id: newId(),
              questionId,
              orderIndex: oi,
              label: String.fromCharCode(65 + oi),
              content: o.content,
              isCorrect: o.isCorrect,
            });
          });
        }
      });
    });
  });

  return rows;
}

/**
 * Khớp đúng field mà `exercises.service.ts#gradeAnswer` đọc: MULTIPLE_CHOICE chấm qua
 * `AnswerOption.isCorrect` (không dùng `correctAnswer`); TRUE_FALSE cần `value`;
 * SHORT_ANSWER/FILL_BLANK cần `acceptable` (mảng đáp án chấp nhận được).
 */
function correctAnswerOf(
  q: LessonOutputT['exercises'][number]['questions'][number],
): Record<string, unknown> {
  switch (q.type) {
    case 'MULTIPLE_CHOICE':
      return { correctIndex: q.options.findIndex((o) => o.isCorrect) };
    case 'TRUE_FALSE':
      return { value: q.answer };
    case 'SHORT_ANSWER':
      return { acceptable: [q.modelAnswer] };
    default:
      return { acceptable: [q.answer] };
  }
}
