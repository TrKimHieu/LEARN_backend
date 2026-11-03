import { describe, it, expect } from 'vitest';
import { deleteFixtureCourses } from './safety';

describe('integration cleanup ownership', () => {
  it('does not invoke database cleanup if fixture creation failed', async () => {
    const owners: string[] = [];
    await deleteFixtureCourses(undefined, async (id) => {
      owners.push(id);
    });
    expect(owners).toEqual([]);
  });
  it('passes only the established fixture owner to deletion', async () => {
    const owners: string[] = [];
    await deleteFixtureCourses('fixture-owner', async (id) => {
      owners.push(id);
    });
    expect(owners).toEqual(['fixture-owner']);
  });
});
