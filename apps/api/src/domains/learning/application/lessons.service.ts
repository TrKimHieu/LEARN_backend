import { Injectable } from '@nestjs/common';
import type {
  LessonSource,
  LessonSummary,
  LessonRead,
  PatchLessonInput,
  ReorderLessonsInput,
} from '@learn/contracts';
import { ApiError } from '../../../core/exceptions/errors';
import { PrismaService } from '../../../infra/services';
import { CourseRepository } from '../../courses/infrastructure/repositories/course.repository';
import { LessonRepository } from '../infrastructure/repositories/lesson.repository';
import { LearningProgressRepository } from '../infrastructure/repositories/learning-progress.repository';
import { ExerciseRepository } from '../infrastructure/repositories/exercise.repository';

/** Đủ để đối chiếu một ý trong bài; chunk đầy đủ ~1200 token (~4800 ký tự). */
const SOURCE_EXCERPT_MAX = 1500;

@Injectable()
export class LessonsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly courses: CourseRepository,
    private readonly lessons: LessonRepository,
    private readonly progress: LearningProgressRepository,
    private readonly exercises: ExerciseRepository,
  ) {}

  async listSummaries(userId: string, courseId: string): Promise<{ lessons: LessonSummary[] }> {
    const course = await this.ownedCourse(courseId, userId);
    const lessons = await this.lessons.listForCourse(course.id);
    const progress = await this.progress.findManyForUser(userId, course.id);
    const progressMap = new Map(progress.map((p) => [p.lessonId, p]));
    const exerciseCounts = await this.exercises.countByLesson(course.id);
    const countMap = new Map(exerciseCounts.map((c) => [c.lessonId, c._count]));

    return {
      lessons: lessons.map((l) => {
        const p = progressMap.get(l.id);
        return {
          id: l.id,
          title: l.title,
          orderIndex: l.orderIndex,
          status: l.status as LessonSummary['status'],
          exerciseCount: countMap.get(l.id) ?? 0,
          confidence: l.confidence,
          progressStatus: p?.status ?? 'NOT_STARTED',
          bestScore: p?.bestScore ?? null,
        };
      }),
    };
  }

  async getLessonRead(userId: string, courseId: string, lessonId: string): Promise<LessonRead> {
    const course = await this.ownedCourse(courseId, userId);
    const lesson = await this.lessons.findInCourse(lessonId, course.id);
    if (!lesson) throw ApiError.notFound('Không tìm thấy bài học.');
    const p = await this.progress.findUnique(userId, lesson.id);
    return {
      id: lesson.id,
      title: lesson.title,
      summary: lesson.summary,
      contentMd: lesson.contentMd,
      estimatedMinutes: lesson.estimatedMinutes,
      orderIndex: lesson.orderIndex,
      status: lesson.status as LessonRead['status'],
      sourceChunkIds: lesson.sourceChunkIds,
      confidence: lesson.confidence,
      editedByUserAt: lesson.editedByUserAt?.toISOString() ?? null,
      progress: {
        status: p?.status ?? 'NOT_STARTED',
        bestScore: p?.bestScore ?? null,
      },
    };
  }

  /**
   * Đoạn tài liệu gốc của bài học — FR-LESSON-12. Thứ tự theo tài liệu rồi vị trí chunk (đọc
   * xuôi như tài liệu gốc), không theo thứ tự LLM liệt kê.
   */
  async getLessonSources(
    userId: string,
    courseId: string,
    lessonId: string,
  ): Promise<{ sources: LessonSource[] }> {
    const course = await this.ownedCourse(courseId, userId);
    const lesson = await this.lessons.findInCourse(lessonId, course.id);
    if (!lesson) throw ApiError.notFound('Không tìm thấy bài học.');

    const chunks = await this.lessons.findSourceChunks(course.id, userId, lesson.sourceChunkIds);
    return {
      sources: chunks.map((c) => {
        const truncated = c.content.length > SOURCE_EXCERPT_MAX;
        return {
          chunkId: c.id,
          documentId: c.documentId,
          filename: c.document.filename,
          pageFrom: c.pageFrom,
          pageTo: c.pageTo,
          headingPath: c.headingPath,
          excerpt: truncated ? `${c.content.slice(0, SOURCE_EXCERPT_MAX).trimEnd()}…` : c.content,
          truncated,
        };
      }),
    };
  }

  /** Sửa nội dung Lesson — HANDBOOK §7.2 `PATCH /lessons/:id`, user story C-01. */
  async patchLesson(
    userId: string,
    courseId: string,
    lessonId: string,
    input: PatchLessonInput,
  ): Promise<LessonRead> {
    const course = await this.ownedCourse(courseId, userId);
    const lesson = await this.lessons.findInCourse(lessonId, course.id);
    if (!lesson) throw ApiError.notFound('Không tìm thấy bài học.');
    await this.lessons.update(lesson.id, {
      title: input.title ?? lesson.title,
      summary: input.summary !== undefined ? input.summary : lesson.summary,
      contentMd: input.contentMd ?? lesson.contentMd,
      status: input.status ? (input.status as 'DRAFT' | 'PUBLISHED') : lesson.status,
    });
    return this.getLessonRead(userId, courseId, lessonId);
  }

  /**
   * Sắp xếp lại thứ tự Lesson — HANDBOOK §7.2 `PATCH /courses/:id/lessons/reorder`, user story C-02.
   * `lessonIds` phải là hoán vị đầy đủ của toàn bộ Lesson (chưa xoá) trong Course — không cho sắp
   * xếp lại một phần vì `orderIndex` phải liên tục 0..n-1 (đúng `@@unique([courseId, orderIndex])`).
   */
  async reorderLessons(userId: string, courseId: string, input: ReorderLessonsInput) {
    const course = await this.ownedCourse(courseId, userId);
    const existing = await this.lessons.listIds(course.id);
    const existingIds = new Set(existing.map((l) => l.id));
    const inputIds = new Set(input.lessonIds);
    if (existingIds.size !== inputIds.size || input.lessonIds.some((id) => !existingIds.has(id))) {
      throw ApiError.badRequest(
        'Danh sách lessonIds phải chứa đúng toàn bộ bài học hiện có của khóa học, không thiếu không thừa.',
      );
    }

    await this.prisma.client.$transaction(async (tx) => {
      // Vẫn phải đi HAI lượt: `@@unique([courseId, orderIndex])` áp dụng ngay trong câu lệnh, nên
      // gán thẳng 0..n-1 sẽ đụng nhau ở những vị trí hoán đổi. Lượt một đẩy tất cả xuống vùng
      // orderIndex âm (không ai đang dùng), lượt hai kéo lên đúng chỗ.
      //
      // Base phải tính động từ MIN(orderIndex) thật của TOÀN BỘ lesson (kể cả đã xoá mềm) —
      // deleteLesson() có thể đã đẩy một lesson đã xoá xuống orderIndex âm, nếu dùng base cố định
      // `-1-i` như trước sẽ đụng đúng giá trị đó (lỗi 500 thật tìm thấy khi test reorder sau khi
      // xoá 1 lesson).
      //
      // Khác biệt so với bản trước: mỗi lượt giờ là **một** câu `UPDATE … FROM (VALUES …)` thay
      // cho N câu `update()` riêng. Sắp lại 30 bài học từng là 60 round-trip nối tiếp nhau bên
      // trong transaction (`Promise.all` không giúp gì — Prisma dồn chúng qua cùng một kết nối),
      // đủ lâu để chạm mốc hết hạn transaction; nay là 2.
      const { _min } = await this.lessons.minOrderIndex(course.id, tx);
      const tempBase = Math.min(_min.orderIndex ?? 0, 0) - 1;

      await this.lessons.assignOrderIndexes(tx, course.id, input.lessonIds, (i) => tempBase - i);
      await this.lessons.assignOrderIndexes(tx, course.id, input.lessonIds, (i) => i);
    });

    return this.listSummaries(userId, courseId);
  }

  /**
   * Xoá Lesson (soft delete) — HANDBOOK §7.2 `DELETE /lessons/:id`.
   * Đẩy `orderIndex` của Lesson bị xoá xuống dưới mọi giá trị hiện có (kể cả của Lesson đã xoá trước
   * đó) để không đụng `@@unique([courseId, orderIndex])` khi sau này `reorderLessons()` gán lại
   * 0..n-1 cho các Lesson còn hoạt động — Postgres không biết `deletedAt` là soft-delete nên chỉ số
   * unique vẫn áp dụng cho mọi dòng, kể cả dòng đã "xoá".
   */
  async deleteLesson(userId: string, courseId: string, lessonId: string): Promise<{ ok: true }> {
    const course = await this.ownedCourse(courseId, userId);
    const lesson = await this.lessons.findInCourse(lessonId, course.id);
    if (!lesson) throw ApiError.notFound('Không tìm thấy bài học.');

    const { _min } = await this.lessons.minOrderIndex(course.id, this.prisma.client);
    const safeIndex = Math.min(_min.orderIndex ?? 0, lesson.orderIndex) - 1;

    await this.lessons.softDelete(lesson.id, safeIndex);
    return { ok: true };
  }

  /** Đánh dấu bắt đầu học — HANDBOOK §7.2 `POST /lessons/:id/start`. Idempotent, không hạ cấp COMPLETED. */
  async startLesson(userId: string, courseId: string, lessonId: string) {
    const course = await this.ownedCourse(courseId, userId);
    const lesson = await this.lessons.findInCourse(lessonId, course.id);
    if (!lesson) throw ApiError.notFound('Không tìm thấy bài học.');

    const existing = await this.progress.findUnique(userId, lessonId);
    if (existing) return { status: existing.status };

    const created = await this.progress.create({
      userId,
      courseId: course.id,
      lessonId,
    });
    return { status: created.status };
  }

  private async ownedCourse(courseId: string, userId: string) {
    const course = await this.courses.findOwned(courseId, userId);
    if (!course) throw ApiError.notFound('Không tìm thấy khóa học.');
    return course;
  }
}
