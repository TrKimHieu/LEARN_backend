import { Injectable } from '@nestjs/common';
import { PrismaService, type Db } from '../../../../infra/services';
import { newId } from '@learn/db';

@Injectable()
export class UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string, db: Db = this.prisma.client) {
    return db.user.findFirst({ where: { email, deletedAt: null } });
  }

  findById(id: string, db: Db = this.prisma.client) {
    return db.user.findFirst({ where: { id, deletedAt: null } });
  }

  async create(
    input: {
      email: string;
      passwordHash: string;
      displayName: string;
      locale: string;
    },
    db: Db = this.prisma.client,
  ) {
    return db.user.create({ data: { id: newId(), ...input } });
  }

  async update(
    id: string,
    data: { displayName?: string; locale?: 'vi' | 'en' },
    db: Db = this.prisma.client,
  ) {
    return db.user.update({ where: { id }, data });
  }

  async updatePasswordHash(id: string, passwordHash: string, db: Db = this.prisma.client) {
    return db.user.update({ where: { id }, data: { passwordHash } });
  }
}
