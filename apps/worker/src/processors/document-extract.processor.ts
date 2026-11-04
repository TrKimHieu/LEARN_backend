import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { prisma, newId } from '@learn/db';
import { chunkPages } from '@learn/ai';
import { S3Service } from '../common/s3';
import {
  extractText,
  UnsupportedFileError,
  ScannedPdfNotSupportedError,
} from '../extraction/extract-text';
import { env } from '../environment';

export interface DocumentExtractJobData {
  documentId: string;
  courseId: string;
  requestedById: string;
}

interface PlanLimits {
  PAGES_PROCESSED?: { limit: number };
}

/**
 * Hạn mức `PAGES_PROCESSED` (HANDBOOK §11.3) có `window: "per_document"` — khác các metric khác
 * (COURSES_CREATED/DOCUMENTS_UPLOADED/AI_JOBS_RUN đều "total"/"month", cộng dồn qua `UsageService`
 * ở apps/api). Vì đây là chặn theo TỪNG tài liệu (không phải bộ đếm cộng dồn), không thể biết trước
 * lúc xin presigned URL (chưa biết `pageCount` thật) — phải chặn ở đây, sau khi trích xuất xong và
 * biết số trang thật, trước khi `env.UPLOAD_MAX_PAGES` (trần cứng toàn hệ thống, không theo gói).
 */
export class PagesQuotaExceededError extends Error {
  constructor(pageCount: number, limit: number) {
    super(
      `Tài liệu có ${pageCount} trang, vượt hạn mức ${limit} trang/tài liệu của gói hiện tại. Nâng cấp gói để xử lý tài liệu dài hơn.`,
    );
    this.name = 'PagesQuotaExceededError';
  }
}

export async function getPagesPerDocumentLimit(uploaderId: string): Promise<number | null> {
  const sub = await prisma.subscription.findFirst({
    where: { userId: uploaderId, status: { in: ['ACTIVE', 'TRIALING'] } },
    orderBy: { updatedAt: 'desc' },
    include: { plan: true },
  });
  const plan =
    sub?.plan ?? (await prisma.plan.findFirst({ where: { code: 'FREE', isActive: true } }));
  const limits = plan?.limits as PlanLimits | undefined;
  return limits?.PAGES_PROCESSED?.limit ?? null;
}

@Injectable()
export class DocumentExtractProcessor {
  private readonly logger = new Logger(DocumentExtractProcessor.name);

  constructor(private readonly s3: S3Service) {}

  async process(data: DocumentExtractJobData): Promise<void> {
    const { documentId } = data;
    const doc = await prisma.document.findUnique({ where: { id: documentId } });
    if (!doc) {
      this.logger.warn(`Document ${documentId} không tồn tại — bỏ qua (có thể đã bị xoá).`);
      return;
    }
    if (doc.status !== 'UPLOADED') {
      // Idempotent — HANDBOOK §9.2: job chạy lại hoặc worker khác đã nhận, không làm lại.
      this.logger.log(`Document ${documentId} status=${doc.status}, bỏ qua.`);
      return;
    }

    const claimed = await prisma.document.updateMany({
      where: { id: documentId, status: 'UPLOADED' },
      data: { status: 'EXTRACTING' },
    });
    if (claimed.count === 0) return; // worker khác đã nhận trước

    try {
      const bytes = await this.s3.getObject(doc.storageKey);

      const actualChecksum = createHash('sha256').update(bytes).digest('hex');
      if (actualChecksum !== doc.checksumSha256) {
        throw new Error(
          `Checksum không khớp — file trên storage có thể đã bị thay đổi hoặc tải lên lỗi.`,
        );
      }

      const result = await extractText(bytes, doc.mimeType, { ocrMaxPages: env.OCR_MAX_PAGES });
      if (result.pageCount && result.pageCount > env.UPLOAD_MAX_PAGES) {
        throw new Error(
          `Tài liệu có ${result.pageCount} trang, vượt giới hạn ${env.UPLOAD_MAX_PAGES} trang.`,
        );
      }
      if (result.pageCount) {
        const pagesLimit = await getPagesPerDocumentLimit(doc.uploaderId);
        if (pagesLimit != null && result.pageCount > pagesLimit) {
          throw new PagesQuotaExceededError(result.pageCount, pagesLimit);
        }
      }

      // Cắt theo mục (heading) trên cả tài liệu, không từng trang rời nhau: heading ở trang 3
      // vẫn là ngữ cảnh của đoạn ở trang 4 (FR-AI-10).
      // Tài liệu không có trang cố định (TXT/MD, DOCX) thì chunk không mang số trang — hiện
      // "trang 1" cho một file Markdown là sai.
      const chunks = chunkPages(result.pages).map((c) =>
        result.pageCount === null ? { ...c, pageFrom: undefined, pageTo: undefined } : c,
      );

      await prisma.$transaction(async (tx) => {
        await tx.documentChunk.deleteMany({ where: { documentId } }); // idempotent trên retry
        if (chunks.length > 0) {
          await tx.documentChunk.createMany({
            data: chunks.map((c, i) => ({
              id: newId(),
              documentId,
              index: i,
              content: c.content,
              tokenCount: c.tokenCount,
              pageFrom: c.pageFrom ?? null,
              pageTo: c.pageTo ?? null,
              headingPath: c.headingPath ?? null,
            })),
          });
        }
        await tx.document.update({
          where: { id: documentId },
          data: {
            status: 'EXTRACTED',
            pageCount: result.pageCount,
            extractedAt: new Date(),
            errorCode: null,
            errorMessage: null,
          },
        });
      });

      this.logger.log(`Document ${documentId} trích xuất xong: ${chunks.length} chunk.`);
    } catch (err) {
      const code =
        err instanceof UnsupportedFileError
          ? 'UNSUPPORTED_FILE'
          : err instanceof ScannedPdfNotSupportedError
            ? 'SCANNED_PDF_UNSUPPORTED'
            : err instanceof PagesQuotaExceededError
              ? 'PAGE_QUOTA_EXCEEDED'
              : 'EXTRACTION_FAILED';
      const message = err instanceof Error ? err.message : 'Lỗi không xác định khi trích xuất.';
      await prisma.document.update({
        where: { id: documentId },
        data: { status: 'FAILED', errorCode: code, errorMessage: message },
      });
      this.logger.error(`Document ${documentId} trích xuất thất bại: ${message}`);
    }
  }
}
