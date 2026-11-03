import { Injectable } from '@nestjs/common';
import { newId } from '@learn/db';
import type { Prisma, SubscriptionStatus } from '@learn/db';
import { PrismaService, type Db } from '../../../../infra/services';

const ACTIVE_STATUSES: SubscriptionStatus[] = ['ACTIVE', 'TRIALING'];

type SubscriptionWithPlan = Prisma.SubscriptionGetPayload<{ include: { plan: true } }>;

@Injectable()
export class SubscriptionRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Subscription hiện tại của một người (kèm plan), lọc `status` — không phụ thuộc người gọi. */
  findFirstWithPlan(
    userId: string,
    statuses: readonly SubscriptionStatus[] = ACTIVE_STATUSES,
    db: Db = this.prisma.client,
  ): Promise<SubscriptionWithPlan | null> {
    return db.subscription.findFirst({
      where: { userId, status: { in: [...statuses] } },
      orderBy: { updatedAt: 'desc' },
      include: { plan: true },
    }) as Promise<SubscriptionWithPlan | null>;
  }

  /** Tạo subscription mới — gọi trong PATH hoặc ngoài đều được (nhận `db`). */
  create(
    data: {
      userId: string;
      planId: string;
      status: 'ACTIVE' | 'TRIALING';
      currentPeriodStart: Date;
      currentPeriodEnd: Date;
    },
    db: Db = this.prisma.client,
  ) {
    return db.subscription.create({ data: { id: newId(), ...data } });
  }

  /** Huỷ mọi subscription đang có hiệu lực — dùng trước khi tạo gói mới (demo billing). */
  cancelActive(userId: string, db: Db = this.prisma.client) {
    return db.subscription.updateMany({
      where: { userId, status: { in: [...ACTIVE_STATUSES] } },
      data: { status: 'CANCELED' },
    });
  }

  /** Đánh dấu huỷ cuối kỳ cho subscription ACTIVE chưa hẹn huỷ. */
  setCancelAtPeriodEnd(userId: string, db: Db = this.prisma.client) {
    return db.subscription.updateMany({
      where: { userId, status: 'ACTIVE', cancelAtPeriodEnd: false },
      data: { cancelAtPeriodEnd: true },
    });
  }
}
