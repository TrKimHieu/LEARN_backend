import { describe, expect, it } from 'vitest';
import { AiService } from '../ai.service';

const row = {
  id: 'j1',
  courseId: 'c1',
  documentId: null,
  type: 'GENERATE_LESSONS',
  status: 'RUNNING',
  progress: 40,
  progressLabel: 'Đang soạn bài',
  error: null,
  queuedAt: new Date('2026-11-04T00:00:00Z'),
  startedAt: null,
  finishedAt: null,
};

describe('AiService.listJobs', () => {
  it('trả dữ liệu job thật, JSON hoá được', async () => {
    const service = Object.create(AiService.prototype) as AiService;
    Object.assign(service, { jobs: { listOwned: async () => [row] } });

    const result = await service.listJobs('u1', 'c1');

    const json = JSON.parse(JSON.stringify(result)) as { jobs: Array<{ id?: string }> };
    expect(json.jobs[0]?.id).toBe('j1');
  });
});
