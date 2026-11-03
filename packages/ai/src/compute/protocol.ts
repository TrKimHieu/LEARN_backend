import { z } from 'zod';

export const computeRequest = z
  .object({
    version: z.literal(1),
    params: z
      .object({
        prompt: z.string().min(1).max(128000),
        system: z.string().max(16000).optional(),
        model: z.string().max(128).optional(),
        maxTokens: z.number().int().min(1).max(32768).optional(),
        temperature: z.number().min(0).max(2).optional(),
      })
      .strict(),
  })
  .strict();
export const computeResult = z
  .object({
    version: z.literal(1),
    result: z
      .object({
        text: z.string().max(512000),
        model: z.string().max(128),
        inputTokens: z.number().int().nonnegative(),
        outputTokens: z.number().int().nonnegative(),
        latencyMs: z.number().nonnegative(),
        attempt: z.number().int().positive().optional(),
      })
      .strict(),
  })
  .strict();
