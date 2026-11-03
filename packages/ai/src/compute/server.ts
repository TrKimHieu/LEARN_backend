import { createServer } from 'node:http';
import type { ServerResponse } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { LlmProvider } from '../llm/provider';
import { computeRequest, computeResult } from './protocol';

interface Options {
  token: string;
  timeoutMs?: number;
  maxConcurrent?: number;
  maxEntries?: number;
  cacheTtlMs?: number;
}
interface Outcome {
  status: number;
  value: unknown;
}
interface Entry {
  hash: string;
  expires: number;
  settled: boolean;
  value: Promise<Outcome>;
}
const digest = (value: string) => createHash('sha256').update(value).digest();

/** Stateless pilot: no database, queue, user credentials or persistence rights. */
export function createComputeServer(provider: LlmProvider, options: Options) {
  if (options.token.length < 32) throw Error('Compute token must contain at least 32 characters');
  const cache = new Map<string, Entry>();
  let active = 0;
  const timeoutMs = options.timeoutMs ?? 60000;
  const respond = (res: ServerResponse, status: number, value: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(value));
  };
  return createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/health/ready') {
      respond(res, 200, { status: 'ready', protocol: 1 });
      return;
    }
    if (
      !timingSafeEqual(digest(req.headers.authorization ?? ''), digest(`Bearer ${options.token}`))
    ) {
      respond(res, 401, { code: 'UNAUTHORIZED' });
      req.resume();
      return;
    }
    if (req.method !== 'POST' || req.url !== '/v1/generate') {
      respond(res, 404, { code: 'NOT_FOUND' });
      req.resume();
      return;
    }
    const key = req.headers['idempotency-key'];
    if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(key)) {
      respond(res, 400, { code: 'INVALID_KEY' });
      req.resume();
      return;
    }
    try {
      let size = 0;
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 160000) {
          respond(res, 413, { code: 'PAYLOAD_TOO_LARGE' });
          return;
        }
        chunks.push(Buffer.from(chunk));
      }
      let parsed;
      try {
        parsed = computeRequest.safeParse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        respond(res, 400, { code: 'INVALID_REQUEST' });
        return;
      }
      if (!parsed.success) {
        respond(res, 400, { code: 'INVALID_REQUEST' });
        return;
      }
      const now = Date.now();
      for (const [id, entry] of cache) if (entry.settled && entry.expires < now) cache.delete(id);
      const hash = digest(JSON.stringify(parsed.data)).toString('hex');
      let entry = cache.get(key);
      if (entry && entry.hash !== hash) {
        respond(res, 409, { code: 'KEY_CONFLICT' });
        return;
      }
      if (!entry) {
        if (active >= (options.maxConcurrent ?? 4) || cache.size >= (options.maxEntries ?? 128)) {
          respond(res, 503, { code: 'COMPUTE_BUSY' });
          return;
        }
        active++;
        // Keep a timed-out provider counted until it actually settles. It cannot write core data.
        const operation = Promise.resolve()
          .then(() => provider.generate(parsed.data.params))
          .then((result): Outcome => {
            const output = computeResult.safeParse({ version: 1, result });
            return output.success
              ? { status: 200, value: output.data }
              : { status: 502, value: { code: 'INVALID_OUTPUT' } };
          })
          .catch((): Outcome => ({ status: 502, value: { code: 'PROVIDER_FAILED' } }))
          .finally(() => {
            active--;
          });
        let timer: ReturnType<typeof setTimeout>;
        const deadline = new Promise<Outcome>((resolve) => {
          timer = setTimeout(
            () => resolve({ status: 504, value: { code: 'COMPUTE_TIMEOUT' } }),
            timeoutMs,
          );
        });
        const value = Promise.race([operation, deadline]).finally(() => clearTimeout(timer));
        entry = { hash, value, settled: false, expires: now + (options.cacheTtlMs ?? 300000) };
        const tracked = entry;
        value.then(() => {
          tracked.settled = true;
        });
        cache.set(key, entry);
      }
      const outcome = await entry.value;
      respond(res, outcome.status, outcome.value);
    } catch {
      if (!res.headersSent && !res.destroyed) respond(res, 400, { code: 'INVALID_REQUEST' });
    }
  });
}
