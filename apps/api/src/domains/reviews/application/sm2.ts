import type { ReviewGrade } from '@learn/contracts';

export interface Sm2State {
  easeFactor: number;
  intervalDays: number;
  repetitions: number;
  lapses: number;
}

/** Mức tự chấm -> chất lượng nhớ q của SM-2. */
const QUALITY: Record<ReviewGrade, number> = { AGAIN: 1, HARD: 3, GOOD: 4, EASY: 5 };

const MIN_EASE = 1.3;
const EASY_BONUS = 1.3;

/**
 * SM-2 thuần, một lượt chấm. q < 3 thì quên: về lần lặp 0, ôn lại sau 1 ngày, lapses + 1.
 * Ngược lại lần lặp 1 -> 1 ngày, 2 -> 6 ngày, sau đó round(interval × EF). `EASY` nhân thêm 1.3.
 * EF mới = EF + (0.1 − (5−q)(0.08 + (5−q)·0.02)), tối thiểu 1.3; khoảng ngày dùng EF trước khi cập nhật.
 */
export function sm2(state: Sm2State, grade: ReviewGrade): Sm2State {
  const q = QUALITY[grade];
  const miss = 5 - q;
  const easeFactor = round4(
    Math.max(MIN_EASE, state.easeFactor + (0.1 - miss * (0.08 + miss * 0.02))),
  );

  if (q < 3) {
    return { easeFactor, intervalDays: 1, repetitions: 0, lapses: state.lapses + 1 };
  }

  const repetitions = state.repetitions + 1;
  let intervalDays =
    repetitions === 1
      ? 1
      : repetitions === 2
        ? 6
        : Math.round(Math.max(1, state.intervalDays) * state.easeFactor);
  if (grade === 'EASY') intervalDays = Math.max(1, Math.round(intervalDays * EASY_BONUS));

  return { easeFactor, intervalDays, repetitions, lapses: state.lapses };
}

/** Chặn nhiễu số thực để EF lưu xuống DB và so sánh trong test ổn định. */
function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
