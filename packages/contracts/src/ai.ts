import { z } from 'zod';

export const aiJobStatusSchema = z.enum(['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED']);

export const aiJobTypeSchema = z.enum([
  'EXTRACT_DOCUMENT',
  'GENERATE_LESSONS',
  'REGENERATE_LESSON',
]);

export const aiJobSummarySchema = z.object({
  id: z.string(),
  courseId: z.string(),
  documentId: z.string().nullable(),
  type: aiJobTypeSchema,
  status: aiJobStatusSchema,
  progress: z.number().int().min(0).max(100),
  progressLabel: z.string().nullable(),
  error: z.object({ code: z.string(), message: z.string(), detail: z.unknown() }).nullable(),
  queuedAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
});

export const aiJobDetailSchema = aiJobSummarySchema.extend({
  attempt: z.number().int(),
  inputParams: z.record(z.string(), z.unknown()),
  runs: z.array(
    z.object({
      id: z.string(),
      step: z.string(),
      model: z.string(),
      inputTokens: z.number().int(),
      outputTokens: z.number().int(),
      latencyMs: z.number().int(),
      createdAt: z.string(),
    }),
  ),
});

export const generateLessonsSchema = z
  .object({
    documentIds: z.array(z.string().uuid()).min(1).optional(),
    language: z.enum(['vi', 'en']).optional(),
    difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']).optional(),
  })
  .strict()
  .default({});

export const aiJobStreamEventSchema = z.object({
  jobId: z.string(),
  status: aiJobStatusSchema,
  progress: z.number().int().min(0).max(100).optional(),
  label: z.string().optional(),
  code: z.string().optional(),
  message: z.string().optional(),
  lessonIds: z.array(z.string()).optional(),
  lessonCount: z.number().int().optional(),
});

export const aiCostMetricsSchema = z.array(
  z.object({
    date: z.string(),
    totalCostUsd: z.number(),
    jobCount: z.number().int(),
    totalInputTokens: z.number().int(),
    totalOutputTokens: z.number().int(),
  }),
);

export const lowConfidenceFlagSchema = z.object({
  lessonId: z.string(),
  reason: z.string(),
  confidenceScore: z.number(),
});

export type AiJobStatus = z.infer<typeof aiJobStatusSchema>;
export type AiJobType = z.infer<typeof aiJobTypeSchema>;
export type AiJobSummary = z.infer<typeof aiJobSummarySchema>;
export type AiJobDetail = z.infer<typeof aiJobDetailSchema>;
export type GenerateLessonsInput = z.infer<typeof generateLessonsSchema>;
export type AiCostMetrics = z.infer<typeof aiCostMetricsSchema>;
