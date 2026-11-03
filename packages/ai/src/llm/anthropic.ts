import Anthropic from '@anthropic-ai/sdk';
import {
  LlmUnavailableError,
  type LlmGenerateParams,
  type LlmGenerationResult,
  type LlmProvider,
} from './provider';

/** Hết quota (429), dịch vụ tạm ngừng (503), quá tải (529) — đổi model có thể chữa được. */
const UNAVAILABLE_STATUS = new Set([429, 503, 529]);

/** Adapter Anthropic Claude — HANDBOOK §5.3. Model lấy từ env, không hardcode. */
export class AnthropicLlmProvider implements LlmProvider {
  readonly defaultModel: string;
  private readonly client: Anthropic;
  private readonly maxTokens: number;

  /** `client` chỉ tiêm trong test; SDK tự thử lại 2 lần trước khi ném lỗi. */
  constructor(apiKey: string, defaultModel: string, maxTokens = 4096, client?: Anthropic) {
    this.client = client ?? new Anthropic({ apiKey });
    this.defaultModel = defaultModel;
    this.maxTokens = maxTokens;
  }

  async generate(params: LlmGenerateParams): Promise<LlmGenerationResult> {
    const startedAt = Date.now();
    let res: Anthropic.Message;
    try {
      res = await this.client.messages.create({
        model: params.model ?? this.defaultModel,
        max_tokens: params.maxTokens ?? this.maxTokens,
        system: params.system,
        messages: [{ role: 'user', content: params.prompt }],
        temperature: params.temperature ?? 0.2,
      });
    } catch (err) {
      if (
        err instanceof Anthropic.APIError &&
        err.status !== undefined &&
        UNAVAILABLE_STATUS.has(err.status)
      ) {
        throw new LlmUnavailableError(`Anthropic ${err.status}: ${err.message}`, err.status);
      }
      throw err;
    }

    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n');

    return {
      text,
      inputTokens: res.usage.input_tokens,
      outputTokens: res.usage.output_tokens,
      latencyMs: Date.now() - startedAt,
      model: res.model,
    };
  }
}
