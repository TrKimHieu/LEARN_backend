import { describe, expect, it } from 'vitest';
import { dueReviewsQuerySchema, reviewGradeSchema, submitReviewSchema } from '../review';

describe('review contracts', () => {
  it('accepts the four self-grades only', () => {
    for (const g of ['AGAIN', 'HARD', 'GOOD', 'EASY']) expect(reviewGradeSchema.parse(g)).toBe(g);
    expect(reviewGradeSchema.safeParse('PERFECT').success).toBe(false);
  });
  it('requires an ISO reviewedAt and rejects extra keys', () => {
    expect(
      submitReviewSchema.safeParse({ grade: 'GOOD', reviewedAt: '2026-11-09T08:00:00.000Z' })
        .success,
    ).toBe(true);
    expect(submitReviewSchema.safeParse({ grade: 'GOOD', reviewedAt: 'yesterday' }).success).toBe(
      false,
    );
    expect(
      submitReviewSchema.safeParse({
        grade: 'GOOD',
        reviewedAt: '2026-11-09T08:00:00.000Z',
        intervalDays: 99,
      }).success,
    ).toBe(false);
  });
  it('bounds the due-list limit with a default of 20', () => {
    expect(dueReviewsQuerySchema.parse({})).toEqual({ limit: 20 });
    expect(dueReviewsQuerySchema.parse({ limit: '5' })).toEqual({ limit: 5 });
    expect(dueReviewsQuerySchema.safeParse({ limit: '51' }).success).toBe(false);
  });
});
