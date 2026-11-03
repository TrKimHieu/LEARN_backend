import { describe, it, expect } from 'vitest';
import { OpenAiCompatibleLlmProvider } from '../llm/openai';
import { LlmUnavailableError } from '../llm/provider';

type FetchCall = { url: string; init: RequestInit };

/** fetch giả theo kịch bản: mỗi lần gọi lấy response kế tiếp — không chạm mạng. */
function scriptedFetch(responses: Array<{ status: number; body: unknown }>) {
  const calls: FetchCall[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses.shift();
    if (!next) throw new Error('gọi quá số lần dự kiến');
    return new Response(JSON.stringify(next.body), { status: next.status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

/** Hình dạng response Chat Completions thật (rút gọn) của gpt-5-nano. */
function okBody(overrides: Record<string, unknown> = {}) {
  return {
    model: 'gpt-5-nano-2025-08-07',
    choices: [{ message: { role: 'assistant', content: '{"ok":true}' }, finish_reason: 'stop' }],
    usage: {
      prompt_tokens: 120,
      completion_tokens: 900,
      completion_tokens_details: { reasoning_tokens: 850 },
    },
    ...overrides,
  };
}

const noSleep = async () => {};
const bodyOf = (call: FetchCall | undefined) => {
  if (!call) throw new Error('fetch không được gọi');
  return JSON.parse(String(call.init.body)) as Record<string, unknown>;
};

describe('OpenAiCompatibleLlmProvider', () => {
  it('gọi /chat/completions, key ở header Authorization, không bao giờ ở URL', async () => {
    const { impl, calls } = scriptedFetch([{ status: 200, body: okBody() }]);
    const provider = new OpenAiCompatibleLlmProvider('sk-secret', 'gpt-5-nano', {
      fetchImpl: impl,
    });

    await provider.generate({ prompt: 'x' });

    const call = calls[0];
    expect(call?.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(call?.url).not.toContain('sk-secret');
    expect((call?.init.headers as Record<string, string>)['authorization']).toBe(
      'Bearer sk-secret',
    );
  });

  it('dùng baseUrl riêng cho nhà cung cấp tương thích (DeepSeek, Groq, OpenRouter…)', async () => {
    const { impl, calls } = scriptedFetch([{ status: 200, body: okBody() }]);
    const provider = new OpenAiCompatibleLlmProvider('k', 'deepseek-flash', {
      baseUrl: 'https://api.deepseek.com/v1/',
      fetchImpl: impl,
    });

    await provider.generate({ prompt: 'x' });

    expect(calls[0]?.url).toBe('https://api.deepseek.com/v1/chat/completions');
  });

  it('body: system + user, max_completion_tokens (tính cả reasoning), ép JSON', async () => {
    const { impl, calls } = scriptedFetch([{ status: 200, body: okBody() }]);
    const provider = new OpenAiCompatibleLlmProvider('k', 'gpt-5-nano', { fetchImpl: impl });

    await provider.generate({ prompt: 'sinh bài học', system: 'bạn là trợ lý', maxTokens: 2048 });

    expect(bodyOf(calls[0])).toMatchObject({
      model: 'gpt-5-nano',
      messages: [
        { role: 'system', content: 'bạn là trợ lý' },
        { role: 'user', content: 'sinh bài học' },
      ],
      max_completion_tokens: 2048,
      response_format: { type: 'json_object' },
    });
    expect(bodyOf(calls[0])).not.toHaveProperty('max_tokens');
  });

  it('không gửi temperature khi lời gọi không chỉ định — model reasoning từ chối giá trị khác mặc định', async () => {
    const { impl, calls } = scriptedFetch([{ status: 200, body: okBody() }]);
    const provider = new OpenAiCompatibleLlmProvider('k', 'gpt-5-nano', { fetchImpl: impl });

    await provider.generate({ prompt: 'x' });

    expect(bodyOf(calls[0])).not.toHaveProperty('temperature');
  });

  it('gửi reasoning_effort khi được cấu hình, không gửi khi không cấu hình', async () => {
    const withEffort = scriptedFetch([{ status: 200, body: okBody() }]);
    await new OpenAiCompatibleLlmProvider('k', 'gpt-5-nano', {
      fetchImpl: withEffort.impl,
      reasoningEffort: 'low',
    }).generate({ prompt: 'x' });
    expect(bodyOf(withEffort.calls[0])).toMatchObject({ reasoning_effort: 'low' });

    const without = scriptedFetch([{ status: 200, body: okBody() }]);
    await new OpenAiCompatibleLlmProvider('k', 'gpt-5-nano', {
      fetchImpl: without.impl,
    }).generate({ prompt: 'x' });
    expect(bodyOf(without.calls[0])).not.toHaveProperty('reasoning_effort');
  });

  it('trả text + token; completion_tokens đã gồm reasoning nên không cộng lại lần nữa', async () => {
    const { impl } = scriptedFetch([{ status: 200, body: okBody() }]);
    const provider = new OpenAiCompatibleLlmProvider('k', 'gpt-5-nano', { fetchImpl: impl });

    const res = await provider.generate({ prompt: 'x' });

    expect(res).toMatchObject({
      text: '{"ok":true}',
      inputTokens: 120,
      outputTokens: 900,
      model: 'gpt-5-nano-2025-08-07',
    });
  });

  it('nội dung rỗng vì chạm max_completion_tokens → nói rõ reasoning đã ăn hết hạn mức', async () => {
    const { impl } = scriptedFetch([
      {
        status: 200,
        body: okBody({
          choices: [{ message: { role: 'assistant', content: '' }, finish_reason: 'length' }],
        }),
      },
    ]);
    const provider = new OpenAiCompatibleLlmProvider('k', 'gpt-5-nano', { fetchImpl: impl });

    await expect(provider.generate({ prompt: 'x', maxTokens: 64 })).rejects.toThrow(
      /max_completion_tokens \(64\)/,
    );
  });

  it('model từ chối trả lời (refusal) → ném lỗi kèm lý do', async () => {
    const { impl } = scriptedFetch([
      {
        status: 200,
        body: okBody({
          choices: [
            {
              message: { role: 'assistant', content: null, refusal: 'Không thể hỗ trợ.' },
              finish_reason: 'stop',
            },
          ],
        }),
      },
    ]);
    const provider = new OpenAiCompatibleLlmProvider('k', 'gpt-5-nano', { fetchImpl: impl });

    await expect(provider.generate({ prompt: 'x' })).rejects.toThrow(/Không thể hỗ trợ/);
  });

  it('503 thì thử lại rồi thành công', async () => {
    const { impl, calls } = scriptedFetch([
      { status: 503, body: { error: { message: 'overloaded', type: 'server_error' } } },
      { status: 200, body: okBody() },
    ]);
    const provider = new OpenAiCompatibleLlmProvider('k', 'gpt-5-nano', {
      fetchImpl: impl,
      sleepImpl: noSleep,
    });

    const res = await provider.generate({ prompt: 'x' });

    expect(res.text).toBe('{"ok":true}');
    expect(calls).toHaveLength(2);
  });

  it('hết lượt thử lại vì 429 rate limit → LlmUnavailableError để chuyển model dự phòng', async () => {
    const rateLimited = {
      status: 429,
      body: {
        error: { message: 'Rate limit reached', type: 'requests', code: 'rate_limit_exceeded' },
      },
    };
    const { impl, calls } = scriptedFetch([rateLimited, rateLimited, rateLimited]);
    const provider = new OpenAiCompatibleLlmProvider('k', 'gpt-5-nano', {
      fetchImpl: impl,
      sleepImpl: noSleep,
    });

    const err = await provider.generate({ prompt: 'x' }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(LlmUnavailableError);
    expect((err as LlmUnavailableError).status).toBe(429);
    expect(calls).toHaveLength(3);
  });

  it('429 insufficient_quota (hết tiền) → không thử lại, không chuyển model, báo rõ phải nạp tiền', async () => {
    const { impl, calls } = scriptedFetch([
      {
        status: 429,
        body: {
          error: {
            message: 'You exceeded your current quota',
            type: 'insufficient_quota',
            code: 'insufficient_quota',
          },
        },
      },
    ]);
    const provider = new OpenAiCompatibleLlmProvider('k', 'gpt-5-nano', {
      fetchImpl: impl,
      sleepImpl: noSleep,
    });

    const err = await provider.generate({ prompt: 'x' }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(LlmUnavailableError);
    expect((err as Error).message).toMatch(/insufficient_quota/);
    expect(calls).toHaveLength(1);
  });

  it('lỗi cấu hình (401 sai key) ném ngay, không thử lại', async () => {
    const { impl, calls } = scriptedFetch([
      { status: 401, body: { error: { message: 'Incorrect API key', code: 'invalid_api_key' } } },
    ]);
    const provider = new OpenAiCompatibleLlmProvider('k', 'gpt-5-nano', {
      fetchImpl: impl,
      sleepImpl: noSleep,
    });

    const err = await provider.generate({ prompt: 'x' }).catch((e: unknown) => e);

    expect(err).not.toBeInstanceOf(LlmUnavailableError);
    expect((err as Error).message).toMatch(/401/);
    expect(calls).toHaveLength(1);
  });
});
