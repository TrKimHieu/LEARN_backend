import { randomUUID } from 'node:crypto';
import type { LlmGenerateParams, LlmGenerationResult, LlmProvider } from './provider';
import { computeResult } from '../compute/protocol';

interface RemoteOptions {
  url: string;
  token: string;
  model: string;
  timeoutMs: number;
}
export class RemoteLlmProvider implements LlmProvider {
  readonly defaultModel: string;
  constructor(private readonly options: RemoteOptions) {
    const url = new URL(options.url);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      options.token.length < 32 ||
      options.timeoutMs <= 0
    )
      throw Error('Invalid compute configuration');
    this.defaultModel = options.model;
  }
  async generate(params: LlmGenerateParams): Promise<LlmGenerationResult> {
    const key = randomUUID();
    const deadline = Date.now() + this.options.timeoutMs;
    for (let attempt = 0; attempt < 2; attempt++) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw Error('Compute deadline exceeded');
      const response = await fetch(new URL('/v1/generate', this.options.url), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.options.token}`,
          'content-type': 'application/json',
          'idempotency-key': key,
        },
        body: JSON.stringify({ version: 1, params }),
        signal: AbortSignal.timeout(remaining),
      });
      if (response.status === 503 && attempt === 0) {
        await response.body?.cancel();
        await new Promise((r) => setTimeout(r, 25));
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw Error(`Compute dependency failed (${response.status})`);
      }
      const declaredSize = Number(response.headers.get('content-length') ?? 0);
      if (declaredSize > 600000) {
        await response.body?.cancel();
        throw Error('Compute output too large');
      }
      const reader = response.body?.getReader();
      if (!reader) throw Error('Empty compute response');
      const parts: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.length;
        if (size > 600000) {
          await reader.cancel();
          throw Error('Compute output too large');
        }
        parts.push(next.value);
      }
      return computeResult.parse(JSON.parse(Buffer.concat(parts).toString('utf8'))).result;
    }
    throw Error('Compute unavailable');
  }
}
