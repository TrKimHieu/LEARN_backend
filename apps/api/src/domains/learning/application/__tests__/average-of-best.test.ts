import { describe, expect, it } from 'vitest';
import { averageOfBestScores } from '../progress.service';

describe('averageOfBestScores', () => {
  it('chỉ tính lần tốt nhất của mỗi bài tập', () => {
    expect(averageOfBestScores([{ _max: { score: 100 } }])).toBe(100);
    expect(averageOfBestScores([{ _max: { score: 100 } }, { _max: { score: 50 } }])).toBe(75);
  });

  it('làm tròn một chữ số thập phân', () => {
    const scores = [100, 100, 50].map((score) => ({ _max: { score } }));
    expect(averageOfBestScores(scores)).toBe(83.3);
  });

  it('chưa nộp bài nào thì không có điểm', () => {
    expect(averageOfBestScores([])).toBeNull();
  });
});
