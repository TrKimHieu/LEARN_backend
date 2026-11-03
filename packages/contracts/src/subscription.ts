import { z } from 'zod';

export const planPublicSchema = z.object({
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  priceCents: z.number().int(),
  currency: z.string(),
  interval: z.string(),
  features: z.array(z.string()),
  isFutureExtension: z.boolean().default(false),
});

export const checkoutSchema = z
  .object({
    planCode: z.string().min(1).max(20),
  })
  .strict();

export const checkoutUrlResponseSchema = z.object({
  url: z.string(),
  mode: z.enum(['demo', 'live']),
});

export const subscriptionResponseSchema = z.object({
  planCode: z.string(),
  status: z.enum(['TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED']),
  currentPeriodEnd: z.string().nullable(),
  cancelAtPeriodEnd: z.boolean(),
  billingMode: z.enum(['demo', 'live']),
  usage: z.record(
    z.string(),
    z.object({
      used: z.number().int(),
      limit: z.number().int().nullable(),
      window: z.string(),
    }),
  ),
});

export const planListSchema = z.array(planPublicSchema);

export type PlanPublic = z.infer<typeof planPublicSchema>;
export type CheckoutInput = z.infer<typeof checkoutSchema>;
export type CheckoutUrlResponse = z.infer<typeof checkoutUrlResponseSchema>;
export type SubscriptionResponse = z.infer<typeof subscriptionResponseSchema>;
