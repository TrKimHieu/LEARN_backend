import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const script = fileURLToPath(new URL('../../scripts/contracts-hash.mjs', import.meta.url));

describe('CONTRACTS_HASH', () => {
  it('khớp nội dung contracts hiện tại (quên chạy `npm run contracts:hash` thì đỏ)', () => {
    // --check exit 1 khi lệch → execFileSync ném lỗi → test đỏ kèm hướng dẫn trong stderr.
    expect(() =>
      execFileSync(process.execPath, [script, '--check'], { stdio: 'pipe' }),
    ).not.toThrow();
  });
});
