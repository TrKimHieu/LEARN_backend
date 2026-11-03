import { Logger } from '@nestjs/common';
import {
  MockLlmProvider,
  RemoteLlmProvider,
  AnthropicLlmProvider,
  GeminiLlmProvider,
  OpenAiCompatibleLlmProvider,
  FallbackLlmProvider,
  loadMockFixtures,
  type LlmProvider,
} from '@learn/ai';
import { env, type Env } from '../environment';

const logger = new Logger('LlmProvider');

/**
 * HANDBOOK §15.4 — LLM_MODE=mock cho dev/CI/E2E khi chưa có LLM_API_KEY; 'live' gọi nhà cung cấp
 * thật theo LLM_PROVIDER (anthropic | google | openai). Có LLM_MODEL_FALLBACK thì bọc thêm lớp
 * chuyển model khi model chính quá tải/hết quota (ADR 009).
 */
export function createLlmProvider(cfg: Env = env): LlmProvider {
  if (cfg.COMPUTE_URL) {
    return new RemoteLlmProvider({
      url: cfg.COMPUTE_URL,
      token: cfg.COMPUTE_TOKEN,
      model: cfg.LLM_MODEL_GENERATION,
      timeoutMs: cfg.COMPUTE_TIMEOUT_MS,
    });
  }
  if (cfg.LLM_MODE === 'mock' || !cfg.LLM_API_KEY) {
    return new MockLlmProvider(1200, loadMockFixtures(cfg.MOCK_FIXTURES_PATH));
  }

  // Sai họ model là lỗi cấu hình im lặng tốn một job mới lộ ra (API trả 404 giữa pipeline) — với
  // model dự phòng còn tệ hơn: chỉ lộ ra đúng lúc model chính đang sập. Chặn ngay lúc dựng provider.
  // openai qua LLM_BASE_URL là nhà cung cấp khác (DeepSeek, Groq…) — tên model tuỳ họ, không chặn.
  const family = modelFamily(cfg);
  for (const key of ['LLM_MODEL_GENERATION', 'LLM_MODEL_FALLBACK'] as const) {
    const model = cfg[key];
    if (family && model && !model.startsWith(family)) {
      throw new Error(
        `LLM_PROVIDER=${cfg.LLM_PROVIDER} nhưng ${key}="${model}" không thuộc họ model "${family}".`,
      );
    }
  }

  let provider: LlmProvider;
  switch (cfg.LLM_PROVIDER) {
    case 'google':
      provider = new GeminiLlmProvider(cfg.LLM_API_KEY, cfg.LLM_MODEL_GENERATION);
      break;
    case 'openai':
      provider = new OpenAiCompatibleLlmProvider(cfg.LLM_API_KEY, cfg.LLM_MODEL_GENERATION, {
        ...(cfg.LLM_BASE_URL ? { baseUrl: cfg.LLM_BASE_URL } : {}),
        ...(cfg.LLM_REASONING_EFFORT ? { reasoningEffort: cfg.LLM_REASONING_EFFORT } : {}),
      });
      break;
    case 'anthropic':
      provider = new AnthropicLlmProvider(cfg.LLM_API_KEY, cfg.LLM_MODEL_GENERATION);
      break;
  }

  if (!cfg.LLM_MODEL_FALLBACK) return provider;
  return new FallbackLlmProvider(provider, cfg.LLM_MODEL_FALLBACK, (err, from, to) =>
    logger.warn(`${from} tạm không dùng được (${err.status}) — chuyển sang ${to}. ${err.message}`),
  );
}

function modelFamily(cfg: Env): string | undefined {
  switch (cfg.LLM_PROVIDER) {
    case 'google':
      return 'gemini';
    case 'anthropic':
      return 'claude';
    case 'openai':
      return cfg.LLM_BASE_URL ? undefined : 'gpt-';
  }
}

interface Rate {
  input: number;
  output: number;
}

/**
 * Giá mỗi 1M token (gói trả phí, không batch) — HANDBOOK §8.5 theo dõi chi phí. Provider mock
 * luôn 0. Đối chiếu 2026-09-27 với platform.claude.com/docs/en/about-claude/pricing,
 * ai.google.dev/gemini-api/docs/pricing và developers.openai.com/api/docs/pricing — giá đổi thì
 * sửa ở đây kèm test.
 */
const COST_PER_MILLION: Record<string, Rate> = {
  'gpt-5-nano': { input: 0.05, output: 0.4 },
  'gpt-5-mini': { input: 0.25, output: 2 },
  'gpt-6-luna': { input: 0.1, output: 0.5 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-haiku-4-5': { input: 1, output: 5 },
  'gemini-3.1-pro-preview': { input: 2, output: 12 },
  'gemini-3.5-flash': { input: 1.5, output: 9 },
  'gemini-3.5-flash-lite': { input: 0.3, output: 2.5 },
  'gemini-3.1-flash-lite': { input: 0.25, output: 1.5 },
  // Họ 2.5 đã khoá với key mới nhưng key cũ vẫn gọi được.
  'gemini-2.5-pro': { input: 1.25, output: 10 },
  'gemini-2.5-flash': { input: 0.3, output: 2.5 },
  'gemini-2.5-flash-lite': { input: 0.1, output: 0.4 },
};

/** Giá khuyến mãi có hạn: trước `until` dùng `promo`, từ `until` trở đi dùng `regular`. */
const PROMO_PER_MILLION: Record<string, { promo: Rate; regular: Rate; until: Date }> = {};
for (const model of ['gemini-3.6-flash', 'gemini-3.7-flash', 'gemini-3.8-flash']) {
  PROMO_PER_MILLION[model] = {
    promo: { input: 0.75, output: 3.75 },
    regular: { input: 1.5, output: 7.5 },
    until: new Date('2027-01-01T00:00:00Z'),
  };
}

/** Model lạ ngoài họ Gemini — mức Sonnet 4.6 cũ. */
const DEFAULT_COST: Rate = { input: 3, output: 15 };
/**
 * Model Gemini chưa có trong bảng — dùng mức đắt nhất đã biết (3.1 Pro). Cố tình ước cao: chặn
 * AI_JOB_MAX_COST_USD sớm an toàn hơn là tiêu quá hạn mức rồi mới biết.
 */
const GEMINI_FALLBACK_COST: Rate = { input: 2, output: 12 };

function rateFor(model: string, now: Date): Rate {
  // `res.model` có thể kèm snapshot: Anthropic `claude-haiku-4-5-20251001`, OpenAI
  // `gpt-5-nano-2025-08-07` — tính như ID gốc.
  const id = model.replace(/-(\d{8}|\d{4}-\d{2}-\d{2})$/, '');
  const promo = PROMO_PER_MILLION[id];
  if (promo) return now < promo.until ? promo.promo : promo.regular;
  return COST_PER_MILLION[id] ?? (id.startsWith('gemini') ? GEMINI_FALLBACK_COST : DEFAULT_COST);
}

export function estimateCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
  now: Date = new Date(),
): number {
  if (model.startsWith('mock/')) return 0;
  const rate = rateFor(model, now);
  return (inputTokens * rate.input + outputTokens * rate.output) / 1_000_000;
}
