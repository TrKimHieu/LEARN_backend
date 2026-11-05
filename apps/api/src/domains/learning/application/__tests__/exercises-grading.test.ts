import { describe, it, expect, vi } from 'vitest';
import {
  normalize,
  gradeAnswer,
  gradeFreeTextAnswers,
  gradeSubmission,
} from '../exercises.service';
import type { SubmitExerciseInput } from '@learn/contracts';

describe('normalize (chuẩn hoá tiếng Việt)', () => {
  it('bỏ dấu tiếng Việt, hạ chữ thường', () => {
    expect(normalize('Nói Tiếng Việt Không Dấu')).toBe('noi tieng viet khong dau');
  });

  it('gộp khoảng trắng và trim', () => {
    expect(normalize('  một   hai  ba ')).toBe('mot hai ba');
  });

  it('bỏ dấu câu cuối câu', () => {
    expect(normalize('Có đúng không?')).toBe('co dung khong');
    expect(normalize('Dấu chấm.')).toBe('dau cham');
  });

  it('chuẩn hoá chữ đặc trưng (đ → d, ộ → o)', () => {
    expect(normalize('độc lập')).toBe('doc lap');
  });
});

describe('gradeAnswer', () => {
  const mcQuestion = {
    id: 'q1',
    type: 'MULTIPLE_CHOICE',
    correctAnswer: {},
    options: [
      { id: 'a', isCorrect: true },
      { id: 'b', isCorrect: false },
      { id: 'c', isCorrect: false },
      { id: 'd', isCorrect: false },
    ],
  };

  it('chấm đúng MULTIPLE_CHOICE khi chọn đáp án đúng', () => {
    const answer: SubmitExerciseInput['answers'][number] = {
      questionId: 'q1',
      type: 'MULTIPLE_CHOICE',
      optionId: 'a',
    };
    expect(gradeAnswer(mcQuestion, answer).isCorrect).toBe(true);
  });

  it('chặn MULTIPLE_CHOICE khi chọn đáp án sai', () => {
    const answer: SubmitExerciseInput['answers'][number] = {
      questionId: 'q1',
      type: 'MULTIPLE_CHOICE',
      optionId: 'b',
    };
    expect(gradeAnswer(mcQuestion, answer).isCorrect).toBe(false);
  });

  it('chặn sai type khi gửi SHORT_ANSWER cho câu MULTIPLE_CHOICE', () => {
    const answer: SubmitExerciseInput['answers'][number] = {
      questionId: 'q1',
      type: 'SHORT_ANSWER',
      text: 'a',
    };
    expect(gradeAnswer(mcQuestion, answer).isCorrect).toBe(false);
  });

  it('chấm đúng TRUE_FALSE', () => {
    const tfQuestion = {
      id: 'q2',
      type: 'TRUE_FALSE',
      correctAnswer: { value: true },
      options: [],
    };
    const yes: SubmitExerciseInput['answers'][number] = {
      questionId: 'q2',
      type: 'TRUE_FALSE',
      value: true,
    };
    const no: SubmitExerciseInput['answers'][number] = {
      questionId: 'q2',
      type: 'TRUE_FALSE',
      value: false,
    };
    expect(gradeAnswer(tfQuestion, yes).isCorrect).toBe(true);
    expect(gradeAnswer(tfQuestion, no).isCorrect).toBe(false);
  });

  it('chấm đúng SHORT_ANSWER theo danh sách đáp án chấp nhận, kể cả có dấu', () => {
    const saQuestion = {
      id: 'q3',
      type: 'SHORT_ANSWER',
      correctAnswer: { acceptable: ['dao dong dieu hoa'] },
      options: [],
    };
    const answer: SubmitExerciseInput['answers'][number] = {
      questionId: 'q3',
      type: 'SHORT_ANSWER',
      text: 'Dao động điều hoà',
    };
    expect(gradeAnswer(saQuestion, answer).isCorrect).toBe(true);
  });

  it('chấm đúng FILL_BLANK', () => {
    const fbQuestion = {
      id: 'q4',
      type: 'FILL_BLANK',
      correctAnswer: { acceptable: ['6', 'sáu'] },
      options: [],
    };
    const six: SubmitExerciseInput['answers'][number] = {
      questionId: 'q4',
      type: 'FILL_BLANK',
      text: '6',
    };
    const viet: SubmitExerciseInput['answers'][number] = {
      questionId: 'q4',
      type: 'FILL_BLANK',
      text: ' Sáu ',
    };
    const wrong: SubmitExerciseInput['answers'][number] = {
      questionId: 'q4',
      type: 'FILL_BLANK',
      text: '7',
    };
    expect(gradeAnswer(fbQuestion, six).isCorrect).toBe(true);
    expect(gradeAnswer(fbQuestion, viet).isCorrect).toBe(true);
    expect(gradeAnswer(fbQuestion, wrong).isCorrect).toBe(false);
  });

  it('unknown type → sai', () => {
    const unknown = { id: 'q9', type: 'VIDEO', correctAnswer: {}, options: [] };
    const answer: SubmitExerciseInput['answers'][number] = {
      questionId: 'q9',
      type: 'SHORT_ANSWER',
      text: 'x',
    };
    expect(gradeAnswer(unknown, answer).isCorrect).toBe(false);
  });
});

