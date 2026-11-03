import { describe, it, expect } from 'vitest';
import type { LessonOutputT } from '../schemas/output';
import {
  businessRuleViolations,
  confidenceScore,
  sanitizeLessonOutput,
  validateLessonOutput,
} from '../validator/validate';

/**
 * Truy cập phần tử bắt buộc phải có. `noUncheckedIndexedAccess` khiến `arr[0]` có kiểu
 * `T | undefined`, và với union phân biệt thì `undefined` còn chặn luôn việc thu hẹp kiểu
 * theo `q.type`. Ném lỗi ngay tại chỗ cho thông báo rõ hơn là để `undefined` lan xuống.
 */
function at<T>(arr: readonly T[], index: number): T {
  const value = arr[index];
  if (value === undefined) throw new Error(`Không có phần tử ở vị trí ${index}`);
  return value;
}

function validLesson(): LessonOutputT {
  return {
    title: 'Giới thiệu về học máy',
    summary: 'Tổng quan kiến thức nền tảng về học máy và ứng dụng thực tiễn.',
    contentMd: 'Học máy là một nhánh của trí tuệ nhân tạo. '.repeat(30),
    estimatedMinutes: 10,
    sourceChunkIds: ['c1', 'c2'],
    exercises: [
      {
        title: 'Kiểm tra nhanh',
        instruction: 'Chọn đáp án đúng nhất.',
        difficulty: 'EASY',
        questions: [
          {
            type: 'MULTIPLE_CHOICE',
            prompt: 'Học máy thuộc nhánh nào của trí tuệ nhân tạo?',
            options: [
              { content: 'Học máy', isCorrect: true },
              { content: 'Lập trình', isCorrect: false },
              { content: 'Thiết kế', isCorrect: false },
              { content: 'Viết lách', isCorrect: false },
            ],
            explanation: 'Học máy là một nhánh con của trí tuệ nhân tạo.',
            sourceChunkId: 'c1',
          },
        ],
      },
    ],
  };
}

describe('businessRuleViolations', () => {
  it('returns empty errors for a valid lesson', () => {
    expect(businessRuleViolations(validLesson())).toEqual([]);
  });

  it('flags multiple-choice with != 1 correct answer', () => {
    const lesson = validLesson();
    const q = at(at(lesson.exercises, 0).questions, 0);
    if (q.type === 'MULTIPLE_CHOICE') at(q.options, 1).isCorrect = true;
    const errors = businessRuleViolations(lesson);
    expect(errors.some((e) => e.includes('đáp án đúng'))).toBe(true);
  });

  it('flags duplicate options', () => {
    const lesson = validLesson();
    const q = at(at(lesson.exercises, 0).questions, 0);
    if (q.type === 'MULTIPLE_CHOICE') at(q.options, 1).content = at(q.options, 0).content;
    expect(businessRuleViolations(lesson).some((e) => e.includes('trùng nội dung'))).toBe(true);
  });

  it('rejects "tất cả đáp án" style options', () => {
    const lesson = validLesson();
    const q = at(at(lesson.exercises, 0).questions, 0);
    if (q.type === 'MULTIPLE_CHOICE') at(q.options, 2).content = 'Tất cả các đáp án trên';
    expect(businessRuleViolations(lesson).some((e) => e.includes('Tất cả đáp án'))).toBe(true);
  });

  it('flags overly long correct answer (> 2x average wrong)', () => {
    const lesson = validLesson();
    const q = at(at(lesson.exercises, 0).questions, 0);
    if (q.type === 'MULTIPLE_CHOICE') {
      at(q.options, 0).content =
        'Đây là đáp án đúng và nó dài hơn rất nhiều so với các lựa chọn khác';
      at(q.options, 1).content = 'ngắn';
      at(q.options, 2).content = 'ngắn';
      at(q.options, 3).content = 'ngắn';
    }
    expect(businessRuleViolations(lesson).some((e) => e.includes('dài gấp đôi'))).toBe(true);
  });

  it('flags explanation that repeats prompt', () => {
    const lesson = validLesson();
    const q = at(at(lesson.exercises, 0).questions, 0);
    q.explanation = q.prompt + ' và đây là giải thích thêm.';
    expect(businessRuleViolations(lesson).some((e) => e.includes('lặp nguyên văn'))).toBe(true);
  });

  it('flags too-short contentMd', () => {
    const lesson = validLesson();
    lesson.contentMd = 'Nội dung ngắn';
    expect(businessRuleViolations(lesson).some((e) => e.includes('quá ngắn'))).toBe(true);
  });

  it('flags unsafe content', () => {
    const lesson = validLesson();
    lesson.contentMd = `<script>alert(1)</script>${'A'.repeat(500)}`;
    expect(businessRuleViolations(lesson).some((e) => e.includes('HTML/script'))).toBe(true);
  });
});

