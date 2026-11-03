import { z } from 'zod';

/**
 * `GET /api/v1/meta` — công khai. Để client (nhất là app mobile, cập nhật chậm hơn máy chủ) biết
 * mình có còn khớp với máy chủ không:
 * - `contractsHash`: dấu vân tay `@learn/contracts` của máy chủ (`version.ts`). App so với hash nó
 *   mang theo lúc chép contracts.
 * - `minMobileVersion`: phiên bản app thấp nhất còn dùng được (biến `MIN_MOBILE_VERSION`). App cũ
 *   hơn thì nhắc cập nhật.
 */
export const metaResponseSchema = z.object({
  apiVersion: z.literal('v1'),
  contractsHash: z.string(),
  minMobileVersion: z.string(),
});

export type MetaResponse = z.infer<typeof metaResponseSchema>;
