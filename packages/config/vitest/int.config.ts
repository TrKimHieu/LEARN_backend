import { defineConfig } from 'vitest/config';

/**
 * Cấu hình cho test tích hợp — yêu cầu hạ tầng thật đang chạy:
 * `docker compose up -d` (Postgres/Redis/MinIO) + `npm run dev`.
 * Các test dạng *.integration.test.ts chỉ include những bộ chạy được
 * một cách chọn lọc, không chạy chung với unit test trong CI hiện tại.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'apps/api/src/**/*.integration.test.ts',
      'apps/worker/src/**/*.integration.test.ts',
      'packages/**/*.integration.test.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
