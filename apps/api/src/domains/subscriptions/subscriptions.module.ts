import { Module } from '@nestjs/common';
import { SubscriptionController } from './presentation/subscription.controller';
import { UsageService } from './application/usage.service';
import { BillingService } from './application/billing.service';
import { PlanRepository } from './infrastructure/repositories/plan.repository';
import { SubscriptionRepository } from './infrastructure/repositories/subscription.repository';
import { PaymentRepository } from './infrastructure/repositories/payment.repository';
import { UsageCounterRepository } from './infrastructure/repositories/usage-counter.repository';

@Module({
  controllers: [SubscriptionController],
  providers: [
    UsageService,
    BillingService,
    PlanRepository,
    SubscriptionRepository,
    PaymentRepository,
    UsageCounterRepository,
  ],
  exports: [UsageService, PlanRepository, SubscriptionRepository],
})
export class SubscriptionsModule {}
