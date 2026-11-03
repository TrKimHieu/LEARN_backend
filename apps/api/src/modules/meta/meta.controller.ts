import { Controller, Get } from '@nestjs/common';
import { CONTRACTS_HASH, type MetaResponse } from '@learn/contracts';
import { env } from '../../environment';

/**
 * `GET /api/v1/meta` — công khai, không cần đăng nhập (app gọi trước cả màn đăng nhập). Cho client
 * biết máy chủ đang chạy contracts nào và app mobile tối thiểu còn được hỗ trợ — xem
 * `packages/contracts/src/meta.ts`.
 */
@Controller('api/v1/meta')
export class MetaController {
  @Get()
  meta(): MetaResponse {
    return {
      apiVersion: 'v1',
      contractsHash: CONTRACTS_HASH,
      minMobileVersion: env.MIN_MOBILE_VERSION,
    };
  }
}
