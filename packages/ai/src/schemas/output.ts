import { z } from 'zod';

/** Hình dạng output bắt buộc của LLM — HANDBOOK §8.3. Mọi output phải khớp schema này. */

export const MultipleChoiceQuestionOutput = z.object({
  type: z.literal('MULTIPLE_CHOICE'),
  prompt: z.string().min(10),
  options: z.array(z.object({ content: z.string().min(1), isCorrect: z.boolean() })).length(4),
  explanation: z.string().min(10),
  sourceChunkId: z.string(),
});

export const TrueFalseQuestionOutput = z.object({
  type: z.literal('TRUE_FALSE'),
  prompt: z.string().min(10),
  statement: z.string().min(5),
  answer: z.boolean(),
  explanation: z.string().min(10),
  sourceChunkId: z.string(),
});

export const ShortAnswerQuestionOutput = z.object({
  type: z.literal('SHORT_ANSWER'),
  prompt: z.string().min(10),
  modelAnswer: z.string().min(3).max(300),
  explanation: z.string().min(10),
  sourceChunkId: z.string(),
});

export const FillBlankQuestionOutput = z.object({
  type: z.literal('FILL_BLANK'),
  prompt: z.string().min(10),
  blankHint: z.string().min(1).max(100),
  answer: z.string().min(1).max(200),
  explanation: z.string().min(10),
  sourceChunkId: z.string(),
});

export const QuestionOutput = z.discriminatedUnion('type', [
  MultipleChoiceQuestionOutput,
  TrueFalseQuestionOutput,
  ShortAnswerQuestionOutput,
  FillBlankQuestionOutput,
]);

export const ExerciseOutput = z.object({
  title: z.string().min(1).max(200),
  instruction: z.string().min(1).max(500),
  difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']),
  questions: z.array(QuestionOutput).min(1).max(10),
});

export const LessonOutput = z.object({
  title: z.string().min(5).max(200),
  summary: z.string().min(20).max(500),
  contentMd: z.string().min(200).max(12000),
  estimatedMinutes: z.number().int().min(1).max(60),
  sourceChunkIds: z.array(z.string()).min(1),
  exercises: z.array(ExerciseOutput).min(1).max(5),
});

export const OutlineNodeOutput = z.object({
  title: z.string().min(3).max(200),
  description: z.string().min(10).max(500),
  chunkIds: z.array(z.string()).min(1),
});

export const OutlineOutput = z.object({
  courseTitle: z.string().min(3).max(200),
  language: z.enum(['vi', 'en']),
  nodes: z.array(OutlineNodeOutput).min(1).max(20),
});

export type QuestionOutputT = z.infer<typeof QuestionOutput>;
export type ExerciseOutputT = z.infer<typeof ExerciseOutput>;
export type LessonOutputT = z.infer<typeof LessonOutput>;
export type OutlineNodeOutputT = z.infer<typeof OutlineNodeOutput>;
export type OutlineOutputT = z.infer<typeof OutlineOutput>;
