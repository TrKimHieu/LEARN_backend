import { spawn, spawnSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';

const root = resolve(import.meta.dirname, '../..');
mkdirSync(join(root, '.local'), { recursive: true });
mkdirSync(join(root, 'artifacts'), { recursive: true });
const portBusy = await new Promise((resolve) => {
  const socket = createConnection({ host: '127.0.0.1', port: 4500 });
  socket.on('connect', () => {
    socket.destroy();
    resolve(true);
  });
  socket.on('error', () => resolve(false));
});
if (portBusy) throw Error('Pilot port 4500 is in use; refusing to reuse unknown compute');
const token = randomBytes(32).toString('hex');
const output = openSync(join(root, '.local/pilot-comparison.log'), 'a');
let compute;
const runs = [];
try {
  for (const mode of ['local', 'remote']) {
    if (mode === 'remote') {
      compute = spawn(process.execPath, ['apps/compute/dist/main.js'], {
        cwd: root,
        env: {
          PATH: process.env.PATH,
          SystemRoot: process.env.SystemRoot,
          NODE_ENV: 'test',
          HOST: '127.0.0.1',
          PORT: '4500',
          COMPUTE_TOKEN: token,
          LLM_MODE: 'mock',
        },
        stdio: ['ignore', output, output],
      });
      let ready = false;
      for (let i = 0; i < 40; i++) {
        if (compute.exitCode !== null) throw Error('Pilot compute exited');
        try {
          ready = (await fetch('http://127.0.0.1:4500/health/ready')).ok;
        } catch {}
        if (ready) break;
        await new Promise((r) => setTimeout(r, 250));
      }
      if (!ready) throw Error('Pilot compute not ready');
    }
    const started = performance.now();
    const result = spawnSync(process.execPath, ['scripts/sandbox/verify.mjs'], {
      cwd: root,
      env: {
        ...process.env,
        COMPUTE_URL: mode === 'remote' ? 'http://127.0.0.1:4500' : '',
        COMPUTE_TOKEN: mode === 'remote' ? token : '',
        LEARN_SANDBOX_COMPUTE: mode === 'remote' ? '1' : '0',
      },
      stdio: ['ignore', output, output],
    });
    runs.push({
      mode,
      passed: result.status === 0,
      elapsedMs: Math.round(performance.now() - started),
    });
    console.log(JSON.stringify(runs.at(-1)));
    if (result.status !== 0) throw Error('Pilot comparison failed; inspect private log');
  }
  writeFileSync(
    join(root, 'artifacts/m4-pilot.json'),
    JSON.stringify(
      {
        environment: 'local isolated PostgreSQL/Redis/MinIO; LLM mock',
        workload:
          '16 auth/quota integration tests plus shared upload/extract/generate/submit/progress workflow per mode',
        runs,
        cloudAccepted: false,
        limitation:
          'One sequential smoke run per mode; elapsed time includes startup/tests, not production latency or capacity baseline. Cloud rollback, replay across instances and scale still require staging. Cache idempotency is in-memory per process for five minutes, not durable.',
      },
      null,
      2,
    ) + '\n',
  );
} finally {
  compute?.kill('SIGTERM');
  closeSync(output);
}
