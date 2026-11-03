import { z } from 'zod';
import {
  createComputeServer,
  MockLlmProvider,
  AnthropicLlmProvider,
  GeminiLlmProvider,
  OpenAiCompatibleLlmProvider,
} from '@learn/ai';
import type { LlmProvider } from '@learn/ai';

const env = z
  .object({
    COMPUTE_TOKEN: z.string().min(32),
    PORT: z.coerce.number().int().min(1).max(65535).default(4500),
    HOST: z.string().default('0.0.0.0'),
    COMPUTE_TIMEOUT_MS: z.coerce.number().int().min(100).max(900000).default(60000),
    LLM_MODE: z.enum(['mock', 'live']).default('mock'),
    LLM_PROVIDER: z.enum(['anthropic', 'google', 'openai']).default('anthropic'),
    LLM_MODEL_GENERATION: z.string().default('mock/1200'),
    LLM_API_KEY: z.string().default(''),
  })
  .parse(process.env);
let provider: LlmProvider = new MockLlmProvider(1200);
if (env.LLM_MODE === 'live') {
  if (!env.LLM_API_KEY || env.LLM_MODEL_GENERATION.startsWith('mock/'))
    throw Error('Live compute requires an API key and live model');
  if (env.LLM_PROVIDER === 'anthropic')
    provider = new AnthropicLlmProvider(env.LLM_API_KEY, env.LLM_MODEL_GENERATION);
  if (env.LLM_PROVIDER === 'google')
    provider = new GeminiLlmProvider(env.LLM_API_KEY, env.LLM_MODEL_GENERATION);
  if (env.LLM_PROVIDER === 'openai')
    provider = new OpenAiCompatibleLlmProvider(env.LLM_API_KEY, env.LLM_MODEL_GENERATION);
}
const server = createComputeServer(provider, {
  token: env.COMPUTE_TOKEN,
  timeoutMs: env.COMPUTE_TIMEOUT_MS,
});
server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.listen(env.PORT, env.HOST, () =>
  console.log(JSON.stringify({ status: 'ready', protocol: 1, mode: env.LLM_MODE })),
);
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => {
      server.closeAllConnections();
      process.exit(0);
    }, 65000).unref();
  });
