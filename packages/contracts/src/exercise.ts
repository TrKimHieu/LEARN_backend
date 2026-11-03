import { z } from 'zod';

export const questionTypeSchema = z.enum([
  'MULTIPLE_CHOICE',
  'TRUE_FALSE',
  'SHORT_ANSWER',
  'FILL_BLANK',
]);

export const answerOptionReadSchema = z.object({
  id: z.string(),
  orderIndex: z.number().int(),
  label: z.string(),
  content: z.string(),
});

export const questionReadSchema = z.object({
  id: z.string(),
  orderIndex: z.number().int(),
  type: questionTypeSchema,
  prompt: z.string(),
  points: z.number().int(),
  options: z.array(answerOptionReadSchema).default([]),
});

/**
 * Một bài tập trong danh sách bài tập của bài học — để điều hướng giữa các bài tập (AI sinh 1–5
 * bài tập mỗi bài học). Chỉ có tổng quan, không có câu hỏi hay đáp án.
 */
export const exerciseNavItemSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  orderIndex: z.number().int(),
  difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']),
  questionCount: z.number().int(),
  passScore: z.number().int(),
  bestScore: z.number().int().nullable(),
  passed: z.boolean(),
});

export const exerciseReadSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  instruction: z.string().nullable(),
  difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']),
  passScore: z.number().int(),
  orderIndex: z.number().int(),
  questions: z.array(questionReadSchema),
  bestSubmission: z
    .object({
      attemptNo: z.number().int(),
      score: z.number().int(),
      maxScore: z.number().int(),
      createdAt: z.string(),
    })
    .nullable(),
  /** Mọi bài tập của bài học, theo `orderIndex` — gồm cả bài đang mở. */
  exercises: z.array(exerciseNavItemSchema),
});

const questionAnswerSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('MULTIPLE_CHOICE'),
    questionId: z.string().uuid(),
    optionId: z.string().uuid(),
  }),
  z.object({ type: z.literal('TRUE_FALSE'), questionId: z.string().uuid(), value: z.boolean() }),
  z.object({
    type: z.literal('SHORT_ANSWER'),
    questionId: z.string().uuid(),
    text: z.string().min(1).max(2000),
  }),
  z.object({
    type: z.literal('FILL_BLANK'),
    questionId: z.string().uuid(),
    text: z.string().min(1).max(500),
  }),
]);

export const submitExerciseSchema = z
  .object({
    answers: z.array(questionAnswerSchema).min(1),
    /** Bài tập được nộp; bỏ trống = bài tập đầu tiên của bài học (tương thích client cũ). */
    exerciseId: z.string().uuid().optional(),
    durationMs: z.number().int().positive().max(3_600_000).optional(),
  })
  .strict()
  .refine((v) => new Set(v.answers.map((a) => a.questionId)).size === v.answers.length, {
    message: 'Không được trả lời trùng câu hỏi',
  });

export const submissionSchema = z.object({
  id: z.string(),
  exerciseId: z.string(),
  /** Sau lượt nộp này, mọi bài tập của bài học đã đạt (bài học chuyển COMPLETED). */
  lessonCompleted: z.boolean(),
  attemptNo: z.number().int(),
  score: z.number().int(),
  maxScore: z.number().int(),
  passed: z.boolean(),
  createdAt: z.string(),
  results: z.array(
    z.object({
      questionId: z.string(),
      isCorrect: z.boolean(),
      correctAnswer: z.unknown().nullable(),
      explanation: z.string().nullable(),
      pointsEarned: z.number().int(),
    }),
  ),
});

export type ExerciseNavItem = z.infer<typeof exerciseNavItemSchema>;
export type ExerciseRead = z.infer<typeof exerciseReadSchema>;
export type SubmitExerciseInput = z.infer<typeof submitExerciseSchema>;
export type SubmissionResult = z.infer<typeof submissionSchema>;
