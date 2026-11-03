import { describe, it, expect } from 'vitest';
import { MockLlmProvider } from '../llm/mock';
import { lessonPrompt } from '../prompts/lesson';
import { LessonOutput } from '../schemas/output';

/**
 * LLM mock chạy mọi bản demo và kiểm thử đầu-cuối, nên lỗi của nó là lỗi người xem nhìn thấy.
 * Hai lỗi thật tìm ra khi chạy đầu-cuối 2026-09-28 được ghim ở đây.
 */
describe('MockLlmProvider — bài học', () => {
  // uuidv7: các chunk tạo cùng lúc trùng tiền tố thời gian.
  const chunks = [
    {
      id: '01a0e8a1-7a34-7299-9c09-000000000001',
      content: 'HTTP là giao thức phi trạng thái. '.repeat(8).trim(),
    },
  ];

  async function generate(nodeTitle: string) {
    const prompt = lessonPrompt({
      language: 'vi',
      courseTitle: 'HTTP',
      nodeTitle,
      nodeDescription: 'Mô tả mục trong tài liệu',
      chunks,
    });
    const res = await new MockLlmProvider(1200).generate({ prompt, maxTokens: 4000 });
    return LessonOutput.parse(JSON.parse(res.text));
  }

  it('tiêu đề theo mục outline, không theo tiền tố id (trước đây mọi bài trùng tiêu đề)', async () => {
    const a = await generate('Giao thức HTTP > 1. HTTP là gì');
    const b = await generate('Giao thức HTTP > 2. Cấu trúc yêu cầu');
    expect(a.title).toBe('1. HTTP là gì');
    expect(b.title).toBe('2. Cấu trúc yêu cầu');
  });

  it('nội dung không chép lẫn phần chỉ dẫn và JSON Schema nằm sau chunk cuối', async () => {
    const lesson = await generate('Giao thức HTTP > 1. HTTP là gì');
    expect(lesson.contentMd).toContain('HTTP là giao thức phi trạng thái.');
    expect(lesson.contentMd).not.toContain('JSON Schema');
    expect(lesson.contentMd).not.toContain('Trả về DUY NHẤT');
  });
});
