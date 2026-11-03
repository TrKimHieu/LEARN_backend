import { Injectable } from '@nestjs/common';
import { newId } from '@learn/db';
import { ApiError } from '../../../core/exceptions/errors';
import { PrismaService } from '../../../infra/services';
import { env } from '../../../environment';
import { PlanRepository } from '../infrastructure/repositories/plan.repository';
import { SubscriptionRepository } from '../infrastructure/repositories/subscription.repository';
import { PaymentRepository } from '../infrastructure/repositories/payment.repository';

/**
 * Billing — HANDBOOK §11.4. Giá luôn lấy từ `Plan.priceCents` trong DB `[SPEC]`.
 * Chế độ demo kích hoạt ngay và ghi Payment giả; UI phải hiển thị băng rôn cảnh báo.
 * Chế độ live dùng Stripe Checkout; webhook là nguồn sự thật (never tin trang redirect).
 */
@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly plans: PlanRepository,
    private readonly subscriptions: SubscriptionRepository,
    private readonly payments: PaymentRepository,
  ) {}

  async checkout(
    userId: string,
    planCode: string,
  ): Promise<{ url: string; mode: 'demo' | 'live' }> {
    if (env.BILLING_MODE === 'live') {
      return this.checkoutLive(userId, planCode);
    }
    await this.activatePlanDemo(userId, planCode);
    return { url: `${env.APP_URL}/app/settings?upgraded=1`, mode: 'demo' };
  }

  async webhookHandler(
    _userId: string,
    _signature: string,
    _body: string,
  ): Promise<{ ok: boolean }> {
    // Live: xác minh chữ ký Stripe, ghi PaymentEvent trước, chống trùng theo eventId.
    // Với REPO KHÔNG CÓ STRIPE KEY: trả 501 để không "giả vờ" đã tích hợp live.
    throw ApiError.conflict(
      'Webhook Stripe chỉ hoạt động khi BILLING_MODE=live và có STRIPE_WEBHOOK_SECRET.',
    );
  }

  private async activatePlanDemo(userId: string, planCode: string) {
    const plan = await this.plans.findByCode(planCode);
    if (!plan) throw ApiError.notFound('Không tồn tại gói này.');
    if (plan.isFutureExtension) throw ApiError.forbidden('Gói này chưa được bán.');

    const now = new Date();
    await this.prisma.client.$transaction(async (tx) => {
      await this.subscriptions.cancelActive(userId, tx);
      const subscription = await this.subscriptions.create(
        {
          userId,
          planId: plan.id,
          status: 'ACTIVE',
          currentPeriodStart: now,
          currentPeriodEnd: new Date(now.getTime() + 30 * 86400 * 1000),
        },
        tx,
      );
      await this.payments.create(
        {
          subscriptionId: subscription.id,
          amountCents: plan.priceCents,
          currency: plan.currency,
          status: 'succeeded',
          providerPaymentId: `demo_${newId()}`,
          paidAt: now,
        },
        tx,
      );
    });
  }

  private async checkoutLive(
    userId: string,
    planCode: string,
  ): Promise<{ url: string; mode: 'live' }> {
    const plan = await this.plans.findByCode(planCode);
    if (!plan) throw ApiError.notFound('Không tồn tại gói này.');
    if (!env.STRIPE_SECRET_KEY || !plan.providerPriceId) {
      throw ApiError.conflict('Thanh toán live chưa được cấu hình đầy đủ.');
    }
    // Ở bản repo (redux hạn chế), Stripe SDK không được bundle — chỉ trả URL chờ tích hợp:
    throw ApiError.conflict(
      'Stripe live chỉ thêm khi có STRIPE_SECRET_KEY; chạy với BILLING_MODE=demo để dùng thử.',
    );
  }
}
