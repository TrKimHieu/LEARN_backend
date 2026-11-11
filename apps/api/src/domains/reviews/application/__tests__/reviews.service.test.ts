import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SubmitReviewInput } from '@learn/contracts';
import { ReviewsService, answerTextOf } from '../reviews.service';

const KEY = '7f9c2b1e-4d3a-4c55-9e1f-2a6b8c0d1e23';
const NOW = new Date('2026-11-09T12:00:00.000Z');
const DAY = 86_400_000;
const at = (ms: number) => new Date(NOW.getTime() + ms);

interface Sched {
  id: string;
  userId: string;
  questionId: string;
  easeFactor: number;
  intervalDays: number;
  repetitions: number;
  lapses: number;
  dueAt: Date;
  lastReviewedAt: Date | null;
  createdAt: Date;
}
interface ReviewRow {
  userId: string;
  questionId: string;
  grade: string;
  reviewedAt: Date;
  idempotencyKey: string | null;
  requestHash: string | null;
  response: unknown;
}

/**
 * Repo giả trong bộ nhớ. `submitted` = câu hỏi của bài tập đã nộp: chỉ chúng được sinh lịch.
 * Giá trị: kết quả ở lượt nộp gần nhất (`true`/`false`) hoặc `null` khi lượt đó không có dòng trả lời.
 */
function setup(submitted: Record<string, boolean | null> = { q1: false, q2: true, q3: null }) {
  const schedules: Sched[] = [];
  const reviews: ReviewRow[] = [];
  const repo = {
    findSeeds: vi.fn(async (userId: string) =>
      Object.entries(submitted)
        .filter(([q]) => !schedules.some((s) => s.userId === userId && s.questionId === q))
        .map(([questionId, isCorrect]) => ({ questionId, isCorrect: isCorrect === true })),
    ),
    createSchedules: vi.fn(
      async (rows: Array<{ userId: string; questionId: string; dueAt: Date }>) => {
        for (const r of rows) {
          if (schedules.some((s) => s.userId === r.userId && s.questionId === r.questionId))
            continue;
          schedules.push({
            id: `s${schedules.length + 1}`,
            ...r,
            easeFactor: 2.5,
            intervalDays: 0,
            repetitions: 0,
            lapses: 0,
            lastReviewedAt: null,
            createdAt: new Date(NOW.getTime() - 10 * DAY),
          });
        }
      },
    ),
    listDue: vi.fn(async (userId: string, now: Date, limit: number) =>
      schedules
        .filter((s) => s.userId === userId && s.dueAt <= now)
        .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())
        .slice(0, limit)
        .map((s) => ({
          ...s,
          question: {
            id: s.questionId,
            type: 'TRUE_FALSE',
            prompt: `prompt ${s.questionId}`,
            explanation: null,
            correctAnswer: { value: true },
            options: [],
            exercise: {
              lesson: { id: 'l1', title: 'Bài 1', course: { id: 'c1', title: 'Khóa 1' } },
            },
          },
        })),
    ),
    countDue: vi.fn(
      async (userId: string, now: Date) =>
        schedules.filter((s) => s.userId === userId && s.dueAt <= now).length,
    ),
    nextDueAt: vi.fn(async (userId: string, now: Date) => {
      const later = schedules
        .filter((s) => s.userId === userId && s.dueAt > now)
        .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
      return later[0]?.dueAt ?? null;
    }),
    findSchedule: vi.fn(
      async (userId: string, questionId: string) =>
        schedules.find((s) => s.userId === userId && s.questionId === questionId) ?? null,
    ),
    lockSchedule: vi.fn(
      async (_tx: unknown, userId: string, questionId: string) =>
        schedules.find((s) => s.userId === userId && s.questionId === questionId) ?? null,
    ),
    findReviewByKey: vi.fn(async (userId: string, key: string) => {
      const r = reviews.find((x) => x.userId === userId && x.idempotencyKey === key);
      return r ? { requestHash: r.requestHash, response: r.response } : null;
    }),
    createReview: vi.fn(async (_tx: unknown, row: ReviewRow) => {
      if (
        row.idempotencyKey &&
        reviews.some((x) => x.userId === row.userId && x.idempotencyKey === row.idempotencyKey)
      ) {
        throw Object.assign(new Error('unique'), {
          code: 'P2002',
          meta: { target: ['userId', 'idempotencyKey'] },
        });
      }
      reviews.push(row);
    }),
    updateSchedule: vi.fn(async (_tx: unknown, id: string, data: Partial<Sched>) => {
      const s = schedules.find((x) => x.id === id);
      if (s) Object.assign(s, data);
    }),
  };
  const service = new ReviewsService(
    { client: { $transaction: async (fn: (tx: unknown) => unknown) => fn({}) } } as never,
    repo as never,
  );
  return { service, repo, schedules, reviews };
}

