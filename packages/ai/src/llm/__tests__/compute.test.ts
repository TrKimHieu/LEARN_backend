import { afterEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { createComputeServer } from '../../compute/server';
import { RemoteLlmProvider } from '../remote';
import type { LlmProvider } from '../provider';

const token = 'test-compute-token-0123456789abcdef';
const result = {
  text: '{"ok":true}',
  model: 'mock/1200',
  inputTokens: 1,
  outputTokens: 2,
  latencyMs: 1,
};
const servers: Server[] = [];
async function start(provider: LlmProvider, options = {}) {
  const server = createComputeServer(provider, { token, ...options });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('No port');
  return `http://127.0.0.1:${address.port}`;
}
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
const headers = {
  authorization: `Bearer ${token}`,
  'content-type': 'application/json',
  'idempotency-key': 'request-0001',
};
const body = JSON.stringify({ version: 1, params: { prompt: 'hello' } });
describe('stateless compute HTTP interface v1', () => {
  it('deduplicates concurrent requests; conflicting payload cannot reuse the key', async () => {
    let calls = 0;
    const url = await start({
      defaultModel: 'mock/1200',
      async generate() {
        calls++;
        await new Promise((r) => setTimeout(r, 30));
        return result;
      },
    });
    const responses = await Promise.all(
      [1, 2].map(() => fetch(url + '/v1/generate', { method: 'POST', headers, body })),
    );
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    expect(await responses[0]!.json()).toEqual({ version: 1, result });
    expect(calls).toBe(1);
    const conflict = await fetch(url + '/v1/generate', {
      method: 'POST',
      headers,
      body: JSON.stringify({ version: 1, params: { prompt: 'different' } }),
    });
    expect(conflict.status).toBe(409);
    expect(calls).toBe(1);
  });
  it('rejects unauthenticated, malformed and oversized requests before provider execution', async () => {
    let calls = 0;
    const url = await start({
      defaultModel: 'mock/1200',
      async generate() {
        calls++;
        return result;
      },
    });
    expect((await fetch(url + '/v1/generate', { method: 'POST', body })).status).toBe(401);
    expect((await fetch(url + '/v1/generate', { method: 'POST', headers, body: '{' })).status).toBe(
      400,
    );
    expect(
      (await fetch(url + '/v1/generate', { method: 'POST', headers, body: 'x'.repeat(170000) }))
        .status,
    ).toBe(413);
    expect(calls).toBe(0);
  });
  it('times out once, keeps the timeout cached and caps concurrent provider calls', async () => {
    let calls = 0;
    const url = await start(
      {
        defaultModel: 'mock/1200',
        async generate() {
          calls++;
          await new Promise((r) => setTimeout(r, 100));
          return result;
        },
      },
      { timeoutMs: 10, maxConcurrent: 1 },
    );
    const one = await fetch(url + '/v1/generate', { method: 'POST', headers, body });
    expect(one.status).toBe(504);
    const replay = await fetch(url + '/v1/generate', { method: 'POST', headers, body });
    expect(replay.status).toBe(504);
    const busy = await fetch(url + '/v1/generate', {
      method: 'POST',
      headers: { ...headers, 'idempotency-key': 'request-0002' },
      body,
    });
    expect(busy.status).toBe(503);
    expect(calls).toBe(1);
  });
  it('remote adapter validates results and sends authenticated versioned requests', async () => {
    const url = await start({
      defaultModel: 'mock/1200',
      async generate() {
        return result;
      },
    });
    const remote = new RemoteLlmProvider({ url, token, model: 'mock/1200', timeoutMs: 1000 });
    expect(await remote.generate({ prompt: 'hello' })).toEqual(result);
  });
  it('fails closed when dependency output is invalid or credentials are missing', async () => {
    expect(
      () =>
        new RemoteLlmProvider({
          url: 'http://localhost:4500',
          token: '',
          model: 'mock/1200',
          timeoutMs: 1000,
        }),
    ).toThrow();
    const url = await start({
      defaultModel: 'mock/1200',
      async generate() {
        return { ...result, text: undefined } as unknown as typeof result;
      },
    });
    const response = await fetch(url + '/v1/generate', { method: 'POST', headers, body });
    expect(response.status).toBe(502);
  });
});