describe('confidenceScore', () => {
  it('returns 0 when no declared chunk exists in map', () => {
    const lesson = validLesson();
    lesson.sourceChunkIds = ['missing'];
    const score = confidenceScore(lesson, new Map([['c1', 'nội dung']]));
    expect(score).toBe(0);
  });

  it('scores high when all sampled terms appear in declared chunks', () => {
    const lesson = validLesson();
    lesson.contentMd =
      'Học máy là một nhánh của trí tuệ nhân tạo. Nhánh học máy ứng dụng rộng rãi.';
    const chunks = new Map([
      ['c1', 'Học máy là một nhánh của trí tuệ nhân tạo. Có rất nhiều ứng dụng thực tiễn.'],
      ['c2', 'Nội dung bổ sung cho bài học này.'],
    ]);
    const score = confidenceScore(lesson, chunks);
    expect(score).toBeGreaterThanOrEqual(0.5);
  });
});

describe('sanitizeLessonOutput', () => {
  it('strips HTML from fields while keeping plain text', () => {
    const lesson = validLesson();
    lesson.title = '<b>Giới thiệu</b> học máy';
    const cleaned = sanitizeLessonOutput(lesson);
    expect(cleaned.title).not.toContain('<b>');
    expect(cleaned.title).toContain('Giới thiệu học máy');
  });

  it('truncates fields to max length', () => {
    const lesson = validLesson();
    lesson.summary = 'x'.repeat(2000);
    const cleaned = sanitizeLessonOutput(lesson);
    expect(cleaned.summary).toHaveLength(500);
  });
});

describe('validateLessonOutput (4 tầng)', () => {
  it('returns ok for a schema-valid, rule-valid lesson', () => {
    const result = validateLessonOutput(validLesson(), {
      availableChunkIds: ['c1', 'c2'],
      chunkContentById: new Map([
        ['c1', 'Học máy thuộc nhánh trí tuệ nhân tạo.'],
        ['c2', 'Nội dung bổ sung.'],
      ]),
      existingLessonTitles: [],
    });
    expect(result.ok).toBe(true);
  });

  it('rejects malformed input at schema layer', () => {
    const result = validateLessonOutput(
      { title: 'ngắn' },
      {
        availableChunkIds: [],
        chunkContentById: new Map(),
        existingLessonTitles: [],
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects unknown sourceChunkIds', () => {
    const lesson = validLesson();
    lesson.sourceChunkIds = ['ghost-1'];
    const result = validateLessonOutput(lesson, {
      availableChunkIds: ['c1'],
      chunkContentById: new Map(),
      existingLessonTitles: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(at(result.errors, 0).includes('không tồn tại')).toBe(true);
  });

  it('rejects duplicate lesson titles (case-insensitive)', () => {
    const lesson = validLesson();
    const result = validateLessonOutput(lesson, {
      availableChunkIds: ['c1', 'c2'],
      chunkContentById: new Map(),
      existingLessonTitles: ['giới thiệu về học máy'],
    });
    expect(result.ok).toBe(false);
  });

  it('flags low confidence as LOW with reason', () => {
    const lesson = validLesson();
    lesson.contentMd = 'abcdefghi '.repeat(100); // thuật ngữ hiếm không xuất hiện trong chunk
    const result = validateLessonOutput(lesson, {
      availableChunkIds: ['c1', 'c2'],
      chunkContentById: new Map([
        ['c1', 'Một nội dung hoàn toàn khác biệt không liên quan.'],
        ['c2', 'Một nội dung khác cũng không liên quan.'],
      ]),
      existingLessonTitles: [],
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.confidence).toBe('LOW');
  });
});
