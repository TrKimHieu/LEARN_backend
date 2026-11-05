# ECR release to the existing EC2 staging host

This delivery update reuses manually created AWS resources. It does not recreate ECR, IAM, S3 or EC2, and it does not change application source.

## Pipeline

Merge to main runs reusable CI, builds API/worker runtime images and an API builder image for migrations, and pushes commit-SHA tags to ECR learn/api, learn/worker and learn/migrate. Deployment uses their immutable digests. Compose, Caddyfile and the host script are uploaded under onebox/COMMIT_SHA/ in the deploy bucket. The staging job assumes an OIDC role, downloads this bundle through SSM, applies migrations, deploys API/worker and checks the public API readiness URL. Web has a separate repository pipeline. The manual aws-check workflow only checks role assumption.

## Configuration

Repository variables: AWS_ACCOUNT_ID (actual account), AWS_REGION=ap-southeast-2, AWS_BUILD_ROLE_ARN, DEPLOY_BUCKET=learn-deploy-trkimhieu-2026. Leave PRODUCTION_ENABLED unset or false for staging.

The staging GitHub environment needs AWS_DEPLOY_ROLE_ARN, DEPLOY_INSTANCE_ID and APP_URL. Restrict it to main where the GitHub plan supports branch rules. Match the OIDC subject format actually used by the repository, including immutable IDs when applicable; deploy subjects reference environment:staging.

Build role: ECR publish for the three backend repositories and S3 PutObject for onebox/*. Deploy role: DescribeInstances, GetCommandInvocation, and SendCommand limited to AWS-RunShellScript and the target EC2. Host role: AmazonSSMManagedInstanceCore, ECR pull, S3 list/read for onebox/.

## Host

Amazon Linux 2023 x86_64 with Docker, Compose plugin, AWS CLI, bash and flock. Instance tags must be exactly Project=LEARN, Environment=staging, Service=onebox.

Keep /opt/learn/.env root-owned mode 0600, based on infra/onebox/.env.example. Never upload it to GitHub or the deploy bucket. Keep nonempty API_IMAGE, WORKER_IMAGE, WEB_IMAGE and MIGRATE_IMAGE placeholders at bootstrap; each release replaces the relevant image with its digest. DOMAIN, APP_URL and S3_PUBLIC_ENDPOINT must use the same public origin. Update the temporary sslip.io address if the public IP changes.

Application uploads use internal MinIO; its S3_REGION=us-east-1 is independent of AWS_REGION=ap-southeast-2 for ECR/SSM/deploy storage. Allow inbound HTTP/HTTPS and outbound registry/AWS/certificate access; SSM does not require inbound SSH.

Migration does not reset the database or seed accounts. Seed initial plans/admin separately once after migration if needed. AI mock, mail log and demo billing settings do not establish live feature acceptance.

## Rollback and limits

Run deploy manually on main with previous tested API/worker ECR digest references. Leave migrate_image and bundle empty for image-only rollback. Database changes are not reverted; migrations must remain compatible with the previous app.

The host attempts service-level image rollback after a failed health check, provided a previous digest exists. API and worker update separately; a failed public smoke test does not roll back the entire release. Worker liveness does not prove queue processing. Brief service interruptions are expected.

ECR tags are immutable: rebuilding an already-published commit tag may fail on rerun. Reuse known digests through deploy, or publish a new reviewed commit. Preserve deployed images and rollback candidates in registry retention rules.

Backups, restore drills, monitoring, vulnerability blocking and end-to-end staging acceptance remain pending. The deploy bucket is not a DB/document backup. Production requires a separate host/data/secrets and an actual approval gate; it promotes the same tested image digests.
