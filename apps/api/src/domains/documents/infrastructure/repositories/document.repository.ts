import { Injectable } from '@nestjs/common';
import { newId } from '@learn/db';
import { PrismaService, type Db } from '../../../../infra/services';

@Injectable()
export class DocumentRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Tài liệu đã xác nhận (không PENDING) trùng checksum trong cùng course — chống upload trùng. */
  findDuplicateInCourse(courseId: string, checksumSha256: string, db: Db = this.prisma.client) {
    return db.document.findFirst({
      where: { courseId, checksumSha256, status: { not: 'PENDING' } },
    });
  }

  /** Tài liệu thuộc người dùng — lọc `uploaderId` tại truy vấn (chống IDOR). */
  findOwned(documentId: string, userId: string, db: Db = this.prisma.client) {
    return db.document.findFirst({
      where: { id: documentId, uploaderId: userId },
      include: { course: true },
    });
  }

  create(
    data: {
      uploaderId: string;
      courseId: string;
      filename: string;
      mimeType: string;
      sizeBytes: number;
      checksumSha256: string;
      storageKey: string;
      status: 'PENDING';
    },
    db: Db = this.prisma.client,
  ) {
    return db.document.create({ data: { id: newId(), ...data } });
  }

  /** Tài liệu nhập văn bản từ điện thoại: tạo `EXTRACTED` cùng chunk trong một transaction. */
  async createExtracted(
    data: {
      id: string;
      uploaderId: string;
      courseId: string;
      filename: string;
      mimeType: string;
      sizeBytes: number;
      checksumSha256: string;
      storageKey: string;
      pageCount: number | null;
    },
    chunks: Array<{
      index: number;
      content: string;
      tokenCount: number;
      pageFrom: number | null;
      pageTo: number | null;
      headingPath: string | null;
    }>,
    db: Db = this.prisma.client,
  ) {
    const doc = await db.document.create({
      data: { ...data, status: 'EXTRACTED', extractedAt: new Date() },
    });
    if (chunks.length > 0) {
      await db.documentChunk.createMany({
        data: chunks.map((c) => ({ id: newId(), documentId: doc.id, ...c })),
      });
    }
    return doc;
  }

  listForCourse(courseId: string, userId: string, db: Db = this.prisma.client) {
    return db.document.findMany({
      where: { courseId, uploaderId: userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  chunkCounts(documentIds: string[], db: Db = this.prisma.client) {
    return db.documentChunk.groupBy({
      by: ['documentId'],
      where: { documentId: { in: documentIds } },
      _count: true,
    });
  }

  /** Cập nhật trạng thái xác nhận — `where` có `status` để hai lần confirm song song chỉ một đi qua. */
  markUploaded(id: string, sizeBytes: number, db: Db) {
    return db.document.update({
      where: { id, status: 'PENDING' },
      data: { sizeBytes, status: 'UPLOADED' },
    });
  }

  delete(id: string, db: Db = this.prisma.client) {
    return db.document.delete({ where: { id } });
  }

  /** Đếm tài liệu thuộc đúng khoá học của người dùng — cho AI job kiểm quyền sở hữu. */
  countOwnedInCourse(
    userId: string,
    courseId: string,
    documentIds: string[],
    db: Db = this.prisma.client,
  ) {
    return db.document.count({
      where: { id: { in: documentIds }, uploaderId: userId, courseId },
    });
  }
}
