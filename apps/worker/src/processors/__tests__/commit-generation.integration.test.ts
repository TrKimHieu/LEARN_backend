import { afterEach, describe, expect, it } from 'vitest';
import { prisma, newId } from '@learn/db';
import { commitGeneration } from '../commit-generation';

if (
  process.env.NODE_ENV !== 'test' ||
  process.env.DATABASE_URL !==
    'postgresql://learn_m1:learn_m1@127.0.0.1:15432/learn_m1?schema=public'
)
  throw Error('Fixed M1 sandbox required');
const users: string[] = [];
async function fixture(status: 'RUNNING' | 'CANCELLED') {
  const user = await prisma.user.create({
    data: {
      email: `commit-${newId()}@example.invalid`,
      passwordHash: 'test-only',
      displayName: 'Commit fixture',
    },
  });
  users.push(user.id);
  const course = await prisma.course.create({
    data: { ownerId: user.id, title: 'Generation commit fixture' },
  });
  const job = await prisma.aIJob.create({
    data: {
      courseId: course.id,
      requestedById: user.id,
      type: 'GENERATE_LESSONS',
      idempotencyKey: newId(),
      inputParams: {},
      status,
    },
  });
  const rows = {
    lessons: [
      {
        id: newId(),
        courseId: course.id,
        aiJobId: job.id,
        title: 'Lesson',
        summary: 'Summary',
        contentMd: 'Content',
        orderIndex: 0,
        estimatedMinutes: 3,
        sourceChunkIds: [],
      },
    ],
    exercises: [],
    questions: [],
    options: [],
  };
  return { job, rows };
}
afterEach(async () => {
  for (const id of users.splice(0)) {
    await prisma.course.deleteMany({ where: { ownerId: id } });
    await prisma.user.delete({ where: { id } });
  }
});
describe('atomic generation persistence on real PostgreSQL', () => {
  it('cannot persist a result after cancellation', async () => {
    const { job, rows } = await fixture('CANCELLED');
    expect(await commitGeneration(job.id, rows)).toBe(false);
    expect(await prisma.lesson.count({ where: { aiJobId: job.id } })).toBe(0);
    expect((await prisma.aIJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe(
      'CANCELLED',
    );
  });
  it('concurrent replay commits exactly one batch and one terminal state', async () => {
    const { job, rows } = await fixture('RUNNING');
    const outcomes = await Promise.all([
      commitGeneration(job.id, rows),
      commitGeneration(job.id, rows),
    ]);
    expect(outcomes.sort()).toEqual([false, true]);
    expect(await prisma.lesson.count({ where: { aiJobId: job.id } })).toBe(1);
    expect((await prisma.aIJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe(
      'SUCCEEDED',
    );
  });
});
