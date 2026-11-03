import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';

test('sandbox never inherits a production database or live LLM credentials', async () => {
  assert.ok(
    existsSync(new URL('./config.mjs', import.meta.url)),
    'isolated sandbox configuration is missing',
  );
  const { sandboxEnv } = await import('./config.mjs');
  const env = sandboxEnv({
    DATABASE_URL: 'postgresql://production.invalid/live',
    REDIS_URL: 'redis://production.invalid',
    NODE_ENV: 'production',
    LLM_MODE: 'live',
    LLM_API_KEY: 'fixture-not-a-real-key',
    SMTP_URL: 'smtp://production.invalid',
    S3_ENDPOINT: 'https://production.invalid',
  });
  assert.equal(env.NODE_ENV, 'test');
  assert.equal(new URL(env.DATABASE_URL).hostname, '127.0.0.1');
  assert.equal(new URL(env.DATABASE_URL).pathname, '/learn_m1');
  assert.equal(new URL(env.REDIS_URL).port, '16379');
  assert.equal(env.LLM_MODE, 'mock');
  assert.equal(env.LLM_API_KEY, '');
  assert.equal(env.SMTP_URL, '');
  assert.equal(env.HOST, '127.0.0.1');
});
