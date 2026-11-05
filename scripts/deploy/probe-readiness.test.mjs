import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { checkApiReadiness } from './probe-readiness.mjs';

test('public readiness rejects HTTP 200 with degraded dependencies', async () => {
  const request = async () => Response.json({ status: 'degraded', checks: { database: 'down' } });
  assert.equal(await checkApiReadiness('https://staging.example.com', request), false);
});

test('public readiness accepts ready JSON and rejects invalid or failed responses', async () => {
  for (const [response, expected] of [
    [Response.json({ status: 'ready' }), true],
    [new Response('upstream error', { status: 503 }), false],
    [new Response('<html>login</html>'), false],
  ]) {
    assert.equal(
      await checkApiReadiness('https://staging.example.com', async () => response),
      expected,
    );
  }
  assert.equal(
    await checkApiReadiness('https://staging.example.com', async () => {
      throw Error('network');
    }),
    false,
  );
});

test('the actual host API probe rejects degraded JSON instead of accepting HTTP 200', async () => {
  const script = readFileSync(new URL('../../infra/aws/learn-release.sh', import.meta.url), 'utf8');
  const expression = script
    .match(/"(fetch\('[\s\S]*?)"; then/)[1]
    .replaceAll('${probe}', 'http://127.0.0.1:4000/api/v1/health/ready')
    .replaceAll('${service}', 'api');
  for (const [status, expected] of [
    ['ready', 0],
    ['degraded', 1],
  ]) {
    const exits = [];
    await runInNewContext(expression, {
      fetch: async () => Response.json({ status }),
      process: { exit: (code) => exits.push(code) },
    });
    assert.deepEqual(exits, [expected]);
  }
});
