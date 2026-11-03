import {
  LlmUnavailableError,
  type LlmGenerateParams,
  type LlmGenerationResult,
  type LlmProvider,
} from './provider';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

/**
 * Rộng hơn Anthropic (4096) có chủ đích: model reasoning (GPT-5…) tính reasoning token chung vào
 * max_completion_tokens. Để thấp thì bài học dài bị cắt, content rỗng kèm finish_reason=length.
 */
const DEFAULT_MAX_TOKENS = 16384;

/** Quá tải/lỗi tạm thời phía server và rate limit — thử lại được, đổi model có thể chữa được. */
const RETRYABLE_STATUS = new Set([429, 500, 502, 503]);

export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high';

interface ChatCompletionBody {
  model?: string;
  choices?: Array<{
    message?: { content?: string | null; refusal?: string | null };
    finish_reason?: string;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string; type?: string; code?: string | null };
}

export interface OpenAiProviderOptions {
  /** Nhà cung cấp tương thích Chat Completions (DeepSeek, Groq, OpenRouter, Ollama…). */
  baseUrl?: string;
  maxTokens?: number;
  /** Chỉ model reasoning hiểu tham số này; để trống thì không gửi (model tự dùng mặc định). */
  reasoningEffort?: ReasoningEffort;
  /** Số lần thử lại khi gặp lỗi tạm thời. Mặc định 2 (tổng 3 lần gọi). */
  maxRetries?: number;
  /** Chờ cơ sở giữa các lần thử, nhân đôi sau mỗi lần. */
  retryDelayMs?: number;
  /** Tiêm fetch giả trong test. */
  fetchImpl?: typeof fetch;
  /** Tiêm hàm chờ trong test để không phải ngủ thật. */
  sleepImpl?: (ms: number) => Promise<void>;
}

/**
 * Adapter chuẩn OpenAI Chat Completions — HANDBOOK §5.3, ADR 010. Gọi thẳng REST bằng fetch, không
 * thêm SDK. Dùng Chat Completions (không phải Responses API) vì đây là chuẩn chung mà DeepSeek,
 * Groq, OpenRouter, Ollama đều hỗ trợ — một adapter dùng được cho tất cả qua `baseUrl`.
 */
export class OpenAiCompatibleLlmProvider implements LlmProvider {
  readonly defaultModel: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly maxTokens: number;
  private readonly reasoningEffort?: ReasoningEffort;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleepImpl: (ms: number) => Promise<void>;

  constructor(apiKey: string, defaultModel: string, options: OpenAiProviderOptions = {}) {
    this.apiKey = apiKey;
    this.defaultModel = defaultModel;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.reasoningEffort = options.reasoningEffort;
    this.maxRetries = options.maxRetries ?? 2;
    this.retryDelayMs = options.retryDelayMs ?? 1000;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.sleepImpl =
      options.sleepImpl ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  }

  async generate(params: LlmGenerateParams): Promise<LlmGenerationResult> {
    const startedAt = Date.now();
    const model = params.model ?? this.defaultModel;
    const maxTokens = params.maxTokens ?? this.maxTokens;

    const body = {
      model,
      messages: [
        ...(params.system ? [{ role: 'system', content: params.system }] : []),
        { role: 'user', content: params.prompt },
      ],
      max_completion_tokens: maxTokens,
      // json_object thay vì json_schema: nhà cung cấp tương thích nào cũng hiểu, còn schema chế độ
      // strict của OpenAI không nhận nguyên JSON Schema sinh từ Zod. Tầng 1 (Zod) vẫn kiểm tra đủ.
      response_format: { type: 'json_object' },
      // Model reasoning (GPT-5, o-series) từ chối temperature khác mặc định → chỉ gửi khi được yêu cầu.
      ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
      ...(this.reasoningEffort ? { reasoning_effort: this.reasoningEffort } : {}),
    };

    const json = await this.post(body);
    const choice = json.choices?.[0];
    const text = (choice?.message?.content ?? '').trim();

    if (!text) {
      if (choice?.message?.refusal) {
        throw new Error(`OpenAI từ chối trả lời: ${choice.message.refusal}`);
      }
      if (choice?.finish_reason === 'length') {
        throw new Error(
          `OpenAI trả rỗng vì chạm max_completion_tokens (${maxTokens}) — reasoning token đã ăn hết hạn mức. Tăng maxTokens hoặc giảm reasoning_effort.`,
        );
      }
      throw new Error(
        `OpenAI không trả nội dung (finish_reason=${choice?.finish_reason ?? 'không rõ'}).`,
      );
    }

    return {
      text,
      inputTokens: json.usage?.prompt_tokens ?? 0,
      // completion_tokens ĐÃ gồm reasoning token (khác Gemini tách thoughtsTokenCount riêng).
      outputTokens: json.usage?.completion_tokens ?? 0,
      latencyMs: Date.now() - startedAt,
      model: json.model ?? model,
    };
  }

  /** POST kèm thử lại cho lỗi tạm thời; lỗi cấu hình và hết tiền ném ngay, không phí lượt. */
  private async post(body: unknown): Promise<ChatCompletionBody> {
    const url = `${this.baseUrl}/chat/completions`;
    let lastError = new Error('OpenAI: không gọi được lần nào');

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const res = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      });

      const raw = await res.text();
      let json: ChatCompletionBody = {};
      try {
        json = raw ? (JSON.parse(raw) as ChatCompletionBody) : {};
      } catch {
        throw new Error(`OpenAI ${res.status} trả về không phải JSON: ${raw.slice(0, 200)}`);
      }

      if (res.ok) return json;

      const code = json.error?.code ?? json.error?.type;
      const message = `OpenAI ${res.status}${code ? ` ${code}` : ''}: ${json.error?.message ?? (raw.slice(0, 200) || 'lỗi không rõ')}`;
      // Hết tiền cũng trả 429 nhưng thử lại hay đổi model trong cùng tài khoản đều vô ích.
      if (!RETRYABLE_STATUS.has(res.status) || code === 'insufficient_quota') {
        throw new Error(message);
      }
      lastError = new LlmUnavailableError(message, res.status);
      if (attempt === this.maxRetries) throw lastError;
      await this.sleepImpl(this.retryDelayMs * 2 ** attempt);
    }

    throw lastError;
  }
}