const input = (over: Partial<SubmitReviewInput> = {}): SubmitReviewInput => ({
  grade: 'GOOD',
  reviewedAt: NOW.toISOString(),
  ...over,
});

describe('ReviewsService.due', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it('only creates cards for submitted questions: wrong/unanswered due now, right due in 1 day', async () => {
    const t = setup();
    const res = await t.service.due('u1', 20);
    const byQ = new Map(t.schedules.map((s) => [s.questionId, s.dueAt.getTime()]));
    expect([...byQ.keys()].sort()).toEqual(['q1', 'q2', 'q3']);
    expect(byQ.get('q1')).toBe(NOW.getTime());
    expect(byQ.get('q3')).toBe(NOW.getTime());
    expect(byQ.get('q2')).toBe(NOW.getTime() + DAY);
    expect(res.cards.map((c) => c.questionId).sort()).toEqual(['q1', 'q3']);
    expect(res.dueCount).toBe(2);
    expect(res.nextDueAt).toBe(at(DAY).toISOString());
  });

  it('never makes cards from exercises without a submission', async () => {
    const t = setup({});
    const res = await t.service.due('u1', 20);
    expect(t.schedules).toHaveLength(0);
    expect(res).toEqual({ cards: [], dueCount: 0, nextDueAt: null });
  });

  it('does not recreate schedules on a second call', async () => {
    const t = setup();
    await t.service.due('u1', 20);
    await t.service.due('u1', 20);
    expect(t.schedules).toHaveLength(3);
  });

  it('respects limit but reports the full dueCount', async () => {
    const t = setup({ q1: false, q2: false, q3: false });
    const res = await t.service.due('u1', 2);
    expect(res.cards).toHaveLength(2);
    expect(res.dueCount).toBe(3);
  });

  it('builds the card with course/lesson info and answer text', async () => {
    const t = setup({ q1: false });
    const [card] = (await t.service.due('u1', 20)).cards;
    expect(card).toMatchObject({
      questionId: 'q1',
      prompt: 'prompt q1',
      answerText: 'Đúng',
      courseId: 'c1',
      courseTitle: 'Khóa 1',
      lessonId: 'l1',
      lessonTitle: 'Bài 1',
      intervalDays: 0,
      repetitions: 0,
    });
  });
});

describe('answerTextOf', () => {
  it('maps each question type to a public answer', () => {
    expect(
      answerTextOf({
        type: 'MULTIPLE_CHOICE',
        correctAnswer: { correctIndex: 0 },
        options: [
          { content: 'Sai', isCorrect: false },
          { content: 'Đúng nè', isCorrect: true },
        ],
      }),
    ).toBe('Đúng nè');
    expect(answerTextOf({ type: 'TRUE_FALSE', correctAnswer: { value: false }, options: [] })).toBe(
      'Sai',
    );
    expect(
      answerTextOf({
        type: 'SHORT_ANSWER',
        correctAnswer: { acceptable: ['một', 'hai'] },
        options: [],
      }),
    ).toBe('một');
    expect(
      answerTextOf({ type: 'FILL_BLANK', correctAnswer: { acceptable: [] }, options: [] }),
    ).toBe('');
  });
});

