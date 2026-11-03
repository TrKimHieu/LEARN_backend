import { Injectable, Module, Global } from '@nestjs/common';
import Redis from 'ioredis';
import { Queue } from 'bullmq';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { prisma } from '@learn/db';
import type { Prisma, PrismaClient } from '@learn/db';
import { env } from '../environment';

/**
 * Loại "có thể chạy truy vấn" — nhận được cả client toàn cục (`PrismaService.client`) lẫn
 * transaction client. Repository method nhận `db` ở tham số cuối để service gọi được trong
 * cả hai ngữ cảnh mà không nhân đôi code.
 */
export type Db = Prisma.TransactionClient | PrismaClient;

@Injectable()
export class PrismaService {
  readonly client = prisma;
  onModuleDestroy(): Promise<void> {
    return this.client.$disconnect();
  }
}

@Injectable()
export class RedisService {
  readonly client: Redis;
  readonly events: Redis;
  private eventSubscribers = new Map<string, (payload: string) => void>();

  constructor() {
    this.client = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
    this.events = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
    // Không để sự kiện lỗi connection thành UnhandledError làm crash tiến trình
    // (Redis/Postgres tắt? boot vẫn OK; xử lý chuyển degraded qua /health/ready)
    this.client.on('error', () => undefined);
    this.events.on('error', () => undefined);
    this.events.on('message', (_channel, message) => {
      this.eventSubscribers.forEach((cb) => cb(message));
    });
  }

  async subscribe(channel: string, cb: (payload: string) => void): Promise<void> {
    this.eventSubscribers.set(channel, cb);
    await this.events.subscribe(channel);
  }

  async unsubscribe(channel: string): Promise<void> {
    this.eventSubscribers.delete(channel);
    await this.events.unsubscribe(channel);
  }

  async publish(channel: string, payload: string): Promise<void> {
    await this.client.publish(channel, payload);
  }

  // ---- rate limit: cửa sổ cố định, INCR + EXPIRE trong MỘT lệnh nguyên tử ----
  //
  // Bản trước gọi `TTL` bằng một round-trip RIÊNG, ngoài `MULTI`, rồi mới quyết định có
  // xếp `EXPIRE` vào hay không. Hai request đến cùng lúc khi key chưa tồn tại thì cả hai
  // đều đọc được `TTL = -2` nên cả hai đều xếp `EXPIRE`: request thứ hai đẩy cửa sổ trượt
  // về lại đủ `ttlSeconds` ngay sau khi request đầu vừa mở nó. Comment cũ ghi "nguyên tử"
  // nhưng chỉ phần `MULTI` là nguyên tử, còn nhánh rẽ dựa trên `TTL` thì không.
  //
  // Lua script chạy trọn vẹn trong Redis, không xen kẽ được, nên chỉ lần INCR đầu tiên của
  // mỗi cửa sổ mới đặt hạn — cửa sổ hết hạn đúng lúc phải hết hạn.
  private static readonly INCR_WITH_TTL_LUA = `
    local current = redis.call('INCR', KEYS[1])
    if current == 1 then
      redis.call('EXPIRE', KEYS[1], ARGV[1])
    end
    return current
  `;

  async incrWithTtl(key: string, ttlSeconds: number): Promise<number> {
    const value = await this.client.eval(
      RedisService.INCR_WITH_TTL_LUA,
      1,
      key,
      String(ttlSeconds),
    );
    return typeof value === 'number' ? value : Number(value) || 0;
  }

  onModuleDestroy(): void {
    this.client.disconnect();
    this.events.disconnect();
  }
}

function s3Client(endpoint: string): S3Client {
  return new S3Client({
    region: env.S3_REGION,
    endpoint,
    forcePathStyle: true, // MinIO
    credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
    // SDK v3 mặc định tự thêm x-amz-checksum-* vào presigned URL (flexible checksums),
    // nhưng không có body lúc ký nên chỉ chèn giá trị rỗng → PUT thật luôn bị SignatureDoesNotMatch.
    requestChecksumCalculation: 'WHEN_REQUIRED',
  });
}

@Injectable()
export class S3Service {
  private readonly client: S3Client;
  /** Chỉ để ký presigned URL — host là host client gọi tới (`S3_PUBLIC_ENDPOINT`). */
  private readonly presigner: S3Client;
  private readonly bucket = env.S3_BUCKET;

  constructor() {
    this.client = s3Client(env.S3_ENDPOINT);
    this.presigner = env.S3_PUBLIC_ENDPOINT ? s3Client(env.S3_PUBLIC_ENDPOINT) : this.client;
  }

  /** URL upload (PUT) hạn ngắn — HANDBOOK §4.3 Luồng 1. */
  async putUploadUrl(
    key: string,
    contentType: string,
    sizeBytes: number,
    expiresIn = 900,
  ): Promise<string> {
    const cmd = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
      ContentLength: sizeBytes,
    });
    return getSignedUrl(this.presigner, cmd, { expiresIn });
  }

  /** URL tải về (GET) hạn ngắn — endpoint download. */
  async getDownloadUrl(key: string, expiresIn = 300): Promise<string> {
    const cmd = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.presigner, cmd, { expiresIn });
  }

  async getObject(key: string): Promise<Buffer> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const bytes = await res.Body?.transformToByteArray();
    if (!bytes) throw new Error(`Không đọc được object ${key}`);
    return Buffer.from(bytes);
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

export const QUEUE_NAMES = {
  documentExtract: 'document-extract',
  lessonGenerate: 'lesson-generate',
  billingSync: 'billing-sync',
  maintenance: 'maintenance',
} as const;

const connection = { url: env.REDIS_URL };

@Injectable()
export class QueueService {
  readonly documentExtract = new Queue(QUEUE_NAMES.documentExtract, { connection });
  readonly lessonGenerate = new Queue(QUEUE_NAMES.lessonGenerate, { connection });
  readonly billingSync = new Queue(QUEUE_NAMES.billingSync, { connection });
  readonly maintenance = new Queue(QUEUE_NAMES.maintenance, { connection });

  constructor() {
    // Redis chưa bật khi dev → không để lỗi connection bay hơi thành UnhandledError
    for (const q of [
      this.documentExtract,
      this.lessonGenerate,
      this.billingSync,
      this.maintenance,
    ]) {
      q.on('error', () => undefined);
    }
  }

  onModuleDestroy(): Promise<unknown[]> {
    return Promise.all([
      this.documentExtract.close(),
      this.lessonGenerate.close(),
      this.billingSync.close(),
      this.maintenance.close(),
    ]);
  }
}

@Global()
@Module({
  providers: [PrismaService, RedisService, S3Service, QueueService],
  exports: [PrismaService, RedisService, S3Service, QueueService],
})
export class CommonModule {}

export type { S3Service as S3ServiceType, RedisService as RedisServiceType };
