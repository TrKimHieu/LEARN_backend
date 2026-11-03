import { z } from 'zod';

/**
 * Giá trị mặc định "chạy được ngay trên máy dev" — tiện cho `npm run dev`, nhưng nếu lọt lên
 * production thì mỗi dòng ở đây là một lỗ hổng: secret JWT mặc định nằm công khai trong repo,
 * ai cũng ký được access token `role: 'ADMIN'` cho `sub` bất kỳ.
 *
 * `.min(32)` trên `JWT_ACCESS_SECRET` **không** bắt được việc này vì chính default đã dài 40 ký tự.
 * Nên phải so khớp thẳng với giá trị mặc định và chặn ở tầng khởi động — xem
 * `insecureProductionVars()` phía dưới.
 */
export const DEV_ONLY_DEFAULTS = {
  JWT_ACCESS_SECRET: 'dev-only-secret-change-me-0123456789abcdef',
  S3_ACCESS_KEY_ID: 'minioadmin',
  S3_SECRET_ACCESS_KEY: 'minioadmin',
} as const;

/** Múi giờ hợp lệ hay không — hỏi thẳng Intl thay vì giữ một danh sách tự chép. */
function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Cấu hình từ biến môi trường — HANDBOOK §22.1. Validate lúc khởi động, fail fast. */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  /**
   * Số tầng reverse proxy đứng trước API (Caddy trên server = 1). Bật thì Express đọc IP thật từ
   * `X-Forwarded-For`; không bật khi có proxy thì mọi request mang IP của proxy và rate limit theo
   * IP (đăng nhập 5 lần/phút) thành giới hạn CHUNG cho mọi người dùng. Dev chạy thẳng: 0.
   */
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
  PORT: z.coerce.number().int().default(4000),
  APP_URL: z.string().url().default('http://localhost:3000'),
  /** Phiên bản app mobile thấp nhất còn hỗ trợ — trả ở `GET /meta`, app cũ hơn sẽ nhắc cập nhật. */
  MIN_MOBILE_VERSION: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/, 'MIN_MOBILE_VERSION phải dạng x.y.z')
    .default('1.0.0'),
  /**
   * Múi giờ dùng để cắt "ngày" trong các chỉ số theo ngày — hiện là chuỗi ngày học liên tiếp
   * (`ProgressService.activeStreak`). Mặc định giờ Việt Nam vì toàn bộ nội dung và người dùng
   * của sản phẩm là tiếng Việt; cắt theo UTC nghĩa là ranh giới ngày rơi vào 07:00 sáng giờ VN,
   * nên học lúc 1 giờ đêm bị tính sang hôm trước và chuỗi đứt oan.
   * Phải là một tên IANA hợp lệ (`Asia/Ho_Chi_Minh`, `UTC`, …) — validate ngay lúc khởi động.
   */
  APP_TIMEZONE: z
    .string()
    .default('Asia/Ho_Chi_Minh')
    .refine(isValidTimeZone, { message: 'Không phải tên múi giờ IANA hợp lệ' }),
  API_URL: z.string().url().default('http://localhost:4000'),
  DATABASE_URL: z
    .string()
    .min(1)
    .default('postgresql://learn:learn@localhost:5432/learn?schema=public'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  JWT_ACCESS_SECRET: z.string().min(32).default(DEV_ONLY_DEFAULTS.JWT_ACCESS_SECRET),
  JWT_ACCESS_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().default(30),
  S3_ENDPOINT: z.string().url().default('http://localhost:9000'),
  /**
   * Host mà CLIENT dùng để PUT/GET presigned URL, nếu khác `S3_ENDPOINT` (host API dùng nội bộ).
   * Chữ ký SigV4 gồm cả host, nên không thể đổi host sau khi ký — phải ký bằng đúng host client
   * sẽ gọi. Dev với app mobile: `http://<IP LAN của máy dev>:9000` (điện thoại không tới được
   * `localhost` của máy tính). Bỏ trống = dùng `S3_ENDPOINT`.
   */
  // `.env.example` để trống dòng này — dotenv đọc thành '', coi như không đặt.
  S3_PUBLIC_ENDPOINT: z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional()),
  S3_BUCKET: z.string().default('learn-documents'),
  S3_ACCESS_KEY_ID: z.string().default(DEV_ONLY_DEFAULTS.S3_ACCESS_KEY_ID),
  S3_SECRET_ACCESS_KEY: z.string().default(DEV_ONLY_DEFAULTS.S3_SECRET_ACCESS_KEY),
  S3_REGION: z.string().default('us-east-1'),
  LLM_PROVIDER: z.enum(['anthropic', 'google', 'openai']).default('anthropic'),
  LLM_API_KEY: z.string().default(''),
  LLM_MODEL_GENERATION: z.string().default('claude-sonnet-5'),
  LLM_MODEL_FAST: z.string().default('claude-haiku-4-5-20251001'),
  LLM_MODE: z.enum(['live', 'mock', 'record']).default('mock'),
  AI_JOB_MAX_COST_USD: z.coerce.number().default(0.5),
  AI_JOB_TIMEOUT_MS: z.coerce.number().int().default(900000),
  AI_MAX_CONCURRENT_CALLS: z.coerce.number().int().default(3),
  UPLOAD_MAX_BYTES: z.coerce.number().int().default(26214400),
  DOCUMENT_MAX_SIZE: z.coerce.number().int().default(26214400),
  S3_PUT_URL_EXPIRES_SEC: z.coerce.number().int().default(900),
  UPLOAD_MAX_PAGES: z.coerce.number().int().default(300),
  OCR_MAX_PAGES: z.coerce.number().int().default(50),
  BILLING_MODE: z.enum(['demo', 'live']).default('demo'),
  STRIPE_SECRET_KEY: z.string().default(''),
  STRIPE_WEBHOOK_SECRET: z.string().default(''),
  LOG_LEVEL: z.string().default('info'),
  /**
   * Gửi thư (đặt lại mật khẩu — FR-AUTH-07). `log`: không gửi, in đường dẫn ra log API — chỉ để
   * dev; ở production chế độ này KHÔNG in đường dẫn (token là bí mật), chỉ cảnh báo thư không đi.
   * `smtp`: gửi thật qua `SMTP_URL` (vd `smtps://user:pass@smtp.example.com:465`).
   */
  MAIL_MODE: z.enum(['log', 'smtp']).default('log'),
  SMTP_URL: z.string().default(''),
  MAIL_FROM: z.string().default('LEARN <no-reply@learn.local>'),
  PASSWORD_RESET_TTL_MIN: z.coerce
    .number()
    .int()
    .min(5)
    .max(24 * 60)
    .default(30),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Chặn boot khi production vẫn còn dùng giá trị dev. Trả về danh sách biến vi phạm thay vì
 * thoát tiến trình để unit-test gọi được.
 */
export function insecureProductionVars(source: Env): string[] {
  if (source.NODE_ENV !== 'production') return [];
  const bad: string[] = [];
  for (const [key, devValue] of Object.entries(DEV_ONLY_DEFAULTS)) {
    if (source[key as keyof typeof DEV_ONLY_DEFAULTS] === devValue) bad.push(key);
  }
  if (source.BILLING_MODE === 'live' && !source.STRIPE_WEBHOOK_SECRET) {
    bad.push('STRIPE_WEBHOOK_SECRET');
  }
  if (source.MAIL_MODE === 'smtp' && !source.SMTP_URL) bad.push('SMTP_URL');
  return bad;
}

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Cấu hình môi trường không hợp lệ', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const insecure = insecureProductionVars(parsed.data);
if (insecure.length > 0) {
  console.error(
    `NODE_ENV=production nhưng các biến sau vẫn là giá trị mặc định của môi trường dev: ` +
      `${insecure.join(', ')}. Đặt giá trị thật rồi khởi động lại.`,
  );
  process.exit(1);
}

export const env: Env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