describe('ReviewsService.review', () => {
  let t: ReturnType<typeof setup>;
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    t = setup();
    await t.service.due('u1', 20);
  });
  afterEach(() => vi.useRealTimers());

  it('404 when the card has no schedule (never submitted)', async () => {
    await expect(t.service.review('u1', 'nope', input(), null)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('applies SM-2 and sets dueAt = reviewedAt + interval', async () => {
    const res = await t.service.review('u1', 'q1', input(), null);
    expect(res).toEqual({
      questionId: 'q1',
      dueAt: at(DAY).toISOString(),
      intervalDays: 1,
      repetitions: 1,
      easeFactor: 2.5,
      applied: true,
    });
    expect(t.schedules.find((s) => s.questionId === 'q1')?.lastReviewedAt).toEqual(NOW);
    expect(t.reviews).toHaveLength(1);
  });

  it('clamps a reviewedAt in the future to server now', async () => {
    const res = await t.service.review(
      'u1',
      'q1',
      input({ reviewedAt: at(30 * DAY).toISOString() }),
      null,
    );
    expect(res.dueAt).toBe(at(DAY).toISOString());
    expect(t.reviews[0]?.reviewedAt).toEqual(NOW);
  });

  it('clamps a reviewedAt before the card existed up to the card creation time', async () => {
    const created = t.schedules.find((s) => s.questionId === 'q1')!.createdAt;
    await t.service.review('u1', 'q1', input({ reviewedAt: '2000-01-01T00:00:00.000Z' }), null);
    expect(t.reviews[0]?.reviewedAt).toEqual(created);
  });

  it('chains two offline reviews of one card in reviewedAt order', async () => {
    await t.service.review('u1', 'q1', input({ reviewedAt: at(-2000).toISOString() }), null);
    const second = await t.service.review(
      'u1',
      'q1',
      input({ reviewedAt: at(-1000).toISOString() }),
      null,
    );
    expect(second.repetitions).toBe(2);
    expect(second.intervalDays).toBe(6);
    expect(second.applied).toBe(true);
  });

  it('stores a stale review (older than lastReviewedAt) with applied:false and keeps the schedule', async () => {
    await t.service.review('u1', 'q1', input({ reviewedAt: at(-1000).toISOString() }), null);
    const before = { ...t.schedules.find((s) => s.questionId === 'q1')! };
    const res = await t.service.review(
      'u1',
      'q1',
      input({ grade: 'AGAIN', reviewedAt: at(-5000).toISOString() }),
      null,
    );
    expect(res.applied).toBe(false);
    expect(res.repetitions).toBe(before.repetitions);
    expect(res.dueAt).toBe(before.dueAt.toISOString());
    expect(t.reviews).toHaveLength(2);
    expect(t.schedules.find((s) => s.questionId === 'q1')).toEqual(before);
  });

  it('replays the first result for a repeated key without applying again', async () => {
    const first = await t.service.review('u1', 'q1', input(), KEY);
    const again = await t.service.review('u1', 'q1', input(), KEY);
    expect(again).toEqual(first);
    expect(t.reviews).toHaveLength(1);
    expect(t.schedules.find((s) => s.questionId === 'q1')?.repetitions).toBe(1);
  });

  it('rejects the same key with a different body as 409', async () => {
    await t.service.review('u1', 'q1', input(), KEY);
    await expect(t.service.review('u1', 'q1', input({ grade: 'EASY' }), KEY)).rejects.toMatchObject(
      {
        status: 409,
        code: 'CONFLICT',
        meta: { reason: 'IDEMPOTENCY_KEY_REUSED' },
      },
    );
    await expect(t.service.review('u1', 'q2', input(), KEY)).rejects.toMatchObject({
      status: 409,
    });
  });

  it('replays when a concurrent request with the same key won the insert', async () => {
    const first = await t.service.review('u1', 'q1', input(), KEY);
    t.repo.findReviewByKey.mockResolvedValueOnce(null);
    const racing = await t.service.review('u1', 'q1', input(), KEY);
    expect(racing).toEqual(first);
    expect(t.reviews).toHaveLength(1);
  });

  it('stores the response with the review row (same transaction)', async () => {
    const res = await t.service.review('u1', 'q1', input(), KEY);
    expect(t.reviews[0]?.response).toEqual(res);
    expect(t.reviews[0]?.idempotencyKey).toBe(KEY);
  });

  it('keeps keys per user', async () => {
    await t.service.due('u2', 20);
    await t.service.review('u1', 'q1', input(), KEY);
    await t.service.review('u2', 'q1', input(), KEY);
    expect(t.reviews).toHaveLength(2);
  });
});
