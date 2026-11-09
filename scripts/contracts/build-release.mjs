import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, cpSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { z } from 'zod';
import { controllerOperations } from './catalog.mjs';

const root = resolve(import.meta.dirname, '../..');
// Phiên bản phát hành: `--version x.y.z` hoặc mặc định bên dưới. Cùng major 1 với bản app đang dùng.
const version = process.argv.includes('--version')
  ? process.argv[process.argv.indexOf('--version') + 1]
  : '1.1.0';
if (!/^1\.\d+\.\d+$/.test(version)) throw new Error(`Unsupported contracts version: ${version}`);
const out = resolve(
  process.argv.includes('--out')
    ? process.argv[process.argv.indexOf('--out') + 1]
    : join(root, 'artifacts/api-contracts', version),
);
const sdk = join(out, 'sdk');
mkdirSync(sdk, { recursive: true });
mkdirSync(join(root, '.local'), { recursive: true });
const work = mkdtempSync(join(root, '.local/contracts-'));
const modules = [
  'common',
  'auth',
  'course',
  'document',
  'document-types',
  'lesson',
  'exercise',
  'progress',
  'subscription',
  'ai',
  'admin',
  'meta',
  'version',
  'index',
];
const src = join(root, 'packages/contracts/src');
const options = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.CommonJS,
  moduleResolution: ts.ModuleResolutionKind.Node10,
  strict: true,
  skipLibCheck: true,
  esModuleInterop: true,
  declaration: true,
  removeComments: true,
  sourceMap: false,
  rootDir: src,
  outDir: join(work, 'dist'),
};
const program = ts.createProgram(
  modules.map((m) => join(src, `${m}.ts`)),
  options,
);
const diagnostics = ts.getPreEmitDiagnostics(program);
if (diagnostics.length)
  throw new Error(
    ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCurrentDirectory: () => root,
      getCanonicalFileName: (p) => p,
      getNewLine: () => '\n',
    }),
  );
program.emit();
cpSync(join(work, 'dist'), join(sdk, 'dist'), { recursive: true });
writeFileSync(
  join(sdk, 'package.json'),
  JSON.stringify(
    {
      name: '@learn/api-contracts',
      version,
      description: 'LEARN public API v1 DTOs and Zod schemas',
      main: './dist/index.js',
      types: './dist/index.d.ts',
      exports: {
        '.': { types: './dist/index.d.ts', require: './dist/index.js', default: './dist/index.js' },
      },
      files: ['dist', 'README.md'],
      peerDependencies: { zod: '^4.6.4' },
      license: 'UNLICENSED',
    },
    null,
    2,
  ) + '\n',
);
writeFileSync(
  join(sdk, 'README.md'),
  `# LEARN API contracts ${version}\n\n` +
    'Public DTOs and runtime Zod schemas only. Install with Zod 4.6.4 or a compatible version. Web/native authentication state remains the responsibility of each client. The accompanying OpenAPI describes structural validation; server-side refinements, authorization and quota checks remain authoritative. No application implementation or source maps are shipped.\n',
);

const require = createRequire(join(root, 'package.json'));
const schemas = require(join(work, 'dist/index.js'));
const operations = controllerOperations(root);
const inputs = new Set(operations.map((o) => o.body).filter(Boolean));
inputs.add('nativeRefreshSchema');
const components = {};
for (const [key, value] of Object.entries(schemas)) {
  if (key.endsWith('Schema') && value && typeof value.safeParse === 'function') {
    const generated = z.toJSONSchema(value, {
      io: inputs.has(key) ? 'input' : 'output',
      unrepresentable: 'any',
    });
    delete generated.$schema;
    components[key] = generated;
  }
}
const ref = (schema) => ({ $ref: `#/components/schemas/${schema}` });
const publicPath = (p) =>
  /^\/api\/v1\/(health(?:\/ready)?|meta|plans|webhooks\/stripe|auth\/(register|login|refresh|forgot-password|reset-password))$/.test(
    p,
  );
