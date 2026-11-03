# LEARN backend

Read `docs/progress/STATE.md`, `docs/progress/CHECKLIST.md`, and `docs/STRUCTURE.md` before changes.

- Backend implementation only; web/mobile consume versioned API artifacts.
- Preserve `/api/v1`, cookie/native refresh, ownership, quotas and grading.
- Validate external input with Zod; TypeScript strict; no explicit `any`.
- Never expose answers before submission or commit secrets/private backups.
- Never reset existing databases or rewrite applied migrations. Use the isolated test stack.
- Contract changes require hash, release and compatibility verification.
- Update STATE, CHECKLIST and session-log with real evidence; mocks are not live integration.
