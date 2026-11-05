// Runs the real host script against fake `docker` and `aws` commands. Needs bash and flock, so it is
// skipped on machines without them (CI and the host are Linux).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const script = resolve(import.meta.dirname, '../../infra/aws/learn-release.sh');
const skip = spawnSync('flock', ['--version']).status !== 0 && 'flock is not installed';
const registry = '123456789012.dkr.ecr.ap-southeast-1.amazonaws.com';
const digest = (c) => `${registry}/learn/api@sha256:${c.repeat(64)}`;

// `HEALTHY=0` makes the health probe fail, as a broken image would.
const FAKE_DOCKER = `#!/usr/bin/env bash
echo "docker $*" >> "$LEARN_HOME/calls.log"
case "$*" in
  login*) cat > /dev/null ;;
  *'exec -T'*) exit "$((1 - \${HEALTHY:-1}))" ;;
  *'ps -q'*) echo fake-container ;;
  *'.State.Running'*) echo true ;;
  *RestartCount*) echo 0 ;;
esac
exit 0
`;

function setup(env = `API_IMAGE=${digest('a')}\n`, mode = 0o600) {
  const home = mkdtempSync(join(tmpdir(), 'learn-release-'));
  const bin = mkdtempSync(join(tmpdir(), 'learn-bin-'));
  for (const [name, body] of [
    ['docker', FAKE_DOCKER],
    ['aws', '#!/usr/bin/env bash\necho token\n'],
  ]) {
    writeFileSync(join(bin, name), body);
    chmodSync(join(bin, name), 0o755);
  }
  writeFileSync(join(home, '.env'), env);
  chmodSync(join(home, '.env'), mode);
  writeFileSync(join(home, 'calls.log'), '');
  return { home, bin };
}

function release({ home, bin }, service, image, extra = {}) {
  const result = spawnSync('bash', [script, service, image], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      LEARN_HOME: home,
      LEARN_LOCK: join(home, 'lock'),
      LEARN_HEALTH_ATTEMPTS: '2',
      LEARN_HEALTH_DELAY: '0',
      ...extra,
    },
  });
  return {
    status: result.status,
    env: readFileSync(join(home, '.env'), 'utf8'),
    calls: readFileSync(join(home, 'calls.log'), 'utf8'),
  };
}

test('healthy release pins the new digest', { skip }, () => {
  const out = release(setup(), 'api', digest('b'));
  assert.equal(out.status, 0);
  assert.match(out.env, new RegExp(`API_IMAGE=${digest('b')}`));
  assert.match(out.calls, /pull .*sha256:b/);
  assert.match(out.calls, /run --rm storage-init/);
  assert.match(out.calls, /up -d --no-deps api/);
  assert.match(out.calls, /up -d --no-deps caddy/);
});

test('failed health check restores the previous digest and restarts it', { skip }, () => {
  const out = release(setup(), 'api', digest('b'), { HEALTHY: '0' });
  assert.equal(out.status, 1);
  assert.match(out.env, new RegExp(`API_IMAGE=${digest('a')}`));
  assert.equal(out.calls.match(/up -d --no-deps api/g).length, 2);
  assert.doesNotMatch(out.calls, /up -d --no-deps caddy/);
});

test('migrate runs the ops profile and starts no service', { skip }, () => {
  const out = release(setup(`MIGRATE_IMAGE=${digest('a')}\n`), 'migrate', digest('b'));
  assert.equal(out.status, 0);
  assert.match(out.calls, /--profile ops run --rm migrate/);
  assert.doesNotMatch(out.calls, /up -d/);
});

test('rejects mutable tags and undeclared services before touching docker', { skip }, () => {
  for (const [service, image] of [
    ['api', `${registry}/learn/api:latest`],
    ['api', `ghcr.io/x/y@sha256:${'a'.repeat(64)}`],
    ['postgres', digest('b')],
  ]) {
    const out = release(setup(), service, image);
    assert.equal(out.status, 2);
    assert.equal(out.calls, '');
  }
});

test('refuses a config file other users can read', { skip }, () => {
  const out = release(setup(`API_IMAGE=${digest('a')}\n`, 0o644), 'api', digest('b'));
  assert.equal(out.status, 2);
  assert.equal(out.calls, '');
});
