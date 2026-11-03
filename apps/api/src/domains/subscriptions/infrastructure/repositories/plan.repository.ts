import { Injectable } from '@nestjs/common';
import { PrismaService, type Db } from '../../../../infra/services';

/**
 * Truy vấn Plan — quyền truy cập luôn ở tầng repository, không rò rỉ `prisma` lên service.
 * Các method nhận `db` ở tham số cuối để dùng được cả trong transaction.
 */
@Injectable()
export class PlanRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByCode(code: string, db: Db = this.prisma.client) {
    return db.plan.findFirst({ where: { code, isActive: true } });
  }

  findManyActive(db: Db = this.prisma.client) {
    return db.plan.findMany({ where: { isActive: true }, orderBy: { displayOrder: 'asc' } });
  }

  findFree(db: Db = this.prisma.client) {
    return db.plan.findUnique({ where: { code: 'FREE' } });
  }
}