const paths = {};
for (const operation of operations) {
  const { path, method, body, status, operationId } = operation;
  const response = {
    description: 'Success; response shape is documented only when backed by a canonical Zod DTO.',
  };
  const entry = {
    operationId,
    tags: [path.split('/')[3]],
    security: publicPath(path) ? [] : [{ bearerAuth: [] }],
    responses: {
      [status]: response,
      default: {
        description: 'RFC 7807 API error',
        content: { 'application/json': { schema: ref('errorSchema') } },
      },
    },
    parameters: [...path.matchAll(/\{([^}]+)\}/g)].map((m) => ({
      name: m[1],
      in: 'path',
      required: true,
      schema: { type: 'string' },
    })),
  };
  entry.parameters.push(
    ...operation.queries.map((name) => ({
      name,
      in: 'query',
      required: false,
      schema: { type: 'string' },
    })),
  );
  if (operation.untypedQueryObject) entry['x-query-schema-status'] = 'untyped-query-object';
  if (body) {
    if (!components[body]) throw new Error(`No exported canonical body schema: ${body}`);
    entry.requestBody = { required: true, content: { 'application/json': { schema: ref(body) } } };
  }
  let responseSchema;
  if (/\/auth\/(register|login|refresh)$/.test(path)) {
    responseSchema = { oneOf: [ref('authResponseSchema'), ref('nativeAuthResponseSchema')] };
  }
  if (/\/auth\/(register|login|refresh|logout)$/.test(path)) {
    entry.parameters.push({
      name: 'x-learn-client',
      in: 'header',
      required: false,
      schema: { type: 'string', enum: ['native'] },
      description:
        'Native: refresh token in body; web: httpOnly cookie. Never read web cookies in native mode.',
    });
  }
  if (/\/auth\/(refresh|logout)$/.test(path))
    entry.requestBody = {
      required: false,
      description: 'Required with x-learn-client: native; web uses its refresh cookie.',
      content: { 'application/json': { schema: ref('nativeRefreshSchema') } },
    };
  if (path === '/api/v1/meta') responseSchema = ref('metaResponseSchema');
  if (path === '/api/v1/auth/me' && method === 'get') responseSchema = ref('meResponseSchema');
  if (
    (/\/courses\/\{id\}$/.test(path) && ['get', 'patch'].includes(method)) ||
    (path === '/api/v1/courses' && method === 'post')
  )
    responseSchema = ref('courseDetailSchema');
  if (path === '/api/v1/lessons/{lessonId}/exercise' && method === 'get')
    responseSchema = ref('exerciseReadSchema');
  if (path === '/api/v1/lessons/{lessonId}/exercise/submit')
    responseSchema = ref('submissionSchema');
  if (responseSchema) response.content = { 'application/json': { schema: responseSchema } };
  else entry['x-response-schema-status'] = 'not-yet-typed';
  if (path.endsWith('/stream')) {
    response.content = { 'text/event-stream': { schema: { type: 'string' } } };
    entry.description = 'Authenticated SSE stream; use a client supporting authorization headers.';
  }
  paths[path] ??= {};
  paths[path][method] = entry;
}
const api = {
  openapi: '3.1.0',
  info: {
    title: 'LEARN public API',
    version,
    description:
      'Generated route inventory and structural schemas. Untyped responses are marked explicitly; this is not a claim of complete response DTO coverage. Custom Zod refinements and ownership/quota checks are enforced by the server.',
  },
  servers: [
    {
      url: 'http://127.0.0.1:4400',
      description: 'Isolated M1 sandbox (requires real test services)',
    },
  ],
  paths,
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
    schemas: components,
  },
};
const fixtures = {
  mode: 'synthetic-contract-fixtures',
  requests: {
    registerSchema: {
      email: 'learner@example.invalid',
      password: 'example-only-password',
      displayName: 'Example Learner',
      locale: 'vi',
    },
    loginSchema: { email: 'learner@example.invalid', password: 'example-only-password' },
    createCourseSchema: { title: 'Example course', language: 'vi' },
    nativeRefreshSchema: { refreshToken: 'example-only-not-a-real-refresh-token' },
  },
  responses: {
    meta: { apiVersion: 'v1', contractsHash: schemas.CONTRACTS_HASH, minMobileVersion: '1.0.0' },
  },
};
writeFileSync(join(out, 'openapi.json'), JSON.stringify(api, null, 2) + '\n');
writeFileSync(join(out, 'mock-fixtures.json'), JSON.stringify(fixtures, null, 2) + '\n');
const hash = (data) => createHash('sha256').update(data).digest('hex');
const checksums = Object.fromEntries(
  ['openapi.json', 'mock-fixtures.json'].map((f) => [f, hash(readFileSync(join(out, f)))]),
);
for (const f of readdirSync(join(sdk, 'dist')))
  checksums[`sdk/dist/${f}`] = hash(readFileSync(join(sdk, 'dist', f)));
writeFileSync(
  join(out, 'release.json'),
  JSON.stringify(
    {
      name: '@learn/api-contracts',
      version,
      contractsHash: schemas.CONTRACTS_HASH,
      operations: operations.length,
      responseSchemasIncomplete: operations
        .filter((o) => paths[o.path][o.method]['x-response-schema-status'])
        .map((o) => `${o.method.toUpperCase()} ${o.path}`),
      files: checksums,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  JSON.stringify({
    version,
    contractsHash: schemas.CONTRACTS_HASH,
    operations: operations.length,
    out,
  }),
);
