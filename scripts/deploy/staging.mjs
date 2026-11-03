import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function deploymentPlan({ service, image, account, instance, region }) {
  if (
    !['api', 'worker', 'compute', 'web'].includes(service) ||
    !/^\d{12}$/.test(account ?? '') ||
    !/^i-[a-f0-9]{17}$/.test(instance ?? '') ||
    !/^[a-z]{2}-[a-z]+-\d$/.test(region ?? '') ||
    !/^ghcr\.io\/[a-z0-9_.-]+\/[a-z0-9_./-]+@sha256:[a-f0-9]{64}$/.test(image ?? '')
  ) {
    throw Error(
      'Explicit staging service/account/region/instance and immutable GHCR digest are required',
    );
  }
  return {
    DocumentName: 'AWS-RunShellScript',
    InstanceIds: [instance],
    TimeoutSeconds: 600,
    Parameters: { commands: [`sudo /usr/local/bin/learn-release ${service} ${image}`] },
    Comment: `LEARN staging ${service} immutable release`,
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const input = {
    service: process.env.DEPLOY_SERVICE,
    image: process.env.DEPLOY_IMAGE,
    account: process.env.AWS_ACCOUNT_ID,
    region: process.env.AWS_REGION,
    instance: process.env.STAGING_INSTANCE_ID,
  };
  const plan = deploymentPlan(input);
  if (!process.argv.includes('--apply')) {
    console.log(JSON.stringify(plan, null, 2));
  } else {
    const aws = (...args) =>
      JSON.parse(
        execFileSync('aws', [...args, '--region', input.region, '--output', 'json'], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        }),
      );
    const identity = aws('sts', 'get-caller-identity');
    if (identity.Account !== input.account) throw Error('AWS account mismatch');
    const target = aws('ec2', 'describe-instances', '--instance-ids', input.instance)
      .Reservations?.[0]?.Instances?.[0];
    const tags = Object.fromEntries((target?.Tags ?? []).map((tag) => [tag.Key, tag.Value]));
    if (
      tags.Project !== 'LEARN' ||
      tags.Environment !== 'staging' ||
      tags.Service !== input.service ||
      target?.State?.Name !== 'running'
    )
      throw Error('Target is not the declared LEARN staging service');
    const command = aws('ssm', 'send-command', '--cli-input-json', JSON.stringify(plan)).Command
      .CommandId;
    console.log(
      JSON.stringify({ commandId: command, instance: input.instance, service: input.service }),
    );
    execFileSync(
      'aws',
      [
        'ssm',
        'wait',
        'command-executed',
        '--command-id',
        command,
        '--instance-id',
        input.instance,
        '--region',
        input.region,
      ],
      { stdio: 'inherit' },
    );
    const status = aws(
      'ssm',
      'get-command-invocation',
      '--command-id',
      command,
      '--instance-id',
      input.instance,
    );
    if (status.Status !== 'Success')
      throw Error('Staging release did not succeed; inspect restricted SSM logs');
    console.log(JSON.stringify({ status: status.Status, image: input.image }));
  }
}
