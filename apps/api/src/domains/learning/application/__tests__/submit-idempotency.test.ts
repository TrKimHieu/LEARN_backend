import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SubmitExerciseInput } from '@learn/contracts';
import { ApiError } from '../../../../core/exceptions/errors';
import { ExercisesService } from '../exercises.service';
import { parseIdempotencyKey, submissionFingerprint } from '../submit-idempotency';

const KEY = '7f9c2b1e-4d3a-4c55-9e1f-2a6b8c0d1e23';

describe('parseIdempotencyKey', () => {
  it('returns null when the header is absent', () => {
    expect(parseIdempotencyKey(undefined)).toBeNull();
    expect(parseIdempotencyKey('')).toBeNull();
  });
  it('accepts UUID-like keys', () => expect(parseIdempotencyKey(KEY)).toBe(KEY));
  it('rejects malformed keys with 400', () => {
    for (const bad of ['short', 'x'.repeat(129), 'has space here!!', ['a', 'b']]) {
      expect(() => parseIdempotencyKey(bad)).toThrow(ApiError);
    }
  });
});

describe('submissionFingerprint', () => {
  const input: SubmitExerciseInput = {
    exerciseId: 'e1',
    answers: [
      { questionId: 'q1', type: 'TRUE_FALSE', value: true },
      { questionId: 'q2', type: 'TRUE_FALSE', value: false },
    ],
  } as SubmitExerciseInput;
  it('ignores key order and answer order', () => {
    const reordered = {
      answers: [...input.answers].reverse(),
      exerciseId: 'e1',
    } as SubmitExerciseInput;
    expect(submissionFingerprint('l1', reordered)).toBe(submissionFingerprint('l1', input));
  });
  it('changes with the answers or the lesson', () => {
    const changed = {
      ...input,
      answers: [{ questionId: 'q1', type: 'TRUE_FALSE', value: false }],
    } as SubmitExerciseInput;
    expect(submissionFingerprint('l1', changed)).not.toBe(submissionFingerprint('l1', input));
    expect(submissionFingerprint('l2', input)).not.toBe(submissionFingerprint('l1', input));
  });
});

/** Dịch vụ thật trên repo giả: lưu Submission trong bộ nhớ, ràng buộc unique như Postgres. */
function setup() {
  const rows: Array<{
    id: string;
    userId: string;
    idempotencyKey: string | null;
    requestHash: string | null;
    response: unknown;
  }> = [];
  const exercise = {
    id: 'e1',
    passScore: 50,
    questions: [
      {
        id: 'q1',
        type: 'TRUE_FALSE',
        points: 1,
        correctAnswer: { value: true },
        explanation: null,
        options: [],
      },
    ],
  };
  const submissions = {
    findByIdempotencyKey: vi.fn(async (userId: string, key: string) => {
      const r = rows.find((x) => x.userId === userId && x.idempotencyKey === key);
      return r ? { requestHash: r.requestHash, response: r.response } : null;
    }),
    createWithAnswers: vi.fn(
      async (
        _tx: unknown,
        args: { userId: string; idempotency?: { key: string; requestHash: string } },
      ) => {
        const key = args.idempotency?.key ?? null;
        if (key && rows.some((x) => x.userId === args.userId && x.idempotencyKey === key)) {
          throw Object.assign(new Error('unique'), {
            code: 'P2002',
            meta: { target: ['userId', 'idempotencyKey'] },
          });
        }
        const id = `s${rows.length + 1}`;
        rows.push({
          id,
          userId: args.userId,
          idempotencyKey: key,
          requestHash: args.idempotency?.requestHash ?? null,
          response: null,
        });
        return { id, attemptNo: rows.length, createdAt: new Date('2026-11-09T00:00:00Z') };
      },
    ),
    saveResponse: vi.fn(async (_tx: unknown, id: string, response: unknown) => {
      const r = rows.find((x) => x.id === id);
      if (r) r.response = response;
    }),
    bestScoresForExercises: vi.fn(async () => new Map([['e1', 100]])),
  };
  const service = new ExercisesService(
    { client: { $transaction: async (fn: (tx: unknown) => unknown) => fn({}) } } as never,
    { assertAccessible: vi.fn(async () => ({ courseId: 'c1' })) } as never,
    {
      findForLesson: vi.fn(async () => exercise),
      listForLesson: vi.fn(async () => [exercise]),
    } as never,
    submissions as never,
    { upsertAfterSubmission: vi.fn(async () => undefined) } as never,
  );
  const input = {
    exerciseId: 'e1',
    answers: [{ questionId: 'q1', type: 'TRUE_FALSE', value: true }],
  } as SubmitExerciseInput;
  return { service, submissions, rows, input };
}

describe('ExercisesService.submit with Idempotency-Key', () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => {
    t = setup();
  });

  it('replays the first result for a repeated key without grading again', async () => {
    const first = await t.service.submit('u1', 'l1', t.input, KEY);
    const again = await t.service.submit('u1', 'l1', t.input, KEY);
    expect(again).toEqual(first);
    expect(t.submissions.createWithAnswers).toHaveBeenCalledTimes(1);
    expect(t.rows).toHaveLength(1);
  });

  it('rejects the same key with a different body as 409', async () => {
    await t.service.submit('u1', 'l1', t.input, KEY);
    const other = {
      ...t.input,
      answers: [{ questionId: 'q1', type: 'TRUE_FALSE', value: false }],
    } as SubmitExerciseInput;
    await expect(t.service.submit('u1', 'l1', other, KEY)).rejects.toMatchObject({
      status: 409,
      code: 'CONFLICT',
      meta: { reason: 'IDEMPOTENCY_KEY_REUSED' },
    });
  });

  it('keeps keys per user', async () => {
    await t.service.submit('u1', 'l1', t.input, KEY);
    await t.service.submit('u2', 'l1', t.input, KEY);
    expect(t.rows).toHaveLength(2);
  });

  it('creates a new attempt on every call without a key', async () => {
    await t.service.submit('u1', 'l1', t.input);
    await t.service.submit('u1', 'l1', t.input);
    expect(t.rows).toHaveLength(2);
  });

  it('replays when a concurrent request with the same key won the insert', async () => {
    const first = await t.service.submit('u1', 'l1', t.input, KEY);
    // Lượt song song: lúc đọc chưa thấy bản ghi, tới lúc ghi thì đụng unique.
    t.submissions.findByIdempotencyKey.mockResolvedValueOnce(null);
    const racing = await t.service.submit('u1', 'l1', t.input, KEY);
    expect(racing).toEqual(first);
    expect(t.rows).toHaveLength(1);
  });

  it('stores the response inside the same transaction as the submission', async () => {
    const res = await t.service.submit('u1', 'l1', t.input, KEY);
    expect(t.submissions.saveResponse).toHaveBeenCalledWith(expect.anything(), 's1', res);
  });
});
