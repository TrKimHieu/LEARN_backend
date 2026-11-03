import { Injectable } from '@nestjs/common';
import { newId } from '@learn/db';
import { PrismaService, type Db } from '../../../../infra/services';

@Injectable()
export class PasswordResetRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(
    data: { userId: string; tokenHash: string; expiresAt: Date },
    db: Db = this.prisma.client,
  ) {
    return db.passwordResetToken.create({ data: { id: newId(), ...data } });
  }

  findByHash(tokenHash: string, db: Db = this.prisma.client) {
    return db.passwordResetToken.findUnique({ where: { tokenHash } });
  }

  /**
   * Đánh dấu đã dùng — CÓ ĐIỀU KIỆN `usedAt: null`. Hai request đặt lại cùng lúc với cùng một
   * token chỉ một cái thắng (`count === 1`); cái kia thấy 0 và phải từ chối.
   */
  async markUsed(id: string, db: Db = this.prisma.client): Promise<boolean> {
    const res = await db.passwordResetToken.updateMany({
      where: { id, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    return res.count === 1;
  }

  /** Huỷ mọi token chưa dùng của người dùng — sau khi đặt lại xong, hoặc trước khi phát token mới. */
  invalidateAllForUser(userId: string, db: Db = this.prisma.client) {
    return db.passwordResetToken.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: new Date() },
    });
  }
}
