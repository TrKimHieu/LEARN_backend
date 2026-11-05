import { Injectable, Logger } from '@nestjs/common';
import {
  AnthropicLlmProvider,
  FallbackLlmProvider,
  GeminiLlmProvider,
  OpenAiCompatibleLlmProvider,
  gradeShortAnswerPrompt,
  parseShortAnswerGrade,
  type GradeShortAnswerInput,
  type LlmProvider,
} from '@learn/ai';
import { env } from '../../../environment';

/** Đủ chỗ cho reasoning token của model suy luận; JSON trả về rất ngắn. */
const GRADE_MAX_TOKENS = 1024;
/** Lượt nộp đang chờ HTTP, nên phải có giới hạn ngắn hơn timeout của proxy. */
const GRADE_TIMEOUT_MS = 20_000;

const logger = new Logger('ShortAnswerGrader');

type LlmConfig = Pick<
  typeof env,
  | 'LLM_MODE'
  | 'LLM_PROVIDER'
  | 'LLM_API_KEY'
  | 'LLM_MODEL_FAST'
  | 'LLM_MODEL_FALLBACK'
  | 'LLM_BASE_URL'
  | 'LLM_REASONING_EFFORT'
>;

/** Trả null ở mock hoặc khi thiếu key: lúc đó chỉ so khớp đáp án mẫu, không gọi mạng. */
export function createGradingProvider(cfg: LlmConfig): LlmProvider | null {
  if (cfg.LLM_MODE === 'mock' || !cfg.LLM_API_KEY) return null;

  const provider = primaryProvider(cfg);
  if (!cfg.LLM_MODEL_FALLBACK) return provider;
  return new FallbackLlmProvider(provider, cfg.LLM_MODEL_FALLBACK, (err, from, to) =>
    logger.warn(`${from} tạm không dùng được (${err.status}), chuyển sang ${to}. ${err.message}`),
  );
}

function primaryProvider(cfg: LlmConfig): LlmProvider {
  switch (cfg.LLM_PROVIDER) {
    case 'google':
      return new GeminiLlmProvider(cfg.LLM_API_KEY, cfg.LLM_MODEL_FAST);
    case 'openai':
      return new OpenAiCompatibleLlmProvider(cfg.LLM_API_KEY, cfg.LLM_MODEL_FAST, {
        ...(cfg.LLM_BASE_URL ? { baseUrl: cfg.LLM_BASE_URL } : {}),
        ...(cfg.LLM_REASONING_EFFORT ? { reasoningEffort: cfg.LLM_REASONING_EFFORT } : {}),
      });
    case 'anthropic':
      return new AnthropicLlmProvider(cfg.LLM_API_KEY, cfg.LLM_MODEL_FAST);
  }
}

/** Không có provider thì coi là sai, giống cách so khớp cũ. Lỗi model được ném cho tầng gọi. */
export async function gradeWithProvider(
  provider: LlmProvider | null,
  input: GradeShortAnswerInput,
  timeoutMs = GRADE_TIMEOUT_MS,
): Promise<boolean> {
  if (!provider) return false;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Hết thời gian chờ model chấm bài.')), timeoutMs);
  });
  try {
    const result = await Promise.race([
      provider.generate({
        prompt: gradeShortAnswerPrompt(input),
        maxTokens: GRADE_MAX_TOKENS,
        temperature: 0,
      }),
      timeout,
    ]);
    return parseShortAnswerGrade(result.text);
  } finally {
    clearTimeout(timer);
  }
}

@Injectable()
export class ShortAnswerGrader {
  private readonly provider = createGradingProvider(env);

  grade(input: GradeShortAnswerInput): Promise<boolean> {
    return gradeWithProvider(this.provider, input);
  }
}
