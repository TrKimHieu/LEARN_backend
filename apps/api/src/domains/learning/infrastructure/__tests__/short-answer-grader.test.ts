import { describe, it, expect, vi } from 'vitest';
import type { LlmProvider } from '@learn/ai';
import { createGradingProvider, gradeWithProvider } from '../short-answer-grader';

const input = {
  questionPrompt: 'GET dùng để làm gì?',
  modelAnswers: ['Lấy dữ liệu'],
  answer: 'Đọc dữ liệu',
};

const providerReturning = (text: string): LlmProvider => ({
  defaultModel: 'test',
  generate: vi.fn().mockResolvedValue({
    text,
    inputTokens: 1,
    outputTokens: 1,
    latencyMs: 1,
    model: 'test',
  }),
});

const config = {
  LLM_MODE: 'live' as const,
  LLM_PROVIDER: 'openai' as const,
  LLM_API_KEY: 'k',
  LLM_MODEL_FAST: 'gpt-test',
  LLM_MODEL_FALLBACK: '',
  LLM_BASE_URL: '',
  LLM_REASONING_EFFORT: '' as const,
};

describe('createGradingProvider', () => {
  it('mock hoặc thiếu key thì không tạo provider, không gọi mạng', () => {
    expect(createGradingProvider({ ...config, LLM_MODE: 'mock' })).toBeNull();
    expect(createGradingProvider({ ...config, LLM_API_KEY: '' })).toBeNull();
  });

  it('live dùng model nhanh', () => {
    expect(createGradingProvider(config)?.defaultModel).toBe('gpt-test');
  });
});

describe('gradeWithProvider', () => {
  it('không có provider thì tính là sai', async () => {
    await expect(gradeWithProvider(null, input)).resolves.toBe(false);
  });

  it('đọc kết quả model với temperature 0', async () => {
    const provider = providerReturning('{"correct":true}');
    await expect(gradeWithProvider(provider, input)).resolves.toBe(true);
    expect(provider.generate).toHaveBeenCalledWith(expect.objectContaining({ temperature: 0 }));
  });

  it('output hỏng thì ném lỗi, không đoán kết quả', async () => {
    await expect(gradeWithProvider(providerReturning('có lẽ đúng'), input)).rejects.toThrow();
  });

  it('model treo thì hết giờ và ném lỗi', async () => {
    const provider: LlmProvider = {
      defaultModel: 'test',
      generate: () => new Promise(() => undefined),
    };
    await expect(gradeWithProvider(provider, input, 5)).rejects.toThrow(/Hết thời gian/);
  });
});
