import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const version = process.argv.includes('--version')
  ? process.argv[process.argv.indexOf('--version') + 1]
  : '1.1.0';
const release = join(root, 'artifacts/api-contracts', version);
const sdk = join(release, `learn-api-contracts-${version}.tgz`);
const cache = join(root, '.local/npm-cache');
const tools = join(root, '.local/consumer-peer');
mkdirSync(tools, { recursive: true });
const npm =
  process.env.npm_execpath ?? join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
const run = (args, cwd) =>
  execFileSync(process.execPath, [npm, ...args, '--cache', cache], {
    cwd,
    stdio: 'pipe',
  }).toString();
// An ordinary registry library is packed locally only because this environment cannot fetch it.
// The consumer receives the public SDK tarball and its declared peer, never backend workspace source.
const packed = run(
  [
    'pack',
    join(root, 'node_modules/zod'),
    '--pack-destination',
    tools,
    '--ignore-scripts',
    '--json',
  ],
  root,
);
const peer = join(tools, JSON.parse(packed)[0].filename);
const consumer = mkdtempSync(join(tmpdir(), 'learn-consumer-'));
writeFileSync(
  join(consumer, 'package.json'),
  JSON.stringify({ name: 'isolated-learn-consumer', private: true }),
);
run(['install', sdk, peer, '--offline', '--ignore-scripts', '--no-audit', '--no-fund'], consumer);
execFileSync(
  process.execPath,
  [
    '-e',
    `const assert=require('node:assert/strict');const path=require('node:path');const resolved=require.resolve('@learn/api-contracts');assert.ok(resolved.startsWith(process.cwd()+path.sep));const sdk=require('@learn/api-contracts');assert.equal(sdk.loginSchema.parse({email:'TEST@example.invalid',password:'example'}).email,'test@example.invalid');assert.equal(sdk.questionReadSchema.shape.correctAnswer,undefined);console.log('isolated consumer runtime passed');`,
  ],
  { cwd: consumer, stdio: 'pipe' },
);
writeFileSync(
  join(consumer, 'consumer.ts'),
  `import { createCourseSchema, type CreateCourseInput } from '@learn/api-contracts';\nconst input: CreateCourseInput = { title: 'Example', language: 'vi' };\ncreateCourseSchema.parse(input);\n`,
);
execFileSync(
  process.execPath,
  [
    join(root, 'node_modules/typescript/bin/tsc'),
    '--noEmit',
    '--strict',
    '--skipLibCheck',
    '--target',
    'ES2022',
    '--moduleResolution',
    'node',
    'consumer.ts',
  ],
  { cwd: consumer, stdio: 'pipe' },
);
const result = {
  status: 'passed',
  mode: 'isolated tarball install; locally supplied public Zod peer due network restriction',
  sdkSha256: createHash('sha256').update(readFileSync(sdk)).digest('hex'),
  runtime: 'passed',
  types: 'passed',
  backendSourceRequired: false,
};
writeFileSync(join(release, 'consumer-smoke.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
