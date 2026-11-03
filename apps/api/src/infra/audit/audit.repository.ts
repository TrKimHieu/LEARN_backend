import { Injectable } from '@nestjs/common';
import { newId } from '@learn/db';
import { PrismaService, type Db } from '../services';

/** Audit log dùng chung (admin thao tác nhạy cảm, đổi mật khẩu…). Không lọc ownerId — ghi log. */
@Injectable()
export class AuditRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(
    input: {
      actorId?: string;
      action: string;
      entityType: string;
      entityId: string;
      metadata?: unknown;
      ipAddress?: string;
    },
    db: Db = this.prisma.client,
  ) {
    return db.auditLog.create({
      data: {
        id: newId(),
        actorId: input.actorId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        metadata: input.metadata as never,
        ipAddress: input.ipAddress ?? null,
      },
    });
  }
}
