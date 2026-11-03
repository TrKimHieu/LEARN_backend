import { describe, expect, it } from 'vitest';
import { CONTRACTS_HASH, metaResponseSchema } from '@learn/contracts';
import { MetaController } from '../meta.controller';

describe('GET /api/v1/meta', () => {
  it('trả đúng hình dạng contract, hash contracts của chính máy chủ và bản mobile tối thiểu', () => {
    const body = new MetaController().meta();
    expect(metaResponseSchema.parse(body)).toEqual(body);
    expect(body.contractsHash).toBe(CONTRACTS_HASH);
    expect(body.minMobileVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
