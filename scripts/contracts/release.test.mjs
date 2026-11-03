import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  symlinkSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '../..');
let output;
function release() {
  assert.ok(
    existsSync(join(root, 'scripts/contracts/build-release.mjs')),
    'versioned release builder is not implemented',
  );
  if (!output) {
    output = mkdtempSync(join(tmpdir(), 'learn-contracts-test-'));
    execFileSync(process.execPath, ['scripts/contracts/build-release.mjs', '--out', output], {
      cwd: root,
      stdio: 'pipe',
    });
    // A consumer must supply the declared peer; no backend workspace source is linked.
    mkdirSync(join(output, 'node_modules'), { recursive: true });
    symlinkSync(join(root, 'node_modules/zod'), join(output, 'node_modules/zod'), 'junction');
  }
  return output;
}

test('release builds a versioned client-only SDK from canonical schemas', () => {
  const dir = release();
  const pkg = JSON.parse(readFileSync(join(dir, 'sdk/package.json')));
  assert.equal(pkg.name, '@learn/api-contracts');
  assert.match(pkg.version, /^1\.\d+\.\d+$/);
  assert.equal(pkg.private, undefined);
  assert.deepEqual(Object.keys(pkg.dependencies ?? {}), []);
  assert.ok(pkg.peerDependencies.zod);
  assert.ok(!readdirSync(join(dir, 'sdk/dist')).some((f) => /test|\.map$/.test(f)));
  const require = createRequire(join(root, 'package.json'));
  const sdk = require(join(dir, 'sdk/dist/index.js'));
  assert.equal(
    sdk.registerSchema.parse({
      email: 'TEST@example.invalid',
      password: 'example123',
      displayName: 'Test',
    }).email,
    'test@example.invalid',
  );
  assert.equal(sdk.questionReadSchema.shape.correctAnswer, undefined);
  assert.equal(sdk.answerOptionReadSchema.shape.isCorrect, undefined);
  assert.ok(sdk.submissionSchema.shape.results);
});

test('OpenAPI covers real controllers, native auth, request schemas and safe exercise reads', () => {
  const dir = release();
  const api = JSON.parse(readFileSync(join(dir, 'openapi.json')));
  assert.equal(api.openapi, '3.1.0');
  assert.ok(api.paths['/api/v1/auth/register'].post.requestBody);
  assert.ok(api.paths['/api/v1/auth/login'].post.responses['201']);
  assert.ok(api.paths['/api/v1/auth/refresh'].post.responses['201']);
  assert.ok(api.paths['/api/v1/auth/logout'].post.responses['201']);
  assert.ok(api.paths['/api/v1/auth/change-password'].post.responses['201']);
  assert.ok(api.paths['/api/v1/webhooks/stripe'].post.responses['200']);
  assert.ok(
    api.paths['/api/v1/auth/logout'].post.parameters.some(
      (p) => p.in === 'header' && p.name === 'x-learn-client',
    ),
  );
  assert.ok(
    api.paths['/api/v1/progress/history'].get.parameters.some(
      (p) => p.in === 'query' && p.name === 'cursor',
    ),
  );
  assert.ok(
    api.paths['/api/v1/progress/history'].get.parameters.some(
      (p) => p.in === 'query' && p.name === 'limit',
    ),
  );
  assert.ok(
    api.paths['/api/v1/lessons/{lessonId}/exercise'].get.parameters.some(
      (p) => p.in === 'query' && p.name === 'exerciseId',
    ),
  );
  assert.ok(api.paths['/api/v1/lessons/{lessonId}/exercise/submit'].post);
  assert.ok(api.paths['/api/v1/admin/metrics'].get.security.length);
  assert.deepEqual(api.paths['/api/v1/meta'].get.security, []);
  assert.ok(api.components.schemas.nativeAuthResponseSchema.properties.refreshToken);
  assert.equal(api.components.schemas.questionReadSchema.properties.correctAnswer, undefined);
  assert.equal(api.components.schemas.answerOptionReadSchema.properties.isCorrect, undefined);
  const manifest = JSON.parse(readFileSync(join(dir, 'release.json')));
  assert.ok(manifest.operations >= 45);
  assert.match(manifest.files['openapi.json'], /^[a-f0-9]{64}$/);
});

test('mock requests validate against the same canonical Zod schemas', () => {
  const dir = release();
  const require = createRequire(join(root, 'package.json'));
  const sdk = require(join(dir, 'sdk/dist/index.js'));
  const fixtures = JSON.parse(readFileSync(join(dir, 'mock-fixtures.json')));
  for (const [name, value] of Object.entries(fixtures.requests)) {
    assert.ok(sdk[name], name);
    assert.equal(sdk[name].safeParse(value).success, true, name);
  }
  assert.equal(fixtures.mode, 'synthetic-contract-fixtures');
});
