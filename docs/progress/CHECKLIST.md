# Milestone acceptance

- [x] M0 full accessible source including formerly unreadable document restored and verified.
- [x] M1 clean dependency install and explicit Prisma generation.
- [x] M1 real isolated services and full workflow pass.
- [x] Identical public contracts 1.0.0 artifact installed in both clients without backend checkout.
- [ ] Complete public response DTO coverage / registry publication as selected distribution channel.
- [x] M2 standalone sources, local config and independent builds.
- [ ] M2 remote three-repo mapping and credential/history source isolation acceptance.
- [x] M3 independent local images and separate CI/release workflow code.
- [ ] M3 successful AWS staging deployment, image rollback, DB restore and cross-client device walkthrough.
- [x] M3 signed APK build completed, downloaded and signature v2 verified.
- [ ] M3 preview API endpoint configured and APK installation/auth/upload/deep-link accepted on device.
- [x] M4 default-off stateless compute and local HTTP/full workflow pilot.
- [x] Atomic core persistence regression on real PostgreSQL for cancellation/replay.
- [ ] M4 cloud baseline, restart/replay/cancel/scale and rollback acceptance.

- [ ] Verify build and staging AWS OIDC roles with the manual Check AWS access workflow on main.

- [ ] Publish and run ECR release on main; verify migration, API readiness and worker processing on the existing staging host.

- [x] Submit `Idempotency-Key`: replay, 409 on body mismatch, per-user keys, concurrent duplicate replay (unit tests on fakes).
- [ ] Apply migration `20261109090000_submission_idempotency_key` on staging and verify a duplicate submit against real PostgreSQL.
- [x] Text import endpoint + contracts 1.1.0 (unit tests on fakes, consumer smoke).
- [ ] Text import against real PostgreSQL/staging from a development build.
- [ ] SRS reviews against real PostgreSQL (backfill query, access filter, FOR UPDATE) and on device offline.
