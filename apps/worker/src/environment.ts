import { z } from 'zod';

/** Cấu hình worker từ biến môi trường — tập con của HANDBOOK §22.1 mà worker cần. */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  COMPUTE_URL: z.union([z.literal(''), z.string().url()]).default(''),
  COMPUTE_TOKEN: z.string().default(''),
  COMPUTE_TIMEOUT_MS: z.coerce.number().int().min(100).max(900000).default(65000),
  S3_ENDPOINT: z.string().url().default('http://localhost:9000'),
  S3_BUCKET: z.string().default('learn-documents'),
  S3_ACCESS_KEY_ID: z.string().default('minioadmin'),
  S3_SECRET_ACCESS_KEY: z.string().default('minioadmin'),
  S3_REGION: z.string().default('us-east-1'),
  LLM_PROVIDER: z.enum(['anthropic', 'google', 'openai']).default('anthropic'),
  /** Chỉ cho LLM_PROVIDER=openai: endpoint tương thích khác OpenAI (DeepSeek, Groq…). Rỗng = OpenAI. */
  LLM_BASE_URL: z.string().default(''),
  /** Chỉ cho model reasoning qua LLM_PROVIDER=openai (GPT-5…). Rỗng = không gửi, model tự chọn. */
  LLM_REASONING_EFFORT: z.enum(['', 'none', 'minimal', 'low', 'medium', 'high']).default(''),
  LLM_API_KEY: z.string().default(''),
  LLM_MODEL_GENERATION: z.string().default('claude-sonnet-5'),
  LLM_MODEL_FAST: z.string().default('claude-haiku-4-5-20251001'),
  /** Model cùng nhà cung cấp, dùng khi model chính trả 429/503/529 (ADR 009). Rỗng = không dự phòng. */
  LLM_MODEL_FALLBACK: z.string().default(''),
  LLM_MODE: z.enum(['live', 'mock', 'record']).default('mock'),
  /** Đường dẫn file JSON kịch bản sẵn cho MockLlmProvider — xem packages/ai/src/llm/fixtures.ts. */
  MOCK_FIXTURES_PATH: z.string().optional(),
  AI_JOB_MAX_COST_USD: z.coerce.number().default(0.5),
  AI_JOB_TIMEOUT_MS: z.coerce.number().int().default(900000),
  AI_MAX_CONCURRENT_CALLS: z.coerce.number().int().default(3),
  DOCUMENT_MAX_SIZE: z.coerce.number().int().default(26214400),
  UPLOAD_MAX_PAGES: z.coerce.number().int().default(300),
  OCR_MAX_PAGES: z.coerce.number().int().default(50),
  LOG_LEVEL: z.string().default('info'),
});

export type Env = z.infer<typeof envSchema>;

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Cấu hình môi trường worker không hợp lệ', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env: Env = parsed.data;
