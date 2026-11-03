# Backend structure

- `apps/api/src/domains/<domain>/{presentation,application,infrastructure}`: HTTP → business rules → repository.
- `apps/api/src/{core,infra,modules,bootstrap}`: security/errors, external adapters, health/meta, request ID.
- `apps/worker/src/{processors,extraction,common}`: document extraction and lesson generation.
- `packages/contracts`: canonical Zod API schemas; `scripts/contracts` produces client-safe releases.
- `packages/db`: existing Prisma schema/migrations; generate client locally, never track it.
- `packages/ai`: private provider, prompt, chunking and validation implementation.
- `packages/config`: backend TypeScript, ESLint, Prettier and Vitest.
- `infra`: backend images and isolated test stack; no web/mobile source or manifests.
- `docs/migration`: provenance, reconciliation and acceptance evidence.
- `artifacts`: generated releases and logs, ignored by Git.
- `scripts/contracts`: SDK/OpenAPI generation, packaging tests and isolated consumer verification.
- `scripts/sandbox`: fixed test environment and live integration runner; never uses existing DBs.
- `apps/api/src/integration`: legacy auth/quota suites restored with sandbox-only safety guards.

No web/mobile implementation or `packages/ui` is part of this repository.

- `apps/compute`: opt-in stateless LLM HTTP process, no database credentials.
- `packages/ai/src/compute`: internal protocol and bounded HTTP implementation.
- `apps/worker/src/processors/commit-generation.ts`: atomic job terminal state and lesson persistence.
- `scripts/deploy` and `infra/aws`: digest-pinned SSM delivery plan and reviewed host script.
