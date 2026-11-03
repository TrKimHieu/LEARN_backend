import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Worker } from 'bullmq';
import { WorkerModule } from './worker.module';
import {
  DocumentExtractProcessor,
  type DocumentExtractJobData,
} from './processors/document-extract.processor';
import {
  LessonGenerateProcessor,
  type LessonGenerateJobData,
} from './processors/lesson-generate.processor';
import { env } from './environment';

const QUEUE_NAMES = {
  documentExtract: 'document-extract',
  lessonGenerate: 'lesson-generate',
} as const;

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: ['log', 'warn', 'error'],
  });

  const documentExtract = app.get(DocumentExtractProcessor);
  const lessonGenerate = app.get(LessonGenerateProcessor);
  const connection = { url: env.REDIS_URL };

  // Concurrency + queue theo HANDBOOK §9.1.
  const workers = [
    new Worker<DocumentExtractJobData>(
      QUEUE_NAMES.documentExtract,
      (job) => documentExtract.process(job.data),
      { connection, concurrency: 4 },
    ),
    new Worker<LessonGenerateJobData>(
      QUEUE_NAMES.lessonGenerate,
      (job) => lessonGenerate.process(job.data),
      { connection, concurrency: 2 },
    ),
  ];

  for (const w of workers) {
    w.on('failed', (job, err) => {
      console.error(`[worker] job ${job?.id} (${w.name}) thất bại:`, err.message);
    });
    w.on('error', (err) => console.error(`[worker] lỗi kết nối (${w.name}):`, err.message));
  }

  console.log(`LEARN Worker sẵn sàng (env=${env.NODE_ENV}, llmMode=${env.LLM_MODE}).`);

  // Tắt êm — HANDBOOK §9.2: chờ job hiện tại chạy xong trước khi thoát.
  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[worker] nhận ${signal}, đang đóng — chờ job hiện tại xong...`);
    await Promise.all(workers.map((w) => w.close()));
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  console.error('Worker khởi động thất bại:', err);
  process.exit(1);
});
