import { Injectable } from '@nestjs/common';
import { PrismaService, type Db } from '../../../../infra/services';

@Injectable()
export class RefreshTokenRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(
    hashed: {
      id: string;
      userId: string;
      tokenHash: string;
      familyId: string;
      expiresAt: Date;
      ipAddress?: string;
      userAgent?: string;
    },
    db: Db = this.prisma.client,
  ) {
    return db.refreshToken.create({ data: hashed });
  }

  findByHash(tokenHash: string, db: Db = this.prisma.client) {
    return db.refreshToken.findUnique({ where: { tokenHash } });
  }

  /** Thu hồi toàn bộ family sau khi tái sử dụng token đã thu hồi (HANDBOOK §10.1). */
  revokeFamily(familyId: string, db: Db = this.prisma.client) {
    return db.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  revokeById(id: string, db: Db = this.prisma.client) {
    return db.refreshToken.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
  }

  revokeByTokenHash(tokenHash: string, db: Db = this.prisma.client) {
    return db.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  revokeAllForUser(userId: string, db: Db = this.prisma.client) {
    return db.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
