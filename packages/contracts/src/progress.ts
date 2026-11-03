import { z } from 'zod';

export const progressStatusSchema = z.enum(['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED']);

export const progressOverviewSchema = z.object({
  courseCount: z.number().int(),
  completedLessons: z.number().int(),
  totalLessons: z.number().int(),
  averageScore: z.number().nullable(),
  activeStreak: z.number().int().default(0),
});

export const progressCourseSchema = z.object({
  courseId: z.string(),
  courseTitle: z.string(),
  completed: z.number().int(),
  total: z.number().int(),
  percent: z.number().min(0).max(100),
});

export const historyItemSchema = z.object({
  id: z.string(),
  /** Đủ để bấm vào một dòng lịch sử là tới đúng bài tập đã làm (FR-PROGRESS-05). */
  courseId: z.string(),
  lessonId: z.string(),
  exerciseId: z.string(),
  passed: z.boolean(),
  lessonTitle: z.string(),
  courseTitle: z.string(),
  exerciseTitle: z.string().nullable(),
  score: z.number().int(),
  maxScore: z.number().int(),
  createdAt: z.string(),
});

/** Trang lịch sử — cursor là id lượt nộp cuối trang trước (FR-PROGRESS-06, NFR-PERF-02). */
export const historyPageSchema = z.object({
  items: z.array(historyItemSchema),
  nextCursor: z.string().nullable(),
});

export const courseProgressSchema = z.object({
  lessons: z.array(
    z.object({
      lessonId: z.string(),
      lessonTitle: z.string(),
      orderIndex: z.number().int(),
      status: progressStatusSchema,
      bestScore: z.number().int().nullable(),
    }),
  ),
});

export type ProgressOverview = z.infer<typeof progressOverviewSchema>;
export type ProgressCourse = z.infer<typeof progressCourseSchema>;
export type HistoryItem = z.infer<typeof historyItemSchema>;
export type HistoryPage = z.infer<typeof historyPageSchema>;
export type CourseProgress = z.infer<typeof courseProgressSchema>;
