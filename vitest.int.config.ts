/**
 * Entry shim tại root — vitest phát hiện vitest.int.config.ts ở cwd repo.
 * Toàn bộ cấu hình thật nằm ở packages/config/vitest/.
 */
export { default } from './packages/config/vitest/int.config';
