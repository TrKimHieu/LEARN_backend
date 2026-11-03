import { Injectable } from '@nestjs/common';
import { PrismaService, type Db } from '../../../../infra/services';

@Injectable()
export class GenerationRunRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Các lần gọi model trong một AI job — chi tiết kèm chi phí/token/latency. */
  listForJob(aiJobId: string, db: Db = this.prisma.client) {
    return db.generationRun.findMany({
      where: { aiJobId },
      orderBy: { createdAt: 'asc' },
      take: 20,
    });
  }
}
