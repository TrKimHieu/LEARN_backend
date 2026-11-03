import { describe, it, expect } from 'vitest';
import { isLessonComplete } from '../lesson-completion';

/**
 * Trước đây API chỉ đọc bài tập ĐẦU TIÊN của mỗi bài học, nên đạt bài đó là bài học "xong" dù
 * AI đã sinh tới 5 bài tập. Nay người học làm được mọi bài tập, và bài học chỉ hoàn thành khi
 * mọi bài tập đều đã có ít nhất một lượt đạt.
 */
describe('isLessonComplete', () => {
  const ex = (id: string, passScore = 70) => ({ id, passScore });

  it('một bài tập, đã đạt → hoàn thành (hành vi cũ giữ nguyên)', () => {
    expect(isLessonComplete([ex('a')], new Map([['a', 80]]))).toBe(true);
  });

  it('một bài tập, chưa đạt → chưa hoàn thành', () => {
    expect(isLessonComplete([ex('a')], new Map([['a', 60]]))).toBe(false);
  });

  it('điểm đúng bằng ngưỡng đạt → đạt', () => {
    expect(isLessonComplete([ex('a', 70)], new Map([['a', 70]]))).toBe(true);
  });

  it('hai bài tập, mới đạt một → chưa hoàn thành', () => {
    expect(isLessonComplete([ex('a'), ex('b')], new Map([['a', 100]]))).toBe(false);
  });

  it('hai bài tập, cả hai đạt → hoàn thành', () => {
    expect(
      isLessonComplete(
        [ex('a'), ex('b', 50)],
        new Map([
          ['a', 90],
          ['b', 55],
        ]),
      ),
    ).toBe(true);
  });

  it('mỗi bài tập so với ngưỡng riêng của nó', () => {
    expect(
      isLessonComplete(
        [ex('a', 90), ex('b', 50)],
        new Map([
          ['a', 80],
          ['b', 80],
        ]),
      ),
    ).toBe(false);
  });

  it('bài học không có bài tập nào → không coi là hoàn thành qua đường nộp bài', () => {
    expect(isLessonComplete([], new Map())).toBe(false);
  });
});
