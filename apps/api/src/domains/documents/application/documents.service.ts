import { Injectable } from '@nestjs/common';
import { newId } from '@learn/db';
import { resolveUploadMime } from '@learn/contracts';
import type {
  UploadUrlInput,
  UploadUrlResponse,
  ConfirmUploadInput,
  DocumentList,
} from '@learn/contracts';
import { ApiError } from '../../../core/exceptions/errors';
import { QueueService, S3Service } from '../../../infra/services';
import { env } from '../../../environment';
import { UsageService } from '../../subscriptions/application/usage.service';
import { CourseRepository } from '../../courses/infrastructure/repositories/course.repository';
import { DocumentRepository } from '../infrastructure/repositories/document.repository';

@Injectable()
export class DocumentsService {
  constructor(
    private readonly documents: DocumentRepository,
    private readonly courses: CourseRepository,
    private readonly s3: S3Service,
    private readonly queue: QueueService,
    private readonly usage: UsageService,
  ) {}

  async requestUpload(
    userId: string,
    courseId: string,
    input: UploadUrlInput,
  ): Promise<UploadUrlResponse> {
    await this.ownedCourse(courseId, userId);
    // MIME theo đuôi file, không tin `File.type` của trình duyệt (rỗng với .md trên Windows).
    const resolved = resolveUploadMime(input.filename, input.mimeType);
    if (!resolved.ok) throw ApiError.unsupportedFile(resolved.reason);
    const mimeType = resolved.mime;
    if (input.sizeBytes > env.DOCUMENT_MAX_SIZE)
      throw ApiError.payloadTooLarge('Tài liệu vượt giới hạn dung lượng tải lên.');

    // Chặn trùng theo checksum trong cùng Course — HANDBOOK §7.2. Bỏ qua document còn `PENDING`
    // (đã xin presigned URL nhưng chưa từng confirm — coi như bỏ dở, không nên chặn upload lại
    // đúng file đó lần nữa).
    const duplicate = await this.documents.findDuplicateInCourse(courseId, input.checksumSha256);
    if (duplicate) {
      throw ApiError.conflict(
        `Tài liệu này đã tồn tại trong khóa học (trùng nội dung với "${duplicate.filename}").`,
      );
    }

    // Chỉ *kiểm tra* ở đây, chưa trừ hạn mức — việc trừ nằm ở `confirm()`. Vẫn phải kiểm để
    // không phát presigned URL cho người đã hết suất (bằng không họ upload xong 25MB rồi mới
    // bị từ chối).
    await this.usage.assertNotExceeded(userId, 'DOCUMENTS_UPLOADED');

    const safeName = input.filename.replace(/[^\w.\-\u00C0-\u1EF9 ]/g, '_').slice(0, 255);
    const key = `${userId}/documents/${newId()}.${safeName}`;
    const document = await this.documents.create({
      uploaderId: userId,
      courseId,
      filename: safeName,
      mimeType,
      sizeBytes: input.sizeBytes,
      checksumSha256: input.checksumSha256,
      storageKey: key,
      status: 'PENDING',
    });

    const uploadUrl = await this.s3.putUploadUrl(key, mimeType, input.sizeBytes);
    return { documentId: document.id, uploadUrl, expiresInSec: env.S3_PUT_URL_EXPIRES_SEC };
  }

  async list(userId: string, courseId: string): Promise<{ documents: DocumentList[] }> {
    await this.ownedCourse(courseId, userId);
    const docs = await this.documents.listForCourse(courseId, userId);
    const urls = await Promise.all(docs.map((d) => this.s3.getDownloadUrl(d.storageKey)));
    const chunkCounts = await this.documents.chunkCounts(docs.map((d) => d.id));
    const chunkMap = new Map(chunkCounts.map((c) => [c.documentId, c._count]));

    return {
      documents: docs.map((d, i) => ({
        id: d.id,
        filename: d.filename,
        mimeType: d.mimeType,
        sizeBytes: d.sizeBytes,
        status: d.status as DocumentList['status'],
        pageCount: d.pageCount,
        chunkCount: chunkMap.get(d.id) ?? 0,
        errorMessage: d.errorMessage,
        createdAt: d.createdAt.toISOString(),
        downloadUrl: urls[i],
      })),
    };
  }

