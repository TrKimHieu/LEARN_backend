import { describe, expect, it } from 'vitest';
import { PrismaClient, prisma, newId } from '@learn/db';
import { requireSandbox } from './safety';
import { PrismaService } from '../infra/services';
import { UsageService } from '../domains/subscriptions/application/usage.service';
import { PlanRepository } from '../domains/subscriptions/infrastructure/repositories/plan.repository';
import { SubscriptionRepository } from '../domains/subscriptions/infrastructure/repositories/subscription.repository';
import { UsageCounterRepository } from '../domains/subscriptions/infrastructure/repositories/usage-counter.repository';

requireSandbox();
describe('quota with a constrained real database pool', () => {
  it('reads the plan and consumes quota using the held transaction connection', async () => {
    const limited = new PrismaClient({
      datasources: { db: { url: process.env.DATABASE_URL + '&connection_limit=1&pool_timeout=1' } },
    });
    class LimitedPrisma extends PrismaService {
      override readonly client = limited;
    }
    const database = new LimitedPrisma();
    const usage = new UsageService(
      database,
      new PlanRepository(database),
      new SubscriptionRepository(database),
      new UsageCounterRepository(database),
    );
    const user = await prisma.user.create({
      data: {
        email: `pool-${newId()}@example.invalid`,
        displayName: 'Pool fixture',
        passwordHash: 'test-only',
      },
    });
    try {
      const course = await usage.consume(user.id, 'COURSES_CREATED', (tx) =>
        tx.course.create({ data: { ownerId: user.id, title: 'One connection' } }),
      );
      expect(course.ownerId).toBe(user.id);
      expect(await prisma.course.count({ where: { ownerId: user.id } })).toBe(1);
    } finally {
      await limited.$disconnect();
      await prisma.course.deleteMany({ where: { ownerId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  });
});
