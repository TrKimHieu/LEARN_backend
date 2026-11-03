import { spawn, spawnSync } from 'node:child_process';
import { createConnection } from 'node:net';
import { mkdirSync, openSync, closeSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { sandboxEnv } from './config.mjs';
import { S3Client, CreateBucketCommand } from '@aws-sdk/client-s3';
import Redis from 'ioredis';

const root = resolve(import.meta.dirname, '../..');
const env = sandboxEnv();
const ports = [15432, 16379, 19000];
async function listening(port) {
  return new Promise((done) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const finish = (ok) => {
      socket.destroy();
      done(ok);
    };
    socket.setTimeout(1500, () => finish(false));
    socket.on('connect', () => finish(true));
    socket.on('error', () => finish(false));
  });
}
const available = await Promise.all(ports.map(listening));
if (available.some((ok) => !ok)) {
  console.error(
    `M1 integration NOT RUN: isolated services unavailable on ports ${ports.filter((_, i) => !available[i]).join(', ')}. Run npm run sandbox:up; existing databases are never used.`,
  );
  process.exit(2);
}
if (await listening(4400)) {
  console.error(
    'M1 integration NOT RUN: port 4400 already in use; refusing to reuse an unknown API.',
  );
  process.exit(2);
}
mkdirSync(join(root, '.local'), { recursive: true });
const log = openSync(join(root, '.local/sandbox.log'), 'a');
const children = [];
async function resetSandboxRateWindows() {
  // Only test-origin rate windows; preserve job queues, fixtures and application data.
  const redis = new Redis(env.REDIS_URL);
  try {
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', 'rl:*', 'COUNT', 100);
      cursor = next;
      if (keys.length) await redis.del(...keys);
    } while (cursor !== '0');
  } finally {
    await redis.quit();
  }
}
try {
  await resetSandboxRateWindows();
  // Create only the fixed isolated test bucket; no CLI image or existing storage is used.
  const storage = new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    forcePathStyle: true,
    credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
  });
  try {
    await storage.send(new CreateBucketCommand({ Bucket: env.S3_BUCKET }));
  } catch (error) {
    if (!['BucketAlreadyExists', 'BucketAlreadyOwnedByYou'].includes(error.name)) throw error;
  } finally {
    storage.destroy();
  }
  for (const args of [
    [
      'node_modules/prisma/build/index.js',
      'migrate',
      'deploy',
      '--schema',
      'packages/db/prisma/schema.prisma',
    ],
    ['node_modules/tsx/dist/cli.mjs', 'packages/db/prisma/seed.ts'],
  ]) {
    const result = spawnSync(process.execPath, args, {
      cwd: root,
      env,
      stdio: ['ignore', log, log],
    });
    if (result.status !== 0)
      throw new Error('Sandbox setup failed; inspect private .local/sandbox.log');
  }
  for (const file of ['apps/api/dist/main.js', 'apps/worker/dist/main.js']) {
    children.push(spawn(process.execPath, [file], { cwd: root, env, stdio: ['ignore', log, log] }));
  }
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (children.some((p) => p.exitCode !== null))
      throw new Error('Sandbox process exited before readiness');
    try {
      const response = await fetch('http://127.0.0.1:4400/api/v1/health/ready', {
        signal: AbortSignal.timeout(1000),
      });
      ready = (await response.json()).status === 'ready';
    } catch {
      /* waiting for the isolated API */
    }
    if (ready) break;
    await new Promise((done) => setTimeout(done, 1000));
  }
  if (!ready) throw new Error('Sandbox readiness timed out');
  const integration = spawnSync(
    process.execPath,
    ['node_modules/vitest/vitest.mjs', 'run', '--config', 'vitest.int.config.ts'],
    { cwd: root, env, stdio: 'inherit' },
  );
  if (integration.status !== 0) throw new Error('Isolated auth/quota integration suites failed');
  await resetSandboxRateWindows();
  const result = spawnSync(process.execPath, ['scripts/sandbox/workflow.mjs'], {
    cwd: root,
    env,
    stdio: 'inherit',
  });
  process.exitCode = result.status ?? 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  for (const child of children) child.kill('SIGTERM');
  closeSync(log);
}
