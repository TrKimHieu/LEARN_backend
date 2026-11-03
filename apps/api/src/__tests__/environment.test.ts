import { describe, it, expect } from 'vitest';
import { DEV_ONLY_DEFAULTS, insecureProductionVars, type Env } from '../environment';

/** Env tối thiểu, đã "an toàn", để từng test chỉ đổi đúng thứ nó đang kiểm. */
const safeEnv = (over: Partial<Env> = {}): Env =>
  ({
    NODE_ENV: 'production',
    JWT_ACCESS_SECRET: 'a-real-secret-that-is-long-enough-000000',
    S3_ACCESS_KEY_ID: 'real-key',
    S3_SECRET_ACCESS_KEY: 'real-secret',
    BILLING_MODE: 'demo',
    STRIPE_WEBHOOK_SECRET: '',
    ...over,
  }) as Env;

describe('insecureProductionVars', () => {
  it('production với cấu hình thật → không có gì vi phạm', () => {
    expect(insecureProductionVars(safeEnv())).toEqual([]);
  });

  // Lỗi thật: `JWT_ACCESS_SECRET` có default dài 40 ký tự nên `.min(32)` của Zod pass,
  // và giá trị đó nằm công khai trong repo. Thiếu biến môi trường ở production nghĩa là
  // bất kỳ ai cũng ký được access token `role: 'ADMIN'` cho `sub` tuỳ ý.
  it('bắt được secret JWT còn là giá trị mặc định của dev', () => {
    const bad = insecureProductionVars(
      safeEnv({ JWT_ACCESS_SECRET: DEV_ONLY_DEFAULTS.JWT_ACCESS_SECRET }),
    );
    expect(bad).toContain('JWT_ACCESS_SECRET');
  });

  it('bắt được credential MinIO mặc định', () => {
    const bad = insecureProductionVars(
      safeEnv({
        S3_ACCESS_KEY_ID: DEV_ONLY_DEFAULTS.S3_ACCESS_KEY_ID,
        S3_SECRET_ACCESS_KEY: DEV_ONLY_DEFAULTS.S3_SECRET_ACCESS_KEY,
      }),
    );
    expect(bad).toEqual(expect.arrayContaining(['S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']));
  });

  it('BILLING_MODE=live mà thiếu webhook secret → vi phạm', () => {
    expect(insecureProductionVars(safeEnv({ BILLING_MODE: 'live' }))).toContain(
      'STRIPE_WEBHOOK_SECRET',
    );
  });

  it('BILLING_MODE=demo thì không đòi webhook secret', () => {
    expect(insecureProductionVars(safeEnv({ BILLING_MODE: 'demo' }))).not.toContain(
      'STRIPE_WEBHOOK_SECRET',
    );
  });

  it.each(['development', 'test'] as const)(
    'NODE_ENV=%s vẫn dùng được giá trị mặc định — đây là mục đích của chúng',
    (nodeEnv) => {
      const env = safeEnv({
        NODE_ENV: nodeEnv,
        JWT_ACCESS_SECRET: DEV_ONLY_DEFAULTS.JWT_ACCESS_SECRET,
        S3_ACCESS_KEY_ID: DEV_ONLY_DEFAULTS.S3_ACCESS_KEY_ID,
      });
      expect(insecureProductionVars(env)).toEqual([]);
    },
  );
});
