// Sends one release to the EC2 host through SSM. The host pulls the image; CI never holds a host
// credential or opens a port. Without --apply it only prints the plan.
import { execFileSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

const ECR_DIGEST = /^\d{12}\.dkr\.ecr\.[a-z0-9-]+\.amazonaws\.com\/[a-z0-9_./-]+@sha256:[a-f0-9]{64}$/;
const BUNDLE = /^s3:\/\/[a-z0-9.-]+\/onebox\/[a-f0-9]{40}$/;
const HOME = '/opt/learn';
const TIMEOUT_SECONDS = 900;

export function deploymentPlan({ environment, service, image, account, instance, region, bundle }) {
  if (
    !['staging', 'production'].includes(environment) ||
    !['api', 'worker', 'web', 'migrate'].includes(service) ||
    !/^\d{12}$/.test(account ?? '') ||
    !/^i-[a-f0-9]{17}$/.test(instance ?? '') ||
    !/^[a-z]{2}-[a-z]+-\d$/.test(region ?? '') ||
    !ECR_DIGEST.test(image ?? '') ||
    !image.startsWith(`${account}.dkr.ecr.${region}.`) ||
    (bundle && !BUNDLE.test(bundle))
  ) {
    throw Error('Explicit environment, service, account, region, instance and ECR digest required');
  }
  const commands = [];
  if (bundle) {
    commands.push(
      `aws s3 cp --recursive --region ${region} ${bundle} ${HOME}`,
      `chmod 0755 ${HOME}/learn-release.sh`,
    );
  }
  commands.push(`${HOME}/learn-release.sh ${service} ${image}`);
  return {
    DocumentName: 'AWS-RunShellScript',
    InstanceIds: [instance],
    TimeoutSeconds: TIMEOUT_SECONDS,
    Parameters: { commands, executionTimeout: [String(TIMEOUT_SECONDS)] },
    Comment: `LEARN ${environment} ${service} release`,
  };
}

export function isTargetHost(target, environment) {
  const tags = Object.fromEntries((target?.Tags ?? []).map((tag) => [tag.Key, tag.Value]));
  return (
    tags.Project === 'LEARN' &&
    tags.Environment === environment &&
    tags.Service === 'onebox' &&
    target?.State?.Name === 'running'
  );
}

const FINISHED = ['Success', 'Failed', 'Cancelled', 'TimedOut'];

async function apply(input, plan) {
  const aws = (...args) =>
    JSON.parse(
      execFileSync('aws', [...args, '--region', input.region, '--output', 'json'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    );
  if (aws('sts', 'get-caller-identity').Account !== input.account) {
    throw Error('AWS account mismatch');
  }
  const target = aws('ec2', 'describe-instances', '--instance-ids', input.instance).Reservations?.[0]
    ?.Instances?.[0];
  if (!isTargetHost(target, input.environment)) {
    throw Error(`Target is not the running LEARN ${input.environment} host`);
  }
  const commandId = aws('ssm', 'send-command', '--cli-input-json', JSON.stringify(plan)).Command
    .CommandId;
  console.log(JSON.stringify({ commandId, service: input.service, image: input.image }));

  // `aws ssm wait command-executed` gives up after 100s, shorter than an image pull.
  const deadline = Date.now() + (TIMEOUT_SECONDS + 60) * 1000;
  while (Date.now() < deadline) {
    await sleep(5000);
    let invocation;
    try {
      invocation = aws(
        'ssm',
        'get-command-invocation',
        '--command-id',
        commandId,
        '--instance-id',
        input.instance,
      );
    } catch {
      continue; // The invocation is not visible for the first few seconds.
    }
    if (!FINISHED.includes(invocation.Status)) continue;
    console.log(invocation.StandardOutputContent);
    if (invocation.Status === 'Success') return;
    console.error(invocation.StandardErrorContent);
    throw Error(`Release ended with status ${invocation.Status}`);
  }
  throw Error('Timed out waiting for the release to finish');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const input = {
    environment: process.env.DEPLOY_ENVIRONMENT,
    service: process.env.DEPLOY_SERVICE,
    image: process.env.DEPLOY_IMAGE,
    bundle: process.env.DEPLOY_BUNDLE || undefined,
    account: process.env.AWS_ACCOUNT_ID,
    region: process.env.AWS_REGION,
    instance: process.env.DEPLOY_INSTANCE_ID,
  };
  const plan = deploymentPlan(input);
  if (process.argv.includes('--apply')) await apply(input, plan);
  else console.log(JSON.stringify(plan, null, 2));
}
