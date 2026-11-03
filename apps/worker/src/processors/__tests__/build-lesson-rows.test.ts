import { describe, it, expect } from 'vitest';
import type { LessonOutputT } from '@learn/ai';
import { buildLessonRows } from '../lesson-generate.processor';

const question = (n: number) => ({
  type: 'MULTIPLE_CHOICE' as const,
  prompt: `câu ${n}`,
  explanation: `vì vậy ${n}`,
  sourceChunkId: `chunk-${n}`,
  options: [
    { content: 'A', isCorrect: n % 2 === 0 },
    { content: 'B', isCorrect: n % 2 !== 0 },
  ],
});

const lesson = (title: string, questionCount = 2): LessonOutputT =>
  ({
    title,
    summary: `tóm tắt ${title}`,
    contentMd: `# ${title}`,
    estimatedMinutes: 10,
    sourceChunkIds: ['chunk-1'],
    exercises: [
      {
        title: `bài tập ${title}`,
        instruction: 'làm đi',
        difficulty: 'MEDIUM',
        questions: Array.from({ length: questionCount }, (_, i) => question(i + 1)),
      },
    ],
  }) as unknown as LessonOutputT;

const ctx = { courseId: 'course-1', aiJobId: 'job-1', startIndex: 0 };

describe('buildLessonRows', () => {
  it('sinh đủ 4 nhóm dòng cho createMany', () => {
    const rows = buildLessonRows(
      [
        { lesson: lesson('A'), confidence: 'HIGH' },
        { lesson: lesson('B'), confidence: 'LOW' },
      ],
      ctx,
    );
    expect(rows.lessons).toHaveLength(2);
    expect(rows.exercises).toHaveLength(2); // 1 bài tập mỗi bài học
    expect(rows.questions).toHaveLength(4); // 2 câu mỗi bài tập
    expect(rows.options).toHaveLength(8); // 2 phương án mỗi câu
  });

  it('orderIndex nối tiếp từ startIndex, theo đúng thứ tự outline', () => {
    const rows = buildLessonRows(
      [
        { lesson: lesson('A'), confidence: 'HIGH' },
        { lesson: lesson('B'), confidence: 'HIGH' },
        { lesson: lesson('C'), confidence: 'HIGH' },
      ],
      { ...ctx, startIndex: 5 },
    );
    expect(rows.lessons.map((l) => [l.title, l.orderIndex])).toEqual([
      ['A', 5],
      ['B', 6],
      ['C', 7],
    ]);
  });

  it('khoá ngoại nối đúng: exercise → lesson, question → exercise, option → question', () => {
    const rows = buildLessonRows([{ lesson: lesson('A'), confidence: 'HIGH' }], ctx);
    const lessonId = rows.lessons[0]?.id;
    const exerciseId = rows.exercises[0]?.id;
    const questionIds = new Set(rows.questions.map((q) => q.id));

    expect(rows.exercises.every((e) => e.lessonId === lessonId)).toBe(true);
    expect(rows.questions.every((q) => q.exerciseId === exerciseId)).toBe(true);
    expect(rows.options.every((o) => questionIds.has(o.questionId as string))).toBe(true);
  });

  it('id là duy nhất trên toàn bộ các dòng sinh ra', () => {
    const rows = buildLessonRows(
      [
        { lesson: lesson('A'), confidence: 'HIGH' },
        { lesson: lesson('B'), confidence: 'HIGH' },
      ],
      ctx,
    );
    const ids = [...rows.lessons, ...rows.exercises, ...rows.questions, ...rows.options].map(
      (r) => r.id,
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('nhãn phương án là A, B, C… theo thứ tự', () => {
    const rows = buildLessonRows([{ lesson: lesson('A', 1), confidence: 'HIGH' }], ctx);
    expect(rows.options.map((o) => o.label)).toEqual(['A', 'B']);
    expect(rows.options.map((o) => o.orderIndex)).toEqual([0, 1]);
  });

  it('MULTIPLE_CHOICE lưu correctIndex khớp phương án isCorrect', () => {
    const rows = buildLessonRows([{ lesson: lesson('A', 1), confidence: 'HIGH' }], ctx);
    // question(1): B đúng → index 1
    expect(rows.questions[0]?.correctAnswer).toEqual({ correctIndex: 1 });
  });

  it('danh sách rỗng trả về 4 mảng rỗng, không ném lỗi', () => {
    const rows = buildLessonRows([], ctx);
    expect(rows).toEqual({ lessons: [], exercises: [], questions: [], options: [] });
  });
});
