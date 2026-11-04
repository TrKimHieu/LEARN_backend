# Session log

| Date       | Work                                     | Verification                                                                                                                                  | Decision                                                                                                       |
| ---------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 2026-11-03 | M0 restore and backend-only M1 source    | Hashes and patch content match; one unreadable document recorded                                                                              | Original repos unchanged; no existing DB used. Clean install and live integration unverified.                  |
| 2026-11-03 | M1 contract candidate and sandbox runner | Prisma/lint/typecheck/build pass; 255 unit + 4 tooling tests pass; isolated tarball consumer runtime/types pass. Reviewer findings corrected. | Clean npm install, live integration, raw unreadable document and registry publication remain acceptance gates. |

## Execution through M4 ? updated environment

# Execution status through M4

M0: supplementary full website snapshot now reads/restores all 1043 files, with staged/unstaged patches equal. Original immutable snapshot remains preserved. Other three original snapshots already verified. No original application source changed.

M1: network and Docker available under updated permissions. Clean npm ci --ignore-scripts passed; Prisma explicitly generated; real PostgreSQL/Redis/digest-pinned MinIO sandbox passes auth/quota integration and full upload/extract/generate/submit/progress workflow. Contracts 1.0.0 retain f93391e681bf and are distributed as identical SHA256-pinned tarballs in each standalone client. Registry publication and incomplete OpenAPI response types remain explicit, not claimed complete.

M2: application-only web/mobile snapshots and fresh local histories; original repos preserved. Web lint/typecheck/24 tests/build; mobile typecheck/42 tests/Expo export, lint 37 warnings and zero errors. Actual clean-clone checks and remote mapping/ACL acceptance still being finalized. User requests existing GitHub repos; only LEARN_website and LEARN_mobile exist for LEARN. Backend destination requested from user. Existing website history contains backend, so ACL/history separation is not accepted merely from a new branch.

M3: four images build and run locally, API/web/compute return HTTP 200 and worker stays running. Independent image/APK and guarded SSM staging workflows prepared. EAS project trankimhieu/learn-mobile created and linked; build 2460bdda-df0c-43d4-b667-2685f0a67851 submitted, status pending. No AWS account/region/target identified; AWS staging, device walkthrough, live rollback/backup drills not performed.

M4: stateless compute pilot implemented, default off. Five HTTP behavior tests and adapter wiring regression pass. Local-vs-remote full sandbox comparison passes. New atomic generation commit prevents cancelled/replayed jobs from writing lessons, verified by two real PostgreSQL tests. Cloud scaling/restart/cancellation/rollback acceptance and metrics baseline pending M3.

Final independent review: guarded FAILED transition preserves CANCELLED after remote timeout and SUCCEEDED after Redis publication failure. Two processor regressions RED->GREEN on real PostgreSQL/Redis/HTTP. Latest matrix:261 unit,6 tooling,20 integration plus23 workflow; local and remote pilot pass. Web/mobile clean clones outside workspace pass npm ci/typecheck/test/build or export; GitHub CI succeeds. Draft PRs website#1 and mobile#1; original main branches unchanged. Cloud and remote history/ACL acceptance pending. See workspace M2_M4_STATUS.md for explicit rulings and deferred minors.

Created private GitHub backend after explicit user approval; published baseline. Image pipeline41593708923 success, refs and compatibility metadata captured manually in docs/migration/release-evidence.json. APK completed, SHA256941bb9f799953f8f92825af13f6ea3b939a8f4065a8c078c1b80036a2b246619, Android v2 signature verified with official apksig8.13.2. Backend CI typecheck caught fixture import.meta under CommonJS; fixed ef20d3d, local fail-fast typecheck20integration+23workflow pass; corrected remote CI pending. Package visibility query denied read:packages scope, so access isolation is still not accepted.

Final CI diagnosis/fix complete: UsageService plan reads now use held transaction to prevent pool starvation. One-connection real regression redP2024->green, local matrix261unit/6tooling/21integration+23workflow per mode. GitHub CI41596070867 SUCCESS and image workflow41596105093 SUCCESS on b725243. Release metadata updated with corrected digests. AWS target still unknown; no staging deployment, source ACL or device acceptance claimed.

CI/CD (chưa chạy trên GitHub/AWS): thay images.yml + staging.yml (GHCR, chạy tay, mỗi dịch vụ một máy) bằng release.yml + deploy.yml: push main chạy CI, build image lên ECR qua OIDC, host EC2 pull theo digest qua SSM, tự khôi phục khi health check lỗi, production cần duyệt. Bằng chứng cục bộ: actionlint và cfn-lint sạch, 9 test release (5 test script host chạy trong container Linux với docker/aws giả), compose config hợp lệ, build được 3 image backend. Chưa tạo tài nguyên AWS.
