import { Controller, Get, Post, Body, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { checkoutSchema } from '@learn/contracts';
import type { CheckoutInput } from '@learn/contracts';
import { zodBody } from '../../../core/exceptions/errors';
import { Auth, CurrentUser, type UserContext } from '../../../core/security';
import { UsageService } from '../application/usage.service';
import { BillingService } from '../application/billing.service';
import { PlanRepository } from '../infrastructure/repositories/plan.repository';
import { SubscriptionRepository } from '../infrastructure/repositories/subscription.repository';
import { env } from '../../../environment';

@Controller('api/v1')
export class SubscriptionController {
  constructor(
    private readonly usage: UsageService,
    private readonly billing: BillingService,
    private readonly plans: PlanRepository,
    private readonly subscriptions: SubscriptionRepository,
  ) {}

  @Get('plans')
  async listPlans() {
    const rows = await this.plans.findManyActive();
    return rows.map((p) => ({
      code: p.code,
      name: p.name,
      description: p.description,
      priceCents: p.priceCents,
      currency: p.currency,
      interval: p.interval,
      features: p.features,
      isFutureExtension: p.isFutureExtension,
    }));
  }

  @Get('subscription')
  @Auth()
  async subscription(@CurrentUser() user: UserContext) {
    const sub = await this.subscriptions.findFirstWithPlan(user.userId, [
      'ACTIVE',
      'TRIALING',
      'PAST_DUE',
    ]);
    return {
      planCode: sub?.plan.code ?? 'FREE',
      status: sub?.status ?? 'ACTIVE',
      currentPeriodEnd: sub?.currentPeriodEnd?.toISOString() ?? null,
      cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false,
      billingMode: env.BILLING_MODE,
      usage: await this.usage.snapshot(user.userId),
    };
  }

  @Get('usage')
  @Auth()
  async getUsage(@CurrentUser() user: UserContext) {
    return this.usage.snapshot(user.userId);
  }

  @Post('subscription/checkout')
  @Auth()
  async checkout(
    @CurrentUser() user: UserContext,
    @Body(zodBody(checkoutSchema)) body: CheckoutInput,
  ) {
    // Body chỉ nhận planCode; giá lấy từ DB — không tin client `[SPEC]`
    return this.billing.checkout(user.userId, body.planCode);
  }

  @Post('subscription/cancel')
  @Auth()
  async cancel(@CurrentUser() user: UserContext) {
    await this.subscriptions.setCancelAtPeriodEnd(user.userId);
    return { ok: true, message: 'Gói sẽ huỷ ở cuối kỳ hiện tại.' };
  }

  @Post('webhooks/stripe')
  async stripeWebhook(@Req() req: Request, @Res() res: Response) {
    // @Res() chuyển Nest sang chế độ tự quản response — PHẢI gọi res.json() ở mọi nhánh,
    // `return` đơn thuần bị bỏ qua và request treo tới khi client timeout.
    const body =
      (req as { rawBody?: Buffer }).rawBody?.toString('utf8') ?? JSON.stringify(req.body);
    try {
      await this.billing.webhookHandler(
        'system',
        (req.headers['stripe-signature'] as string) ?? '',
        body,
      );
      res.status(200).json({ received: true });
    } catch {
      res.status(400).json({ received: false });
    }
  }
}