  /**
   * Xác nhận file đã nằm trên storage, trừ hạn mức, rồi mới xếp job trích xuất.
   *
   * Hạn mức trừ ở **đây**, không phải lúc xin presigned URL. Xin URL rồi bỏ dở — đóng tab,
   * mất mạng, đổi ý — là chuyện thường; tính tiền cho lần đó nghĩa là người dùng mất suất
   * cho một tài liệu chưa bao giờ tồn tại, và không có đường tự lấy lại.
   *
   * Việc đẩy job vào BullMQ nằm **ngoài** transaction: nếu transaction rollback sau khi job
   * đã vào queue thì worker sẽ đi tìm một document ở trạng thái không như nó mong đợi.
   */
  async confirm(userId: string, documentId: string, input: ConfirmUploadInput) {
    const doc = await this.ownedDocument(documentId, userId);
    if (doc.status !== 'PENDING') throw ApiError.conflict('Tài liệu đã được xác nhận.');
    if (input.sizeBytes > env.DOCUMENT_MAX_SIZE)
      throw ApiError.payloadTooLarge('Tài liệu vượt giới hạn dung lượng tải lên.');

    const updated = await this.usage.consume(userId, 'DOCUMENTS_UPLOADED', (tx) =>
      this.documents.markUploaded(doc.id, input.sizeBytes, tx),
    );

    // Worker M3 xử lý; queue sẵn sàng từ M0 — kiểu job trùng AIJobType.
    await this.queue.documentExtract.add(
      'EXTRACT_DOCUMENT',
      { documentId: doc.id, courseId: doc.courseId, requestedById: userId },
      { jobId: `extract-${doc.id}`, attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
    );

    return { documentId: doc.id, status: updated.status };
  }

  async getDownload(userId: string, documentId: string) {
    const doc = await this.ownedDocument(documentId, userId);
    return { url: await this.s3.getDownloadUrl(doc.storageKey) };
  }

  /**
   * Xoá Document — HANDBOOK §7.2 `DELETE /documents/:id`: "Xoá file trên storage + chunk trong DB".
   * Document không có `deletedAt` (khác Course/Lesson) nên đây là hard delete thật; `DocumentChunk`
   * tự xoá theo `onDelete: Cascade`. Chặn khi đang `EXTRACTING` — worker đang giữ tham chiếu tới
   * document này và sẽ tự cập nhật trạng thái khi xong; xoá giữa chừng làm `prisma.document.update()`
   * phía worker ném lỗi "record not found" (job BullMQ fail không rõ nguyên nhân với người đọc log).
   */
  async remove(userId: string, documentId: string): Promise<{ ok: true }> {
    const doc = await this.ownedDocument(documentId, userId);
    if (doc.status === 'EXTRACTING') {
      throw ApiError.conflict('Tài liệu đang được xử lý, vui lòng thử lại sau khi xong.');
    }

    await this.documents.delete(doc.id);

    try {
      await this.s3.deleteObject(doc.storageKey);
    } catch {
      // Best-effort: DB đã xoá sạch (nguồn sự thật); object storage mồ côi không ảnh hưởng người
      // dùng, chỉ là rác lưu trữ — không rollback DB vì file có thể đã không tồn tại (chưa PUT xong).
    }

    return { ok: true };
  }

  private async ownedCourse(courseId: string, userId: string) {
    const course = await this.courses.findOwned(courseId, userId);
    if (!course) throw ApiError.notFound('Không tìm thấy khóa học.');
    return course;
  }

  private async ownedDocument(documentId: string, userId: string) {
    const doc = await this.documents.findOwned(documentId, userId);
    if (!doc) throw ApiError.notFound('Không tìm thấy tài liệu.');
    return doc;
  }
}
