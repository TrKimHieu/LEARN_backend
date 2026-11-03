import { describe, it, expect } from 'vitest';
import Anthropic, { type ClientOptions } from '@anthropic-ai/sdk';
import { AnthropicLlmProvider } from '../llm/anthropic';
import { LlmUnavailableError } from '../llm/provider';

/** Client SDK thật, chỉ thay tầng fetch để trả lỗi dựng sẵn — không chạm mạng, không tự thử lại. */
function clientReturning(status: number, body: unknown): Anthropic {
  const fakeFetch = async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  return new Anthropic({
    apiKey: 'k',
    maxRetries: 0,
    fetch: fakeFetch as unknown as NonNullable<ClientOptions['fetch']>,
  });
}

describe('AnthropicLlmProvider — phân loại lỗi', () => {
  it.each([
    [529, 'overloaded_error'],
    [429, 'rate_limit_error'],
    [503, 'api_error'],
  ])('HTTP %i → LlmUnavailableError để chuyển sang model dự phòng', async (status, type) => {
    const client = clientReturning(status, { type: 'error', error: { type, message: 'bận' } });
    const provider = new AnthropicLlmProvider('k', 'claude-sonnet-5', 4096, client);

    const err = await provider.generate({ prompt: 'x' }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(LlmUnavailableError);
    expect((err as LlmUnavailableError).status).toBe(status);
  });

  it('lỗi cấu hình (404 sai tên model) ném nguyên, không phải LlmUnavailableError', async () => {
    const client = clientReturning(404, {
      type: 'error',
      error: { type: 'not_found_error', message: 'model: claude-xyz' },
    });
    const provider = new AnthropicLlmProvider('k', 'claude-xyz', 4096, client);

    const err = await provider.generate({ prompt: 'x' }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Anthropic.NotFoundError);
    expect(err).not.toBeInstanceOf(LlmUnavailableError);
  });
});
