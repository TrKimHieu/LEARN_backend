# Updated evidence

The restricted-host limitations below are historical. Current evidence: clean npm ci --ignore-scripts and explicit Prisma generation pass; the previously unreadable file is captured/restored in a supplemental immutable snapshot (1043 files, no mismatches); Docker sandbox with real PostgreSQL/Redis/digest-pinned MinIO passes 21 integration tests and 23 workflow checks. Local full workflows pass with both local and remote compute. See ../progress/STATE.md for outstanding M2/M3/M4 gates. Registry publication, complete response-schema coverage and AWS/device acceptance are still pending.

---

# M0 / M1 acceptance evidence

Status: **implementation prepared; full milestone acceptance pending external verification**.

M0 snapshots are in the administrator workspace `.migration-backups/m0-20261103`, outside this repository. They may contain private local configuration and must never be published. Four Git bundles were verified; existing staged/unstaged changes and accessible working-tree files were restored and compared by SHA-256 and binary diff content. Counts: LEARN 562, mobile 156, server 581, website 1042. One original document (`LEARN_website/docs/STRUCTURE.md`) was not readable; its committed history is bundled but its current raw bytes remain unverified. Git porcelain stat metadata can differ after the Windows restore; exact captured file hashes and staged/unstaged diffs are the semantic checks.

M1 contains API/worker source only, selected from the completed `domains/core/infra` implementation in the website snapshot. Source/ref/path/checksum mapping is in `source-manifest.json`; alternative implementations and restored tests are recorded in `reconciliation.json`. Five legacy unit suites and three integration suites were recovered from the server source instead of being dropped with the old module paths. Database schema and migration files remain byte-identical; `database-file-checksums.json` records both sides. No existing database or volume was changed.

The restricted host denies registry sockets. Offline npm install lacks required tarballs. `verification-toolchain.json` records the installed public packages materialized at matching lockfile versions solely for local verification; workspace links point within this repository. This does not satisfy the clean-install acceptance gate. Normal CI starts from `npm ci` and may not use the materializer.

Verified locally: Prisma generation, strict typecheck, backend unit tests, API/worker build, contract release tests, sandbox configuration guard and isolated SDK consumer installation/runtime/types. Exact final command counts/results are also recorded in progress. The SDK candidate is local `@learn/api-contracts@1.0.0`; it is not registry-published. It carries public DTO/Zod code and declarations only. The companion OpenAPI inventories 55 controller operations, preserves HTTP status/native mode/query names, and explicitly marks incomplete response DTOs and untyped query objects. No claim of complete response-schema coverage is made.

Full integration was **not run**: Docker daemon is unavailable, WSL access is denied, and isolated PostgreSQL/Redis/MinIO ports are not listening. `npm run sandbox:verify` fails fast with exit 2 rather than connecting to an existing database or treating a mock as success. The prepared runner applies existing migrations/test seed, launches compiled API/worker, executes auth/quota suites, then verifies native/web sessions, shared course, ownership rejection, presigned upload, extraction, mock-LLM generation, hidden pre-submit answers, submission and progress.

Independent review found four implementation defects: raw-response POST status inference, missing native logout header, missing named query parameters, and unsafe fixture cleanup after setup failure. These were corrected with regression coverage; original 201 expectations in the recovered auth integration tests are retained, consistent with Nest setting the response status before invoking a handler.

Remaining gates: read/verify the inaccessible original document; clean registry install; live test stack/integration; reviewed registry publication/access from a client-only identity; complete remaining response DTOs before presenting the OpenAPI as fully typed. AWS deploy, service decomposition, mobile/web source changes and production migration are outside M0/M1 execution here.

Final code baseline b725243: Backend CI41596070867 and immutable image publication41596105093 both SUCCESS. Added real PostgreSQL connection_limit=1 quota regression: RED pool exhaustion -> GREEN after transaction-scoped plan reads. All21 integration tests plus23 workflow checks pass per local/remote mode. Anonymous GHCR token requests401 for all3 published images; actual team ACL/history acceptance remains pending. APK complete and v2 signature verified. See release-evidence.json and workspace M2_M4_STATUS.md.