describe('AI chấm SHORT_ANSWER khi nộp', () => {
  const question = (
    id: string,
    type = 'SHORT_ANSWER',
    acceptable = ['Lấy dữ liệu từ máy chủ'],
  ) => ({
    id,
    type,
    prompt: 'Phương thức GET dùng để làm gì?',
    points: 1,
    correctAnswer: { acceptable },
    explanation: null,
    options: [],
  });
  const answersOf = (
    ...items: Array<[string, string, ('SHORT_ANSWER' | 'FILL_BLANK')?]>
  ): Map<string, SubmitExerciseInput['answers'][number]> =>
    new Map(
      items.map(([questionId, text, type = 'SHORT_ANSWER']) => [
        questionId,
        { questionId, type, text },
      ]),
    );

  it('khớp nguyên văn thì không tốn lượt gọi AI', async () => {
    const grade = vi.fn();
    const verdicts = await gradeFreeTextAnswers(
      [question('q1')],
      answersOf(['q1', 'lấy dữ liệu từ máy chủ.']),
      { grade },
    );
    expect(grade).not.toHaveBeenCalled();
    expect(verdicts.size).toBe(0);
  });

  it('diễn đạt khác thì gửi AI, kết quả được tính điểm', async () => {
    const grade = vi.fn().mockResolvedValue(true);
    const questions = [question('q1')];
    const answers = answersOf(['q1', 'Đọc data từ server']);
    const verdicts = await gradeFreeTextAnswers(questions, answers, { grade });
    expect(grade).toHaveBeenCalledWith({
      questionPrompt: questions[0]!.prompt,
      modelAnswers: ['Lấy dữ liệu từ máy chủ'],
      answer: 'Đọc data từ server',
    });
    const graded = gradeSubmission(questions, answers, {
      passScore: 50,
      semanticVerdicts: verdicts,
    });
    expect(graded.results[0]!.isCorrect).toBe(true);
    expect(graded.percent).toBe(100);
  });

  it('AI chấm sai thì không có điểm', async () => {
    const questions = [question('q1')];
    const answers = answersOf(['q1', 'Xoá dữ liệu']);
    const verdicts = await gradeFreeTextAnswers(questions, answers, {
      grade: vi.fn().mockResolvedValue(false),
    });
    const graded = gradeSubmission(questions, answers, {
      passScore: 50,
      semanticVerdicts: verdicts,
    });
    expect(graded.percent).toBe(0);
  });

  it('FILL_BLANK vẫn so khớp, không gọi AI', async () => {
    const grade = vi.fn();
    await gradeFreeTextAnswers(
      [question('q1', 'FILL_BLANK', ['6'])],
      answersOf(['q1', '7', 'FILL_BLANK']),
      { grade },
    );
    expect(grade).not.toHaveBeenCalled();
  });

  it('câu không có đáp án mẫu hoặc chỉ có khoảng trắng thì không gọi AI', async () => {
    const grade = vi.fn();
    await gradeFreeTextAnswers(
      [question('q1', 'SHORT_ANSWER', []), question('q2')],
      answersOf(['q1', 'gì đó'], ['q2', '   ']),
      { grade },
    );
    expect(grade).not.toHaveBeenCalled();
  });

  it('AI lỗi thì báo 503, không ghi nhận điểm sai', async () => {
    await expect(
      gradeFreeTextAnswers([question('q1')], answersOf(['q1', 'Đọc data']), {
        grade: vi.fn().mockRejectedValue(new Error('timeout')),
      }),
    ).rejects.toMatchObject({ status: 503, code: 'UPSTREAM_UNAVAILABLE' });
  });

  it('không có kết quả AI thì giữ cách chấm cũ', () => {
    const graded = gradeSubmission([question('q1')], answersOf(['q1', 'Đọc data']), {
      passScore: 50,
    });
    expect(graded.results[0]!.isCorrect).toBe(false);
  });
});
