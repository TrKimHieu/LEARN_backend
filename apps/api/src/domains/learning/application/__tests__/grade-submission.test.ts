import { describe, it, expect } from 'vitest';
import type { SubmitExerciseInput } from '@learn/contracts';
import { gradeSubmission } from '../exercises.service';

type Answer = SubmitExerciseInput['answers'][number];

const mcq = (id: string, points: number, correctOption: string) => ({
  id,
  type: 'MULTIPLE_CHOICE',
  points,
  correctAnswer: {},
  explanation: `giải thích ${id}`,
  options: [
    { id: `${id}-a`, isCorrect: `${id}-a` === correctOption },
    { id: `${id}-b`, isCorrect: `${id}-b` === correctOption },
  ],
});

const pick = (questionId: string, optionId: string): Answer =>
  ({ questionId, type: 'MULTIPLE_CHOICE', optionId }) as Answer;

const byId = (...answers: Answer[]) => new Map(answers.map((a) => [a.questionId, a]));

describe('gradeSubmission', () => {
  it('tính phần trăm theo TỔNG ĐIỂM, không theo số câu', () => {
    // q1 nặng 3 điểm, q2 nhẹ 1 điểm: đúng mỗi q1 phải là 75%, không phải 50%.
    const questions = [mcq('q1', 3, 'q1-a'), mcq('q2', 1, 'q2-a')];
    const { percent } = gradeSubmission(questions, byId(pick('q1', 'q1-a')), { passScore: 70 });
    expect(percent).toBe(75);
  });

  it('câu không trả lời vẫn có trong results, 0 điểm, kèm đáp án đúng', () => {
    const questions = [mcq('q1', 1, 'q1-a'), mcq('q2', 1, 'q2-a')];
    const { results } = gradeSubmission(questions, byId(pick('q1', 'q1-a')), { passScore: 50 });

    expect(results).toHaveLength(2);
    const skipped = results.find((r) => r.questionId === 'q2');
    expect(skipped).toMatchObject({ isCorrect: false, pointsEarned: 0 });
    // Đáp án chỉ rời server SAU khi nộp — ở đây là đúng lúc `[SPEC]`.
    expect(skipped?.explanation).toBe('giải thích q2');
  });

  // Lỗi thật: worker lưu đáp án trắc nghiệm dạng `{ correctIndex }`, seed lưu `{ optionId }`, web
  // chỉ đọc `optionId` — nên với bài AI sinh, màn kết quả không bao giờ chỉ ra đáp án đúng.
  it('đáp án trắc nghiệm trả về luôn là { optionId } suy từ isCorrect, dù DB lưu dạng nào', () => {
    const q = { ...mcq('q1', 1, 'q1-b'), correctAnswer: { correctIndex: 1 } };
    const { results } = gradeSubmission([q], byId(pick('q1', 'q1-a')), { passScore: 50 });
    expect(results[0]?.correctAnswer).toEqual({ optionId: 'q1-b' });
  });

  it('results giữ nguyên thứ tự câu hỏi đưa vào', () => {
    const questions = [mcq('q1', 1, 'q1-a'), mcq('q2', 1, 'q2-a'), mcq('q3', 1, 'q3-a')];
    const { results } = gradeSubmission(questions, byId(pick('q3', 'q3-a')), { passScore: 50 });
    expect(results.map((r) => r.questionId)).toEqual(['q1', 'q2', 'q3']);
  });

  it('passed so với passScore của chính bài tập', () => {
    const questions = [mcq('q1', 1, 'q1-a'), mcq('q2', 1, 'q2-a')];
    const answers = byId(pick('q1', 'q1-a'));
    expect(gradeSubmission(questions, answers, { passScore: 50 }).passed).toBe(true);
    expect(gradeSubmission(questions, answers, { passScore: 80 }).passed).toBe(false);
  });

  it('bài tập không có câu hỏi nào không làm chia cho 0', () => {
    const out = gradeSubmission([], new Map(), { passScore: 50 });
    expect(out.percent).toBe(0);
    expect(Number.isNaN(out.percent)).toBe(false);
    expect(out.results).toEqual([]);
  });

  it('đáp án gửi kèm cho câu hỏi lạ không ảnh hưởng điểm', () => {
    const questions = [mcq('q1', 1, 'q1-a')];
    const answers = byId(pick('q1', 'q1-a'), pick('khong-ton-tai', 'x'));
    const { percent, results } = gradeSubmission(questions, answers, { passScore: 50 });
    expect(percent).toBe(100);
    expect(results).toHaveLength(1);
  });
});
