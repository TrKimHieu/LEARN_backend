import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

const base = 'http://127.0.0.1:4400/api/v1';
if (
  process.env.NODE_ENV !== 'test' ||
  !process.env.DATABASE_URL?.startsWith('postgresql://learn_m1:learn_m1@127.0.0.1:15432/learn_m1')
)
  throw new Error('Workflow requires the isolated sandbox runner');
let checks = 0;
async function request(
  path,
  {
    method = 'GET',
    body,
    token,
    native = false,
    cookie,
    expected = method === 'POST' ? 201 : 200,
  } = {},
) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(native ? { 'x-learn-client': 'native' } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  assert.equal(response.status, expected, `${method} ${path}: unexpected status (body suppressed)`);
  checks++;
  const value = await response.json();
  return {
    value,
    cookie: response.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; '),
    headers: response.headers,
  };
}
const id = randomUUID();
const credentials = { email: `m1-${id}@example.invalid`, password: 'M1-only-test-password' };
const web = await request('/auth/register', {
  method: 'POST',
  body: { ...credentials, displayName: 'M1 Learner' },
  expected: 201,
});
assert.ok(web.headers.getSetCookie().some((c) => /httponly/i.test(c)));
assert.equal(web.value.refreshToken, undefined);
const native = await request('/auth/login', { method: 'POST', body: credentials, native: true });
assert.ok(native.value.refreshToken);
const rotated = await request('/auth/refresh', {
  method: 'POST',
  native: true,
  body: { refreshToken: native.value.refreshToken },
});
assert.notEqual(rotated.value.refreshToken, native.value.refreshToken);
const token = rotated.value.accessToken;
const course = (
  await request('/courses', {
    method: 'POST',
    native: true,
    token,
    body: { title: 'M1 isolated course', language: 'vi' },
    expected: 201,
  })
).value;
const workspace = (await request('/workspace', { token: web.value.accessToken })).value;
assert.ok(workspace.courses.some((c) => c.id === course.id));
const other = await request('/auth/register', {
  method: 'POST',
  body: {
    email: `m1-other-${id}@example.invalid`,
    password: credentials.password,
    displayName: 'M1 Other',
  },
  expected: 201,
});
await request(`/courses/${course.id}`, { token: other.value.accessToken, expected: 404 });
const document = readFileSync(
  new URL('../../apps/worker/fixtures/sample-vi-http.md', import.meta.url),
);
const upload = (
  await request(`/courses/${course.id}/documents/upload-url`, {
    method: 'POST',
    token,
    body: {
      filename: 'sample.md',
      mimeType: 'text/markdown',
      sizeBytes: document.length,
      checksumSha256: createHash('sha256').update(document).digest('hex'),
    },
    expected: 201,
  })
).value;
const put = await fetch(upload.uploadUrl, { method: 'PUT', body: document });
assert.ok(put.ok, 'presigned PUT failed');
checks++;
await request(`/documents/${upload.documentId}/confirm`, {
  method: 'POST',
  token,
  body: { sizeBytes: document.length },
  expected: 201,
});
async function poll(read, done, label) {
  for (let i = 0; i < 120; i++) {
    const value = await read();
    if (done(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`${label} timed out`);
}
await poll(
  async () => (await request(`/courses/${course.id}/documents`, { token })).value,
  (v) => (v.documents ?? v).some((d) => d.id === upload.documentId && d.status === 'EXTRACTED'),
  'extraction',
);
const job = (
  await request(`/ai/courses/${course.id}/generate-lessons`, {
    method: 'POST',
    token,
    body: { documentIds: [upload.documentId], difficulty: 'EASY', language: 'vi' },
    expected: 201,
  })
).value;
await poll(
  async () => (await request(`/ai/jobs/${job.id}`, { token })).value,
  (v) => {
    if (v.status === 'FAILED')
      throw new Error('Generation failed (details in private sandbox log)');
    return v.status === 'SUCCEEDED';
  },
  'generation',
);
const lessons = (await request(`/courses/${course.id}/lessons`, { token: web.value.accessToken }))
  .value;
const lesson = (lessons.lessons ?? lessons)[0];
assert.ok(lesson);
const exercise = (await request(`/lessons/${lesson.id}/exercise`, { token })).value;
for (const question of exercise.questions) {
  assert.equal(question.correctAnswer, undefined);
  for (const option of question.options) assert.equal(option.isCorrect, undefined);
}
const answers = exercise.questions.map((q) =>
  q.type === 'MULTIPLE_CHOICE'
    ? { type: q.type, questionId: q.id, optionId: q.options[0].id }
    : q.type === 'TRUE_FALSE'
      ? { type: q.type, questionId: q.id, value: false }
      : { type: q.type, questionId: q.id, text: 'example answer' },
);
const submitted = (
  await request(`/lessons/${lesson.id}/exercise/submit`, {
    method: 'POST',
    token,
    body: { exerciseId: exercise.id, answers, durationMs: 1000 },
    expected: 201,
  })
).value;
assert.ok(submitted.id);
assert.ok(submitted.results.length);
const history = (await request('/progress/history', { token: web.value.accessToken })).value;
assert.ok(history.items.some((item) => item.exerciseId === exercise.id));
await request('/progress/overview', { token: web.value.accessToken });
await request('/auth/refresh', { method: 'POST', cookie: web.cookie });
await request('/auth/logout', {
  method: 'POST',
  token,
  native: true,
  body: { refreshToken: rotated.value.refreshToken },
});
await request('/auth/refresh', {
  method: 'POST',
  native: true,
  body: { refreshToken: rotated.value.refreshToken },
  expected: 401,
});
console.log(
  JSON.stringify({
    status: 'passed',
    checks,
    scope:
      'web/native auth, shared course, IDOR, presigned upload, extraction, mock-LLM generation, hidden answers, submit and progress',
  }),
);
