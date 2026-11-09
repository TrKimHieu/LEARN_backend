import { describe, it, expect } from 'vitest';
import { sm2, type Sm2State } from '../sm2';

const fresh: Sm2State = { easeFactor: 2.5, intervalDays: 0, repetitions: 0, lapses: 0 };

describe('sm2', () => {
  it('first GOOD review -> 1 day, repetitions 1, EF unchanged', () => {
    expect(sm2(fresh, 'GOOD')).toEqual({
      easeFactor: 2.5,
      intervalDays: 1,
      repetitions: 1,
      lapses: 0,
    });
  });

  it('second GOOD -> 6 days; third GOOD -> round(6 * EF)', () => {
    const one = sm2(fresh, 'GOOD');
    const two = sm2(one, 'GOOD');
    expect(two.intervalDays).toBe(6);
    expect(two.repetitions).toBe(2);
    const three = sm2(two, 'GOOD');
    expect(three.intervalDays).toBe(Math.round(6 * two.easeFactor));
    expect(three.intervalDays).toBe(15);
  });

  it('AGAIN resets repetitions, interval 1 day, lapses + 1, EF drops by 0.54', () => {
    const grown = { easeFactor: 2.5, intervalDays: 15, repetitions: 3, lapses: 1 };
    const out = sm2(grown, 'AGAIN');
    expect(out.repetitions).toBe(0);
    expect(out.intervalDays).toBe(1);
    expect(out.lapses).toBe(2);
    expect(out.easeFactor).toBeCloseTo(1.96, 4);
  });

  it('EF follows the SM-2 formula per grade', () => {
    expect(sm2(fresh, 'HARD').easeFactor).toBeCloseTo(2.36, 4);
    expect(sm2(fresh, 'GOOD').easeFactor).toBeCloseTo(2.5, 4);
    expect(sm2(fresh, 'EASY').easeFactor).toBeCloseTo(2.6, 4);
  });

  it('HARD still counts as a pass (q = 3)', () => {
    const out = sm2(fresh, 'HARD');
    expect(out.repetitions).toBe(1);
    expect(out.intervalDays).toBe(1);
    expect(out.lapses).toBe(0);
  });

  it('EF never drops below 1.3', () => {
    let s = fresh;
    for (let i = 0; i < 10; i++) s = sm2(s, 'AGAIN');
    expect(s.easeFactor).toBe(1.3);
  });

  it('EASY gives a longer interval than GOOD and at least 1 day', () => {
    const base = sm2(sm2(fresh, 'GOOD'), 'GOOD');
    expect(sm2(base, 'EASY').intervalDays).toBeGreaterThan(sm2(base, 'GOOD').intervalDays);
    expect(sm2(fresh, 'EASY').intervalDays).toBeGreaterThanOrEqual(1);
  });

  it('does not mutate its input', () => {
    const input = { ...fresh };
    sm2(input, 'GOOD');
    expect(input).toEqual(fresh);
  });
});
