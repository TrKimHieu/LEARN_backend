import { describe, it, expect } from 'vitest';
import {
  FallbackLlmProvider,
  GeminiLlmProvider,
  MockLlmProvider,
  OpenAiCompatibleLlmProvider,
  RemoteLlmProvider,
} from '@learn/ai';
import { createLlmProvider, estimateCostUsd } from '../llm';
import { env } from '../../environment';

const liveGoogle = {
  ...env,
  LLM_MODE: 'live' as const,
  LLM_PROVIDER: 'google' as const,
  LLM_API_KEY: 'k',
  LLM_MODEL_GENERATION: 'gemini-3.8-flash',
  LLM_MODEL_FALLBACK: '',
};

describe('createLlmProvider — model dự phòng', () => {
  it('uses the remote compute adapter only when explicitly configured', () => {
    expect(
      createLlmProvider({
        ...env,
        COMPUTE_URL: 'http://127.0.0.1:4500',
        COMPUTE_TOKEN: 'test-compute-token-0123456789abcdef',
        COMPUTE_TIMEOUT_MS: 1000,
      }),
    ).toBeInstanceOf(RemoteLlmProvider);
    expect(createLlmProvider({ ...env, COMPUTE_URL: '' })).toBeInstanceOf(MockLlmProvider);
  });
  it('không đặt LLM_MODEL_FALLBACK → dùng thẳng adapter, không bọc', () => {
    expect(createLlmProvider(liveGoogle)).toBeInstanceOf(GeminiLlmProvider);
  });

  it('đặt LLM_MODEL_FALLBACK cùng họ → bọc FallbackLlmProvider, model chính giữ nguyên', () => {
    const llm = createLlmProvider({ ...liveGoogle, LLM_MODEL_FALLBACK: 'gemini-3.1-flash-lite' });
    expect(llm).toBeInstanceOf(FallbackLlmProvider);
    expect(llm.defaultModel).toBe('gemini-3.8-flash');
  });

  it('model dự phòng khác họ nhà cung cấp → chặn ngay lúc khởi động, không đợi tới lúc 503', () => {
    expect(() =>
      createLlmProvider({ ...liveGoogle, LLM_MODEL_FALLBACK: 'claude-haiku-4-5' }),
    ).toThrow(/LLM_MODEL_FALLBACK/);
  });

  it('LLM_PROVIDER=openai → adapter OpenAI, bọc dự phòng được như các provider khác', () => {
    const openai = {
      ...liveGoogle,
      LLM_PROVIDER: 'openai' as const,
      LLM_MODEL_GENERATION: 'gpt-5-nano',
    };
    expect(createLlmProvider(openai)).toBeInstanceOf(OpenAiCompatibleLlmProvider);
    expect(createLlmProvider({ ...openai, LLM_MODEL_FALLBACK: 'gpt-5-mini' })).toBeInstanceOf(
      FallbackLlmProvider,
    );
  });

  it('openai gọi thẳng OpenAI mà model không phải họ gpt- → chặn lúc khởi động', () => {
    expect(() =>
      createLlmProvider({
        ...liveGoogle,
        LLM_PROVIDER: 'openai',
        LLM_MODEL_GENERATION: 'gemini-3.1-flash-lite',
      }),
    ).toThrow(/LLM_MODEL_GENERATION/);
  });

  it('openai qua LLM_BASE_URL (DeepSeek, Groq…) thì tên model tuỳ nhà cung cấp, không chặn', () => {
    const llm = createLlmProvider({
      ...liveGoogle,
      LLM_PROVIDER: 'openai',
      LLM_BASE_URL: 'https://api.deepseek.com/v1',
      LLM_MODEL_GENERATION: 'deepseek-flash',
    });
    expect(llm).toBeInstanceOf(OpenAiCompatibleLlmProvider);
  });

  it('chế độ mock bỏ qua model dự phòng', () => {
    const llm = createLlmProvider({
      ...liveGoogle,
      LLM_MODE: 'mock',
      LLM_MODEL_FALLBACK: 'gemini-3.1-flash-lite',
    });
    expect(llm).toBeInstanceOf(MockLlmProvider);
  });
});

const M = 1_000_000;
/** Chi phí cho đúng 1M input + 1M output = tổng giá input + output mỗi 1M token. */
const perMillion = (model: string, now?: Date) => estimateCostUsd(model, M, M, now);

describe('estimateCostUsd — bảng giá chính thức (đối chiếu 2026-09-27)', () => {
  it('provider mock luôn 0', () => {
    expect(perMillion('mock/lesson')).toBe(0);
  });

  it('Claude theo giá hiện hành: Sonnet 5 $2/$10, Haiku 4.5 $1/$5, Opus 5 $5/$25', () => {
    expect(perMillion('claude-sonnet-5')).toBeCloseTo(12);
    expect(perMillion('claude-haiku-4-5')).toBeCloseTo(6);
    expect(perMillion('claude-opus-5')).toBeCloseTo(30);
  });

  it('ID Claude có hậu tố ngày (API trả về trong res.model) tính như ID gốc', () => {
    expect(perMillion('claude-haiku-4-5-20251001')).toBeCloseTo(6);
  });

  it('OpenAI: gpt-5-nano $0.05/$0.40, gpt-5-mini $0.25/$2, gpt-6-luna $0.10/$0.50', () => {
    expect(perMillion('gpt-5-nano')).toBeCloseTo(0.45);
    expect(perMillion('gpt-5-mini')).toBeCloseTo(2.25);
    expect(perMillion('gpt-6-luna')).toBeCloseTo(0.6);
  });

  it('snapshot OpenAI trong res.model (gpt-5-nano-2025-08-07) tính như ID gốc', () => {
    expect(perMillion('gpt-5-nano-2025-08-07')).toBeCloseTo(0.45);
  });

  it('Gemini 3.x có trong bảng giá', () => {
    expect(perMillion('gemini-3.1-flash-lite')).toBeCloseTo(0.25 + 1.5);
    expect(perMillion('gemini-3.5-flash-lite')).toBeCloseTo(0.3 + 2.5);
    expect(perMillion('gemini-3.5-flash')).toBeCloseTo(1.5 + 9);
    expect(perMillion('gemini-3.1-pro-preview')).toBeCloseTo(2 + 12);
  });

  it('Gemini 3.6/3.7/3.8 Flash: giá khuyến mãi tới hết 2026, sau đó gấp đôi', () => {
    const promo = new Date('2026-12-31T23:59:59Z');
    const after = new Date('2027-01-01T00:00:00Z');
    for (const model of ['gemini-3.6-flash', 'gemini-3.7-flash', 'gemini-3.8-flash']) {
      expect(perMillion(model, promo)).toBeCloseTo(0.75 + 3.75);
      expect(perMillion(model, after)).toBeCloseTo(1.5 + 7.5);
    }
  });

  it('Gemini chưa có trong bảng: ước theo mức đắt nhất đã biết (3.1 Pro) để chặn trần chi phí sớm', () => {
    expect(perMillion('gemini-9-flash-experimental')).toBeCloseTo(2 + 12);
  });
});
