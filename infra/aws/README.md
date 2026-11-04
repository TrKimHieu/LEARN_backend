# AWS delivery: GitHub Actions to EC2 through ECR

Prepared and tested locally. No AWS resource has been created and no workflow has run on GitHub yet.

```
merge to main
  GitHub Actions: lint, typecheck, tests, build
  build images once, push to ECR by commit SHA (OIDC, no stored AWS keys)
  SSM command to the EC2 host
    host pulls the image by digest using its instance role
    migrations, restart one service, health check, restore previous digest on failure
  smoke test through the public URL
  staging done; production repeats with the same digests after approval
```

CI holds no host credential and no port is opened for it: the host pulls. Web and backend have separate pipelines and share the host, and `learn-release.sh` takes a lock so releases take turns.

## Files

| File | Purpose |
| --- | --- |
| `pipeline.yml` | ECR repositories, deploy bundle bucket, OIDC build role. One stack per AWS account |
| `host.yml` | EC2 host, Elastic IP, firewall, instance role, OIDC deploy role. One stack per environment |
| `learn-release.sh` | Runs on the host, one service at a time |
| `../onebox/compose.yml` | Services on the host |
| `scripts/deploy/release.mjs` | Checks the target and sends the SSM command. Same file in the web repository |
| `.github/workflows/release.yml` | Full pipeline on merge to `main` |
| `.github/workflows/deploy.yml` | Deploy step, also used by hand for rollback |

## First setup

These steps create billable resources. Run them from a shell with AWS administrator credentials.

1. Create the shared stack:

   ```bash
   aws cloudformation deploy --region ap-southeast-1 --stack-name learn-pipeline --template-file infra/aws/pipeline.yml --capabilities CAPABILITY_NAMED_IAM --parameter-overrides GitHubOwner=OWNER WebRepo=WEB_REPO
   ```

2. Create the staging host. `SubnetId` must be a public subnet:

   ```bash
   aws cloudformation deploy --region ap-southeast-1 --stack-name learn-staging --template-file infra/aws/host.yml --capabilities CAPABILITY_NAMED_IAM --parameter-overrides EnvironmentName=staging GitHubOwner=OWNER WebRepo=WEB_REPO VpcId=VPC_ID SubnetId=SUBNET_ID
   ```

3. Point the domain at the stack output `PublicIp`. Without a domain, use `<IP-with-dashes>.sslip.io`.

4. Open a shell on the host with `aws ssm start-session --target INSTANCE_ID`, then create the secrets file. Secrets stay on the host and never pass through GitHub:

   ```bash
   sudo -i
   vi /opt/learn/.env   # fill in from infra/onebox/.env.example, keep every *_IMAGE placeholder
   chmod 600 /opt/learn/.env
   ```

5. In both GitHub repositories, set repository variables `AWS_ACCOUNT_ID`, `AWS_REGION`, `AWS_BUILD_ROLE_ARN` and `DEPLOY_BUCKET` (the last is used by the backend only).

6. In both repositories, create the `staging` environment with variables `AWS_DEPLOY_ROLE_ARN`, `DEPLOY_INSTANCE_ID` and `APP_URL`.

7. Merge to `main` in the backend first, because its bundle installs `learn-release.sh` on the host. Then merge to `main` in the web repository.

## Production

Repeat steps 2 to 4 with `EnvironmentName=production`. Create the `production` GitHub environment with **required reviewers**, then set repository variable `PRODUCTION_ENABLED=true`. The role only trusts jobs running in that environment, so skipping the approval is not possible from a workflow.

## Rollback

Run the `deploy` workflow by hand with the previous digests and leave `migrate_image` and `bundle` empty. Find digests in the previous run's summary or with `aws ecr describe-images`. Rollback does not revert the database, so migrations must stay compatible with the previous image: add first, remove in a later release.

A failed health check during a release already restores the previous digest on its own.

## Not covered yet

- Database and document backups, and a restore drill. Everything lives on one encrypted disk, kept if the instance is terminated, but with no copy elsewhere.
- Blocking on vulnerabilities. ECR scans each image on push, and nothing fails the pipeline on findings yet.
- Monitoring and alerts.
- Zero-downtime restarts. Each service restarts in place, so expect a short interruption.
