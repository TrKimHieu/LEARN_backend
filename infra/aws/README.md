# AWS staging delivery (prepared, not deployed)

Use separate EC2 instances/SSM targets for API, worker and optional compute; web has its own target and repository pipeline. Build images contain no source checkout of another team. All targets need Docker, AWS SSM agent, TLS reverse proxy/load balancer for API/web, outbound registry credentials configured locally and least-privilege instance roles. Private images require image pull rights, not application source rights.

Prerequisites still needed: approved AWS account/region, subnet/instance IDs, staging DNS/TLS, GitHub OIDC roles and Expo project. No resource creation or production change has run. Attach tags Project=LEARN, Environment=staging, Service=api|worker|compute|web. Install the reviewed learn-release.sh as /usr/local/bin/learn-release (root-owned 0755). Store per-process configuration at /etc/learn/<service>.env with 0600 permissions; never put secrets into SSM command parameters/logs.

API and worker share staging PostgreSQL/Redis/S3 endpoints, never production. Enable TLS to managed DB/Redis, private routing/security groups and encrypted backups. Core is the sole schema/migration owner. Compute receives only COMPUTE_TOKEN and LLM settings, no DATABASE_URL or REDIS_URL. Do not activate compute until M3 baseline passes.

The deploy workflow checks caller account and target tags, then invokes the host release command with one digest-pinned image. Image push and deploy are separate. A deployment replaces only the selected process and preserves prior containers for rollback; worker stops before replacement to avoid overlapping consumers. Migrations are a separately reviewed job, never automatic app startup.

Rollback: rerun the release workflow with the previous tested digest. Rehearse this on staging, including graceful worker shutdown, queue drain, schema compatibility, health and a completed test job. The script can check process liveness but that does not prove queue correctness. Archive old stopped containers only after evidence retention. No compose down -v or DB reset.

Acceptance checklist: backup restore drill; web course ID visible on installed APK; mobile presigned upload through worker visible on web; cookie/native refresh, role/IDOR/quota; latency/error and queue age/failure metrics; rollback rehearsal; APK auth/upload/deep-link on device. Preserve image digest, contracts hash and app version for every run. Current local sandbox is not AWS staging.
