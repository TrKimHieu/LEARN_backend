import { z } from 'zod';

export const lessonStatusSchema = z.enum(['DRAFT', 'PUBLISHED']);

/**
 * Độ bám nguồn của bản AI sinh ra (tầng 3 validation). `LOW` = dưới 50% thuật ngữ mẫu khớp tài
 * liệu gốc; NFR-AI-02 bắt UI phải cảnh báo, không được im lặng. Sửa tay không đổi giá trị này.
 */
export const lessonConfidenceSchema = z.enum(['UNKNOWN', 'HIGH', 'LOW']);

export const lessonReadSchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string().nullable(),
  contentMd: z.string(),
  estimatedMinutes: z.number().int().nullable(),
  orderIndex: z.number().int(),
  status: lessonStatusSchema,
  sourceChunkIds: z.array(z.string()).default([]),
  confidence: lessonConfidenceSchema,
  editedByUserAt: z.string().nullable(),
  progress: z.object({
    status: z.enum(['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED']),
    bestScore: z.number().int().nullable(),
  }),
});

export const lessonSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  orderIndex: z.number().int(),
  status: lessonStatusSchema,
  exerciseCount: z.number().int().default(0),
  confidence: lessonConfidenceSchema,
  progressStatus: z.enum(['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED']),
  bestScore: z.number().int().nullable(),
});

/**
 * Một đoạn tài liệu gốc mà bài học dựa vào (`Lesson.sourceChunkIds`) — để người học tự kiểm bài
 * AI sinh, nhất là bài `LOW`. `excerpt` là nội dung chunk, cắt bớt nếu quá dài.
 */
export const lessonSourceSchema = z.object({
  chunkId: z.string(),
  documentId: z.string(),
  filename: z.string(),
  pageFrom: z.number().int().nullable(),
  pageTo: z.number().int().nullable(),
  headingPath: z.string().nullable(),
  excerpt: z.string(),
  truncated: z.boolean(),
});

export const patchLessonSchema = z
  .object({
    title: z.string().min(5).max(200).optional(),
    summary: z.string().max(500).nullable().optional(),
    contentMd: z.string().min(10).max(12000).optional(),
    status: lessonStatusSchema.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Ít nhất một trường cần sửa' });

export type LessonConfidence = z.infer<typeof lessonConfidenceSchema>;
export type LessonRead = z.infer<typeof lessonReadSchema>;
export type LessonSummary = z.infer<typeof lessonSummarySchema>;
export type LessonSource = z.infer<typeof lessonSourceSchema>;
export type PatchLessonInput = z.infer<typeof patchLessonSchema>;
