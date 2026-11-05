import { pathToFileURL } from 'node:url';

export async function checkApiReadiness(origin, request = fetch) {
  try {
    const response = await request(new URL('/api/v1/health/ready', origin), {
      signal: AbortSignal.timeout(10000),
    });
    return response.ok && (await response.json()).status === 'ready';
  } catch {
    return false;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const ready = await checkApiReadiness(process.env.APP_URL);
  console.log(ready ? 'API is ready' : 'API is not ready');
  process.exitCode = ready ? 0 : 1;
}
