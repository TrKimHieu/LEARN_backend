import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deploymentPlan } from './staging.mjs';

const input = {
  service: 'api',
  image: `ghcr.io/example/learn-api@sha256:${'a'.repeat(64)}`,
  account: '123456789012',
  instance: 'i-1234567890abcdef0',
  region: 'ap-southeast-1',
};
test('staging plan contains only a fixed release command and explicit target', () => {
  const plan = deploymentPlan(input);
  assert.equal(plan.DocumentName, 'AWS-RunShellScript');
  assert.deepEqual(plan.InstanceIds, [input.instance]);
  assert.deepEqual(plan.Parameters.commands, [
    `sudo /usr/local/bin/learn-release api ${input.image}`,
  ]);
});
test('rejects mutable tags, shell injection and undeclared services', () => {
  for (const change of [
    { image: 'ghcr.io/example/learn-api:latest' },
    { image: input.image + ';echo x' },
    { service: 'api;id' },
    { service: 'postgres' },
    { account: 'unknown' },
    { instance: 'i-anything' },
  ]) {
    assert.throws(() => deploymentPlan({ ...input, ...change }));
  }
});
