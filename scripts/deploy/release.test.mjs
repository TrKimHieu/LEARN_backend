import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deploymentPlan, isTargetHost } from './release.mjs';

const image = `123456789012.dkr.ecr.ap-southeast-1.amazonaws.com/learn/api@sha256:${'a'.repeat(64)}`;
const input = {
  environment: 'staging',
  service: 'api',
  image,
  account: '123456789012',
  instance: 'i-1234567890abcdef0',
  region: 'ap-southeast-1',
};

test('plan runs only the fixed release command on the explicit host', () => {
  const plan = deploymentPlan(input);
  assert.equal(plan.DocumentName, 'AWS-RunShellScript');
  assert.deepEqual(plan.InstanceIds, [input.instance]);
  assert.deepEqual(plan.Parameters.commands, [`/opt/learn/learn-release.sh api ${image}`]);
});

test('bundle is copied to the host before the release', () => {
  const bundle = `s3://learn-deploy-bucket/onebox/${'b'.repeat(40)}`;
  const { commands } = deploymentPlan({ ...input, bundle }).Parameters;
  assert.equal(commands.length, 3);
  assert.match(commands[0], /^aws s3 cp --recursive /);
  assert.equal(commands[2], `/opt/learn/learn-release.sh api ${image}`);
});

test('rejects mutable tags, injection, undeclared values and other accounts', () => {
  for (const change of [
    { image: image.replace(/@sha256:.*/, ':latest') },
    { image: `${image};echo x` },
    { image: `ghcr.io/example/learn-api@sha256:${'a'.repeat(64)}` },
    { image: image.replace('123456789012', '999999999999') },
    { image: image.replace('ap-southeast-1', 'us-east-1') },
    { service: 'api;id' },
    { service: 'postgres' },
    { environment: 'dev' },
    { account: 'unknown' },
    { instance: 'i-anything' },
    { bundle: 's3://bucket/onebox/latest;id' },
  ]) {
    assert.throws(() => deploymentPlan({ ...input, ...change }));
  }
});

test('only the running host of the same environment is a target', () => {
  const host = (environment, state = 'running') => ({
    State: { Name: state },
    Tags: [
      { Key: 'Project', Value: 'LEARN' },
      { Key: 'Environment', Value: environment },
      { Key: 'Service', Value: 'onebox' },
    ],
  });
  assert.equal(isTargetHost(host('staging'), 'staging'), true);
  assert.equal(isTargetHost(host('production'), 'staging'), false);
  assert.equal(isTargetHost(host('staging', 'stopped'), 'staging'), false);
  assert.equal(isTargetHost(undefined, 'staging'), false);
});
