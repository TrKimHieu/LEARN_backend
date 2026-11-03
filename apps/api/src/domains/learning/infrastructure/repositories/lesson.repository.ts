import { Injectable } from '@nestjs/common';
import { Prisma } from '@learn/db';
import { PrismaService, type Db } from '../../../../infra/services';

@Injectable()
export class LessonRepository {
  constructor(private readonly prisma: PrismaService) {}

  listForCourse(courseId: string, db: Db = this.prisma.client) {
    return db.lesson.findMany({
      where: { courseId, deletedAt: null },
      orderBy: { orderIndex: 'asc' },
    });
  }

  /** Chỉ id/title/orderIndex — đủ cho màn tiến độ, không kéo nội dung bài. */
  listLightForCourse(courseId: string, db: Db = this.prisma.client) {
    return db.lesson.findMany({
      where: { courseId, deletedAt: null },
      orderBy: { orderIndex: 'asc' },
      select: { id: true, title: true, orderIndex: true },
    });
  }

  /** Bài học còn sống trong một khoá học — không phụ thuộc người gọi kiểm quyền. */
  findInCourse(lessonId: string, courseId: string, db: Db = this.prisma.client) {
    return db.lesson.findFirst({ where: { id: lessonId, courseId, deletedAt: null } });
  }

  /**
   * Chunk nguồn của một bài học. Lọc theo `document.courseId` **và** chủ sở hữu khoá học ngay
   * trong truy vấn: `sourceChunkIds` là dữ liệu LLM trả về, không được tin là chỉ trỏ vào tài
   * liệu của chính khoá học này (chống IDOR, AGENTS.md).
   */
  findSourceChunks(
    courseId: string,
    ownerId: string,
    chunkIds: string[],
    db: Db = this.prisma.client,
  ) {
    if (chunkIds.length === 0) return Promise.resolve([]);
    return db.documentChunk.findMany({
      where: {
        id: { in: chunkIds },
        document: { courseId, course: { ownerId, deletedAt: null } },
      },
      select: {
        id: true,
        documentId: true,
        index: true,
        content: true,
        pageFrom: true,
        pageTo: true,
        headingPath: true,
        document: { select: { filename: true } },
      },
      orderBy: [{ documentId: 'asc' }, { index: 'asc' }],
    });
  }

  listIds(courseId: string, db: Db = this.prisma.client) {
    return db.lesson.findMany({
      where: { courseId, deletedAt: null },
      select: { id: true },
    });
  }

  update(
    lessonId: string,
    data: {
      title: string;
      summary: string | null;
      contentMd: string;
      status: 'DRAFT' | 'PUBLISHED';
    },
    db: Db = this.prisma.client,
  ) {
    return db.lesson.update({
      where: { id: lessonId },
      data: { ...data, editedByUserAt: new Date() },
    });
  }

  /** Giá trị `orderIndex` nhỏ nhất — base cho việc "đẩy xuống âm" trước khi sắp lại. */
  minOrderIndex(courseId: string, db: Db) {
    return db.lesson.aggregate({
      where: { courseId },
      _min: { orderIndex: true },
    });
  }

  /** Soft delete kèm đẩy `orderIndex` xuống vùng không đụng `@@unique([courseId, orderIndex])`. */
  softDelete(lessonId: string, orderIndex: number, db: Db = this.prisma.client) {
    return db.lesson.update({
      where: { id: lessonId },
      data: { deletedAt: new Date(), orderIndex },
    });
  }

  /** Số bài học còn sống theo chủ sở hữu khoá học (qua nested course) — lọc ownerId tại đây. */
  countForOwner(userId: string, db: Db = this.prisma.client) {
    return db.lesson.count({
      where: { course: { ownerId: userId, deletedAt: null }, deletedAt: null },
    });
  }

  /**
   * Kiểm tra truy cập: bài học còn sống và khoá chứa nó thuộc `userId`.
   * Lọc `course.ownerId` ngay trong truy vấn — chống IDOR (AGENTS.md).
   */
  assertAccessible(lessonId: string, userId: string, db: Db = this.prisma.client) {
    return db.lesson.findFirst({
      where: { id: lessonId, deletedAt: null, course: { ownerId: userId, deletedAt: null } },
      select: { id: true, courseId: true },
    });
  }

  /**
   * Gán `orderIndex` cho một loạt Lesson bằng **một** câu UPDATE.
   *
   * `courseId` nằm trong `WHERE` chứ không chỉ dựa vào danh sách id: id đã được kiểm là thuộc
   * khoá học ở tầng trên, nhưng ràng buộc lặp lại ở đây khiến câu lệnh tự nó an toàn, không phụ
   * thuộc người gọi kiểm đúng.
   */
  async assignOrderIndexes(
    db: Db,
    courseId: string,
    lessonIds: string[],
    indexAt: (position: number) => number,
  ): Promise<void> {
    if (lessonIds.length === 0) return;
    const values = lessonIds.map((id, i) => Prisma.sql`(${id}, ${indexAt(i)})`);
    await db.$executeRaw`
      UPDATE "Lesson" AS l
      SET "orderIndex" = v.idx
      FROM (VALUES ${Prisma.join(values)}) AS v(id, idx)
      WHERE l.id = v.id AND l."courseId" = ${courseId}
    `;
  }
}
