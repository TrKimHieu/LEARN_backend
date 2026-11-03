import { Injectable } from '@nestjs/common';
import { newId } from '@learn/db';
import type { CourseStatus } from '@learn/db';
import { PrismaService, type Db } from '../../../../infra/services';

@Injectable()
export class CourseRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Khóa học còn sống của một người — lọc `ownerId` ngay tại truy vấn (chống IDOR). */
  findOwned(courseId: string, userId: string, db: Db = this.prisma.client) {
    return db.course.findFirst({ where: { id: courseId, ownerId: userId, deletedAt: null } });
  }

  /** Đếm khoá học còn sống của một người — dùng cho progress overview. */
  countOwned(userId: string, db: Db = this.prisma.client) {
    return db.course.count({ where: { ownerId: userId, deletedAt: null } });
  }

  /** Danh sách khoá học kèm số bài học (chưa xoá) — dùng cho màn tiến độ theo khoá. */
  findManyWithLessonCount(userId: string, db: Db = this.prisma.client) {
    return db.course.findMany({
      where: { ownerId: userId, deletedAt: null },
      select: {
        id: true,
        title: true,
        _count: { select: { lessons: { where: { deletedAt: null } } } },
      },
    });
  }

  /** Danh sách khoá học của chủ sở hữu, mới sửa nhất đứng đầu. */
  findManyForOwner(userId: string, db: Db = this.prisma.client) {
    return db.course.findMany({
      where: { ownerId: userId, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
    });
  }

  create(
    input: { ownerId: string; title: string; description: string | null; language: 'vi' | 'en' },
    db: Db,
  ) {
    return db.course.create({ data: { id: newId(), ...input } });
  }

  update(
    courseId: string,
    data: {
      title?: string;
      description?: string | null;
      status?: CourseStatus;
    },
    db: Db = this.prisma.client,
  ) {
    return db.course.update({ where: { id: courseId }, data });
  }

  softDelete(courseId: string, db: Db = this.prisma.client) {
    return db.course.update({ where: { id: courseId }, data: { deletedAt: new Date() } });
  }

  // ── aggregate cho danh sách / chi tiết khoá học ─────────────────────────

  /** Số Lesson còn sống trong Course — bảo toàn ràng buộc deletedAt giống service cũ. */
  countLessons(courseId: string, db: Db = this.prisma.client) {
    return db.lesson.count({ where: { courseId, deletedAt: null } });
  }

  /** Số Lesson còn sống gộp theo từng course — thay cho N câu COUNT. */
  lessonCounts(courseIds: string[], db: Db = this.prisma.client) {
    return db.lesson.groupBy({
      by: ['courseId'],
      where: { courseId: { in: courseIds }, deletedAt: null },
      _count: { _all: true },
    });
  }

  documentCounts(courseIds: string[], db: Db = this.prisma.client) {
    return db.document.groupBy({
      by: ['courseId'],
      where: { courseId: { in: courseIds } },
      _count: { _all: true },
    });
  }

  completedProgressCounts(userId: string, courseIds: string[], db: Db = this.prisma.client) {
    return db.learningProgress.groupBy({
      by: ['courseId'],
      where: { userId, courseId: { in: courseIds }, status: 'COMPLETED' },
      _count: { _all: true },
    });
  }

  /** Số bài học đã hoàn thành của một người trong một khoá học. */
  countCompletedProgress(userId: string, courseId: string, db: Db = this.prisma.client) {
    return db.learningProgress.count({
      where: { userId, courseId, status: 'COMPLETED' },
    });
  }

  /** Điểm trung bình (0-100%) của một người trong course — aggregate trong Postgres. */
  averageScore(userId: string, courseId: string, db: Db = this.prisma.client) {
    return db.submission.aggregate({
      where: { userId, exercise: { lesson: { courseId } } },
      _avg: { score: true },
    });
  }
}
