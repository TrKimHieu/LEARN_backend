/** Integration suites create/delete users; never run them on an existing application DB. */
export function requireSandbox(): string {
  const database = process.env.DATABASE_URL;
  if (
    process.env.NODE_ENV !== 'test' ||
    database !== 'postgresql://learn_m1:learn_m1@127.0.0.1:15432/learn_m1?schema=public'
  ) {
    throw new Error(
      'Integration tests require the isolated M1 sandbox. Run npm run sandbox:verify.',
    );
  }
  return 'http://127.0.0.1:4400';
}

export async function deleteFixtureCourses(
  ownerId: string | undefined,
  remove: (ownerId: string) => Promise<unknown>,
): Promise<void> {
  if (!ownerId) return;
  await remove(ownerId);
}
