import { Command } from 'commander';

import { collectSetupChecks } from '../lib/docker/setup-checks';
import { findProject } from '../lib/project/find-project';
import { readProject } from '../lib/project/read-project';
import { guardDeclaredEngine } from '../lib/project/runtime-declaration';
import type { IncusDeclaration } from '../lib/runtime/incus/compile/stack-target';
import {
  collectIncusChecks,
  type DoctorCheck,
} from '../lib/runtime/incus/doctor';
import type { RuntimeEngine } from '../lib/runtime/types';
import { CliError, ExitCode, usageError } from '../utils/fail';
import { emitJson } from '../utils/json-output';
import * as logger from '../utils/logger';
import { getOutputMode } from '../utils/output-mode';
import { action } from '../utils/run-command';

/** The runtime the workspace here declares, as the doctor reads it: it
 * reports what it cannot read instead of stopping, and never repairs. */
interface DeclaredRuntime {
  engine: RuntimeEngine;
  check: DoctorCheck;
  incus?: { projectDir: string; stack: string; declaration: IncusDeclaration };
}

async function declaredRuntime(): Promise<DeclaredRuntime> {
  const projectDir = findProject();
  let engine: RuntimeEngine = 'docker';
  let incus: DeclaredRuntime['incus'];
  if (projectDir !== null) {
    try {
      const project = await readProject(projectDir);
      engine = project.runtime?.engine ?? 'docker';
      if (engine === 'incus' && project.runtime?.incus !== undefined)
        incus = {
          projectDir,
          stack: project.id ?? 'tale',
          declaration: project.runtime.incus,
        };
      guardDeclaredEngine(engine);
    } catch (error) {
      // A runtime declaration or a TALE_RUNTIME this CLI refuses fails the
      // check; a tale.json it cannot read at all is reported, and the
      // Docker checks run as they do before init.
      const refused = error instanceof CliError;
      // The refusal's own next step (TALE_RUNTIME's differs from tale.json's).
      const next = refused ? error.info.next : undefined;
      return {
        engine: 'docker',
        check: {
          id: 'engine',
          status: refused ? 'fail' : 'warn',
          detail: `${error instanceof Error ? error.message : String(error)}${refused ? '' : '; the checks below assume Docker Compose, the default runtime'}`,
          fix:
            (Array.isArray(next) ? next.join(' ') : next) ??
            `Correct tale.json in ${projectDir}, then run tale doctor again.`,
        },
      };
    }
  }
  if (incus !== undefined)
    return {
      engine,
      incus,
      check: {
        id: 'engine',
        status: 'ok',
        detail: `Declared runtime: Incus (experimental), project ${incus.declaration.project} on pool ${incus.declaration.pool}, in ${incus.projectDir}.`,
      },
    };
  return {
    engine,
    check: {
      id: 'engine',
      status: 'ok',
      detail:
        projectDir === null
          ? 'Declared runtime: Docker Compose, the default (no workspace here).'
          : `Declared runtime: Docker Compose, in ${projectDir}.`,
    },
  };
}

export function createDoctorCommand(): Command {
  return new Command('doctor')
    .description('Check local setup prerequisites without changing anything')
    .option('-p, --port <port>', 'HTTPS port you plan to use', '443')
    .option(
      '--offline',
      'Make no network call: skip the Incus API probe and the instance report',
    )
    .action(
      action(async (options: { port: string; offline?: boolean }) => {
        const port = Number(options.port);
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          throw usageError(
            `Invalid --port "${options.port}": expected 1-65535`,
          );
        }
        const runtime = await declaredRuntime();
        // An Incus workspace runs nothing on this machine's Docker
        // (`tale dev` stays Docker's, design D-35): its rows are Incus's.
        const checks: DoctorCheck[] = [
          runtime.check,
          ...(runtime.incus === undefined
            ? (await collectSetupChecks(port)).checks
            : await collectIncusChecks({
                ...runtime.incus,
                offline: options.offline === true,
              })),
        ];
        const report = {
          ready: checks.every((check) => check.status !== 'fail'),
          engine: runtime.engine,
          checks,
        };
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
            for (const line of check.lines ?? []) logger.info(`    ${line}`);
            if (check.fix) logger.info(`  ${check.fix}`);
          }
          if (!report.ready)
            logger.error('Fix the failed checks, then run tale doctor again.');
          else if (runtime.engine === 'incus')
            logger.success('Prerequisite checks completed.');
          else
            logger.success(
              'Prerequisite checks completed. Start Tale with tale dev from your project directory.',
            );
        }
        if (!report.ready) process.exitCode = ExitCode.Precondition;
      }),
    );
}
