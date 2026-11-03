# LEARN shared backend

Private backend source for web and mobile clients maintained in separate repositories. API and worker remain separate processes; no microservice/data split is performed in M0/M1.

## Setup

Use Node 22+ and npm. Run from this directory:

```sh
npm ci
npm run db:generate
npm run lint
npm run typecheck
npm test
npm run test:tooling
npm run build
```

`npm ci` is the reproducibility gate. The current restricted environment cannot fetch every dependency; a locally materialized, lock-version-matched toolchain was used for verification. Its checks are not proof of a clean registry install. Details are in `docs/migration/verification-toolchain.json`.

## Client contracts

```sh
npm run contracts:hash
npm run contracts:pack
npm run contracts:consumer
```

Local candidate `@learn/api-contracts@1.0.0` and companion OpenAPI, synthetic fixtures, checksums and consumer evidence are written under `artifacts/api-contracts/1.0.0`. Nothing is published to a registry by these commands. A publisher can later ship the reviewed package to a registry that supports download without access to backend source.

The package contains only compiled canonical DTO/Zod definitions and TypeScript declarations, with Zod as a peer. It does not contain server code, Prisma, AI prompts or source maps. The route inventory covers the real controllers; response payloads without a canonical Zod DTO are explicitly marked `not-yet-typed`. Zod refinements and authorization/quota rules remain enforced on the server. This candidate is not yet live-integration accepted.

Contracts hash and min mobile version remain necessary for older installed applications. Pin artifact versions in each client's lockfile; do not replace compatibility policy with an exact hash equality requirement.

## Isolated M1 sandbox

Requires a running Docker daemon and the images referenced by the Compose file. This stack uses its own database name, role, ports and volumes:

```sh
npm run sandbox:up
npm run build
npm run sandbox:verify
npm run sandbox:stop
```

The verifier checks PostgreSQL `15432`, Redis `16379` and MinIO `19000`, then applies existing migrations and test seed only to `learn_m1`. It starts the compiled API on loopback `4400` and worker with mock LLM, runs restored auth/quota integration suites and the upload → extract → generate → submit/progress workflow. Logs stay in ignored `.local/sandbox.log`; they may contain test session/reset details and must not be published. It refuses to reuse an unknown API or an existing application database.

No production/dev database or volume is reset. `sandbox:stop` retains the isolated data for diagnosis. The MinIO images currently inherit upstream dev tags; pin reviewed digests before production use.

See `docs/STRUCTURE.md`, `docs/migration/` and `docs/progress/STATE.md` for provenance, results and unresolved gates.
