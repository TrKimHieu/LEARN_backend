# Execution status through M4

M0: supplementary full website snapshot now reads/restores all 1043 files, with staged/unstaged patches equal. Original immutable snapshot remains preserved. Other three original snapshots already verified. No original application source changed.

M1: network and Docker available under updated permissions. Clean npm ci --ignore-scripts passed; Prisma explicitly generated; real PostgreSQL/Redis/digest-pinned MinIO sandbox passes auth/quota integration and full upload/extract/generate/submit/progress workflow. Contracts 1.0.0 retain f93391e681bf and are distributed as identical SHA256-pinned tarballs in each standalone client. Registry publication and incomplete OpenAPI response types remain explicit, not claimed complete.

M2: application-only web/mobile snapshots and fresh local histories; original repos preserved. Web lint/typecheck/24 tests/build; mobile typecheck/42 tests/Expo export, lint 37 warnings and zero errors. Clean-clone checks outside the workspace pass; remote ACL/history acceptance is pending. User confirmed a third repository: private TrKimHieu/LEARN_backend has been created and published. Web/mobile are draft PRs in existing repositories. Existing website history contains backend, so ACL/history separation is not accepted merely from a new branch.

M3: four images build and run locally, API/web/compute return HTTP 200 and worker stays running. Independent image/APK and guarded SSM staging workflows prepared. EAS project trankimhieu/learn-mobile created and linked; build 2460bdda-df0c-43d4-b667-2685f0a67851 FINISHED. APK downloaded (110791925 bytes) with SHA256 and Android signature v2 verified. No AWS account/region/target identified; AWS staging, device walkthrough, live rollback/backup drills not performed.

M4: stateless compute pilot implemented, default off. Five HTTP behavior tests and adapter wiring regression pass. Local-vs-remote full sandbox comparison passes. New atomic generation commit prevents cancelled/replayed jobs from writing lessons, verified by two real PostgreSQL tests. Cloud scaling/restart/cancellation/rollback acceptance and metrics baseline pending M3.

Backend image pipeline41593708923 successfully published three immutable GHCR references. Backend CI initially exposed TS1343 in a test fixture; corrected in ef20d3d and fail-fast local typecheck/integration pass. Corrected GitHub CI41594317146 is being followed to completion. CLI package metadata access lacks read:packages, so team-only package visibility/download acceptance is not claimed.

Final code baseline b725243: Backend CI41596070867 and immutable image publication41596105093 both SUCCESS. Added real PostgreSQL connection_limit=1 quota regression: RED pool exhaustion -> GREEN after transaction-scoped plan reads. All21 integration tests plus23 workflow checks pass per local/remote mode. Anonymous GHCR token requests401 for all3 published images; actual team ACL/history acceptance remains pending. APK complete and v2 signature verified. See release-evidence.json and workspace M2_M4_STATUS.md.

AWS access check: added a manual-only workflow to check build/staging OIDC roles with STS GetCallerIdentity. No AWS resource mutation or deployment is included. Remote authentication is not yet verified.

AWS staging delivery update: prepared reusable CI, ECR publication, S3 bundle and SSM deployment for the existing onebox host. User reports both manual OIDC jobs green. No application changes or resource creation; AWS release remains unverified.
