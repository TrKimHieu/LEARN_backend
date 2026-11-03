import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { env } from '../environment';

/** Publisher cho SSE — API subscribe kênh `job:<id>`, xem apps/api/src/modules/ai/ai.controller.ts. */
@Injectable()
export class RedisPublisher implements OnModuleDestroy {
  private readonly client = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

  constructor() {
    this.client.on('error', () => undefined);
  }

  async publishJobEvent(jobId: string, event: Record<string, unknown>): Promise<void> {
    await this.client.publish(`job:${jobId}`, JSON.stringify({ jobId, ...event }));
  }

  onModuleDestroy(): Promise<'OK'> {
    return this.client.quit();
  }
}
