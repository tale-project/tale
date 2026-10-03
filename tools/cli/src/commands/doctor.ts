import { Command } from 'commander';

import { collectSetupChecks } from '../lib/docker/setup-checks';
import { ExitCode, usageError } from '../utils/fail';
import { emitJson } from '../utils/json-output';
import * as logger from '../utils/logger';
import { getOutputMode } from '../utils/output-mode';
import { action } from '../utils/run-command';

export function createDoctorCommand(): Command {
  return new Command('doctor')
    .description('Check local setup prerequisites without changing anything')
    .option('-p, --port <port>', 'HTTPS port you plan to use', '443')
    .action(
      action(async (options: { port: string }) => {
        const port = Number(options.port);
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          throw usageError(
            `Invalid --port "${options.port}": expected 1-65535`,
          );
        }
        const report = await collectSetupChecks(port);
        if (getOutputMode().json) {
          emitJson('doctor', report, report.ready);
        } else {
          logger.header('Checking Tale setup');
          for (const check of report.checks) {
            const render =
              check.status === 'ok'
                ? logger.success
                : check.status === 'warn'
                  ? logger.warn
                  : logger.error;
            render(`${check.id}: ${check.detail}`);
            if (check.fix) logger.info(`  ${check.fix}`);
          }
          if (report.ready)
            logger.success(
              'Prerequisite checks completed. Start Tale with tale dev from your project directory.',
            );
          else
            logger.error('Fix the failed checks, then run tale doctor again.');
        }
        if (!report.ready) process.exitCode = ExitCode.Precondition;
      }),
    );
}
