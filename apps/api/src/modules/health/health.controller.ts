import { Controller, Get } from '@nestjs/common';
import { PrismaService, RedisService, S3Service } from '../../infra/services';

@Controller('api/v1/health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly s3: S3Service,
  ) {}

  @Get()
  liveness() {
    return { status: 'ok', uptimeSec: Math.round(process.uptime()) };
  }

  @Get('ready')
  async readiness() {
    const checks: Record<string, 'up' | 'down'> = {};
    try {
      await this.prisma.client.$queryRaw`SELECT 1`;
      checks.database = 'up';
    } catch {
      checks.database = 'down';
    }
    try {
      await this.redis.client.ping();
      checks.redis = 'up';
    } catch {
      checks.redis = 'down';
    }
    try {
      await this.s3.getDownloadUrl('health-check');
      checks.storage = 'up';
    } catch {
      checks.storage = 'down';
    }
    const ready = Object.values(checks).every((v) => v === 'up');
    return { status: ready ? 'ready' : 'degraded', checks };
  }
}
