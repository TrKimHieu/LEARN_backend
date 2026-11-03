import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { prisma, newId } from '@learn/db';
import { createComputeServer } from '@learn/ai';
import { LessonGenerateProcessor } from '../lesson-generate.processor';
import { RedisPublisher } from '../../common/redis';
import { env } from '../../environment';

if (
  process.env.NODE_ENV !== 'test' ||
  process.env.DATABASE_URL !==
    'postgresql://learn_m1:learn_m1@127.0.0.1:15432/learn_m1?schema=public'
)
  throw Error('Fixed M1 sandbox required');
const previous = {
  COMPUTE_URL: env.COMPUTE_URL,
  COMPUTE_TOKEN: env.COMPUTE_TOKEN,
  COMPUTE_TIMEOUT_MS: env.COMPUTE_TIMEOUT_MS,
};
const users: string[] = [];
const publishers: RedisPublisher[] = [];
const servers: Server[] = [];
class RecordingPublisher extends RedisPublisher {
  readonly events: Record<string, unknown>[] = [];
  constructor(private readonly failSuccess = false) {
    super();
    publishers.push(this);
  }
  override async publishJobEvent(id: string, event: Record<string, unknown>) {
    this.events.push(event);
    if (this.failSuccess && event.status === 'SUCCEEDED')
      throw Error('Injected Redis publication outage');
    await super.publishJobEvent(id, event);
  }
}
async function fixture() {
  const u = await prisma.user.create({
    data: {
      email: `terminal-${newId()}@example.invalid`,
      passwordHash: 'test-only',
      displayName: 'Terminal state fixture',
    },
  });
  users.push(u.id);
  const c = await prisma.course.create({ data: { ownerId: u.id, title: 'HTTP' } });
  const d = await prisma.document.create({
    data: {
      courseId: c.id,
      uploaderId: u.id,
      filename: 'fixture.md',
      mimeType: 'text/markdown',
      sizeBytes: 100,
      storageKey: newId(),
      checksumSha256: 'test',
      status: 'EXTRACTED',
    },
  });
  await prisma.documentChunk.create({
    data: {
      documentId: d.id,
      index: 0,
      content: readFileSync(
        join(process.cwd(), 'apps/worker/fixtures/sample-vi-http.md'),
        'utf8',
      ).slice(0, 6000),
      tokenCount: 1500,
    },
  });
  const j = await prisma.aIJob.create({
    data: {
      courseId: c.id,
      requestedById: u.id,
      type: 'GENERATE_LESSONS',
      status: 'QUEUED',
      idempotencyKey: newId(),
      inputParams: {},
    },
  });
  return {
    id: j.id,
    courseId: c.id,
    userId: u.id,
    params: { documentIds: [d.id], language: 'vi' as const, difficulty: 'EASY' as const },
  };
}
afterEach(async () => {
  Object.assign(env, previous);
  for (const s of servers.splice(0)) {
    s.closeAllConnections();
    await new Promise<void>((r) => s.close(() => r()));
  }
  for (const p of publishers.splice(0)) await p.onModuleDestroy();
  for (const id of users.splice(0)) {
    await prisma.course.deleteMany({ where: { ownerId: id } });
    await prisma.user.delete({ where: { id } });
  }
});
describe('processor terminal state preservation', () => {
  it('keeps cancellation when remote computation subsequently times out', async () => {
    const f = await fixture();
    const token = 'terminal-test-token-0123456789abcdef';
    const server = createComputeServer(
      {
        defaultModel: 'mock/1200',
        async generate() {
          await prisma.aIJob.update({ where: { id: f.id }, data: { status: 'CANCELLED' } });
          await new Promise((r) => setTimeout(r, 100));
          throw Error('Provider unavailable after cancellation');
        },
      },
      { token, timeoutMs: 30 },
    );
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const address = server.address();
    if (!address || typeof address === 'string') throw Error('Missing port');
    Object.assign(env, {
      COMPUTE_URL: `http://127.0.0.1:${address.port}`,
      COMPUTE_TOKEN: token,
      COMPUTE_TIMEOUT_MS: 1000,
    });
    const publisher = new RecordingPublisher();
    await new LessonGenerateProcessor(publisher).process({ ...f, aiJobId: f.id });
    expect((await prisma.aIJob.findUniqueOrThrow({ where: { id: f.id } })).status).toBe(
      'CANCELLED',
    );
    expect(await prisma.lesson.count({ where: { aiJobId: f.id } })).toBe(0);
    expect(publisher.events.some((e) => e.status === 'FAILED')).toBe(false);
  });
  it('keeps successful committed lessons when success-event publication fails', async () => {
    const f = await fixture();
    Object.assign(env, { COMPUTE_URL: '' });
    const publisher = new RecordingPublisher(true);
    await new LessonGenerateProcessor(publisher).process({ ...f, aiJobId: f.id });
    expect((await prisma.aIJob.findUniqueOrThrow({ where: { id: f.id } })).status).toBe(
      'SUCCEEDED',
    );
    expect(await prisma.lesson.count({ where: { aiJobId: f.id } })).toBeGreaterThan(0);
    expect(publisher.events.some((e) => e.status === 'FAILED')).toBe(false);
  });
});
