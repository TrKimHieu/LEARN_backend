import { describe, it, expect } from 'vitest';
import { lessonPrompt, LESSON_PROMPT_VERSION } from '../prompts/lesson';
import {
  coverageFeedback,
  outlineCoverage,
  outlinePrompt,
  OUTLINE_PROMPT_VERSION,
} from '../prompts/outline';

const prompt = lessonPrompt({
  language: 'vi',
  courseTitle: 'HTTP',
  nodeTitle: 'Mã trạng thái',
  nodeDescription: 'Các nhóm mã trạng thái phản hồi',
  chunks: [{ id: 'chunk-1', content: 'Mã 200 OK nghĩa là thành công.' }],
});

/**
 * Chạy thật với Gemini (2026-09-27): prompt chỉ liệt kê tên trường nên model tự bịa giá trị
 * `difficulty`/`type` → 100% bài học trượt tầng 1 kể cả sau 3 lần sửa. Prompt phải nêu đủ hợp đồng.
 */
describe('lessonPrompt — nêu đủ hợp đồng output để model thật khớp schema tầng 1', () => {
  it.each(['EASY', 'MEDIUM', 'HARD'])('liệt kê giá trị difficulty %s', (value) => {
    expect(prompt).toContain(`"${value}"`);
  });

  it.each(['MULTIPLE_CHOICE', 'TRUE_FALSE', 'SHORT_ANSWER', 'FILL_BLANK'])(
    'liệt kê loại câu hỏi %s',
    (value) => {
      expect(prompt).toContain(`"${value}"`);
    },
  );

  it.each(['statement', 'modelAnswer', 'blankHint', 'isCorrect', 'sourceChunkId'])(
    'mô tả trường riêng của từng loại câu hỏi: %s',
    (field) => {
      expect(prompt).toContain(`"${field}"`);
    },
  );

  it('dặn giữ nguyên giá trị enum, không dịch theo ngôn ngữ bài học', () => {
    expect(prompt).toMatch(/không dịch/i);
  });

  it('đổi nội dung prompt thì tăng version để GenerationRun phân biệt được', () => {
    expect(LESSON_PROMPT_VERSION).toBe('lesson@3');
  });
});

describe('lessonPrompt — độ khó người dùng chọn', () => {
  const base = {
    language: 'vi' as const,
    courseTitle: 'HTTP',
    nodeTitle: 'Mã trạng thái',
    nodeDescription: 'Các nhóm mã trạng thái phản hồi',
    chunks: [{ id: 'chunk-1', content: 'Mã 200 OK nghĩa là thành công.' }],
  };

  // Trước đây `params.difficulty` không đi vào prompt: chọn "Khó" vẫn ra bài như "Vừa".
  it('độ khó đã chọn nằm trong luật bắt buộc', () => {
    expect(lessonPrompt({ ...base, difficulty: 'HARD' })).toMatch(
      /"difficulty" của mọi exercise là "HARD"/,
    );
  });

  it('bỏ trống độ khó → MEDIUM', () => {
    expect(lessonPrompt(base)).toMatch(/"difficulty" của mọi exercise là "MEDIUM"/);
  });
});

describe('outlinePrompt — bao phủ tài liệu', () => {
  const chunks = [
    { id: 'c1', headingPath: 'HTTP > Phương thức', preview: 'GET lấy dữ liệu' },
    { id: 'c2', headingPath: '', preview: 'Không có heading' },
  ];

  it('có luật bao phủ và heading path thật', () => {
    const p = outlinePrompt({ language: 'vi', chunks });
    expect(p).toMatch(/BAO PHỦ/);
    expect(p).toContain('heading=HTTP > Phương thức');
    expect(p).toContain('heading=(không có)');
    expect(OUTLINE_PROMPT_VERSION).toBe('outline@2');
  });

  it('preview nhiều dòng vẫn nằm gọn trên một dòng của prompt', () => {
    const p = outlinePrompt({
      language: 'vi',
      chunks: [
        { id: 'c9', headingPath: 'A', preview: ['# A', '', 'Dòng một', 'Dòng hai'].join('\n') },
      ],
    });
    expect(p).toContain('- id=c9 | heading=A | preview=# A Dòng một Dòng hai');
  });

  it('mock LLM vẫn nhận ra prompt outline', () => {
    expect(outlinePrompt({ language: 'vi', chunks })).toContain('DANH SÁCH CHUNK (heading path');
  });
});

describe('outlineCoverage', () => {
  const chunks = [
    { id: 'a', headingPath: 'HTTP > Phương thức' },
    { id: 'b', headingPath: 'HTTP > Mã trạng thái' },
    { id: 'c', headingPath: 'HTTP > Mã trạng thái' },
    { id: 'd', headingPath: 'HTTP > Cookie' },
  ];

  it('outline phủ hết → tỷ lệ sót 0', () => {
    const cov = outlineCoverage(
      { nodes: [{ title: 'x', description: 'y', chunkIds: ['a', 'b', 'c', 'd'] }] },
      chunks,
    );
    expect(cov.ratio).toBe(0);
    expect(cov.uncoveredIds).toEqual([]);
  });

  it('sót chunk → liệt kê id và heading không trùng lặp', () => {
    const cov = outlineCoverage(
      { nodes: [{ title: 'x', description: 'y', chunkIds: ['a'] }] },
      chunks,
    );
    expect(cov.ratio).toBe(0.75);
    expect(cov.uncoveredIds).toEqual(['b', 'c', 'd']);
    expect(cov.uncoveredHeadings).toEqual(['HTTP > Mã trạng thái', 'HTTP > Cookie']);
    expect(coverageFeedback(cov)).toContain('HTTP > Cookie');
    expect(coverageFeedback(cov)).toContain('75%');
  });

  it('tài liệu rỗng → không chia cho 0', () => {
    expect(outlineCoverage({ nodes: [] }, []).ratio).toBe(0);
  });
});
