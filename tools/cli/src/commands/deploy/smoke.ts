import { Command } from 'commander';

import {
  runDeploymentSmoke,
  SMOKE_EMAIL_ENV,
  SMOKE_PASSWORD_ENV,
  SmokeFailure,
  type DeploymentSmokeReport,
  type SmokeCredentials,
} from '../../lib/deployment/deployment-smoke';
import { ExitCode, usageError } from '../../utils/fail';
import { emitJson } from '../../utils/json-output';
import * as logger from '../../utils/logger';
import { getOutputMode } from '../../utils/output-mode';
import { action } from '../../utils/run-command';

interface SmokeCommandOptions {
  url: string;
  expectedVersion?: string;
  full: boolean;
  chat: boolean;
  organization?: string;
  project?: string;
  timeout: string;
  turnTimeout: string;
}

function seconds(raw: string, flag: string, max: number): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > max)
    throw usageError(`Invalid ${flag} "${raw}": expected 1-${max} seconds.`);
  return value * 1000;
}

/** The smoke account comes from the environment only, never from argv. */
export function smokeCredentials(
  env: NodeJS.ProcessEnv = process.env,
): SmokeCredentials {
  const email = env[SMOKE_EMAIL_ENV]?.trim();
  const password = env[SMOKE_PASSWORD_ENV];
  if (!email || !password)
    throw usageError(
      `--full needs the smoke account in ${SMOKE_EMAIL_ENV} and ${SMOKE_PASSWORD_ENV}.`,
      'Use a dedicated account without a second factor; it may create one project named "Tale deployment smoke".',
    );
  return { email, password };
}

function render(report: DeploymentSmokeReport): void {
  logger.header(`Smoke test of ${report.url} (${report.mode})`);
  for (const check of report.checks) {
    const line = `${check.name}: ${check.detail} (${check.ms} ms)`;
    if (check.status === 'pass') logger.success(line);
    else if (check.status === 'skip') logger.warn(line);
    else logger.error(line);
  }
  if (report.passed) logger.success('The deployment passed the smoke test.');
  else logger.error('The deployment failed the smoke test.');
}

export function createSmokeCommand(): Command {
  return new Command('smoke')
    .description(
      'Check a running deployment through its public URL, as a browser would',
    )
    .requiredOption(
      '--url <url>',
      'Public URL of the deployment, including its subpath if it has one',
    )
    .option(
      '--expected-version <version>',
      'Fail unless /api/health reports this version',
    )
    .option(
      '--full',
      `Also sign in as ${SMOKE_EMAIL_ENV} and create, observe and delete a task`,
      false,
    )
    .option(
      '--chat',
      'With --full, also run one chat turn on the first available model (spends tokens)',
      false,
    )
    .option(
      '--organization <id-or-slug>',
      'With --full, the organization to use (default: the first one)',
    )
    .option(
      '--project <id>',
      'With --full, the project for the smoke task (default: the first one)',
    )
    .option('--timeout <seconds>', 'Bound on each request or wait', '15')
    .option('--turn-timeout <seconds>', 'Bound on the chat turn', '120')
    .action(
      action(async (options: SmokeCommandOptions) => {
        if (options.chat && !options.full)
          throw usageError('--chat needs --full.');
        const timeoutMs = seconds(options.timeout, '--timeout', 300);
        const turnTimeoutMs = seconds(
          options.turnTimeout,
          '--turn-timeout',
          900,
        );
        let report: DeploymentSmokeReport;
        try {
          report = await runDeploymentSmoke({
            url: options.url,
            expectedVersion: options.expectedVersion,
            credentials: options.full ? smokeCredentials() : undefined,
            organization: options.organization,
            project: options.project,
            chat: options.chat,
            timeoutMs,
            turnTimeoutMs,
          });
        } catch (error) {
          if (error instanceof SmokeFailure) throw usageError(error.message);
          throw error;
        }
        if (getOutputMode().json)
          emitJson('deploy smoke', report, report.passed);
        else render(report);
        if (!report.passed) process.exitCode = ExitCode.ExternalDep;
      }),
    );
}
