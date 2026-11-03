import { prisma } from '@learn/db';
import type { Prisma } from '@learn/db';

interface GenerationRows {
  lessons: Prisma.LessonCreateManyInput[];
  exercises: Prisma.ExerciseCreateManyInput[];
  questions: Prisma.QuestionCreateManyInput[];
  options: Prisma.AnswerOptionCreateManyInput[];
}

/** Job state and lesson batch commit together; cancellation and replay compete for one row lock. */
export async function commitGeneration(
  jobId: string,
  rows: GenerationRows,
  error?: Prisma.InputJsonValue,
): Promise<boolean> {
  return prisma.$transaction(
    async (tx) => {
      const claimed = await tx.aIJob.updateMany({
        where: { id: jobId, status: 'RUNNING' },
        data: {
          status: 'SUCCEEDED',
          progress: 100,
          progressLabel: 'Hoàn tất',
          finishedAt: new Date(),
          ...(error ? { error } : {}),
        },
      });
      if (claimed.count === 0) return false;
      await tx.lesson.createMany({ data: rows.lessons });
      if (rows.exercises.length) await tx.exercise.createMany({ data: rows.exercises });
      if (rows.questions.length) await tx.question.createMany({ data: rows.questions });
      if (rows.options.length) await tx.answerOption.createMany({ data: rows.options });
      return true;
    },
    { timeout: 30000, maxWait: 10000 },
  );
}
