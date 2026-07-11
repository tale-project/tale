import { Command } from 'commander';

import {
  applyDown,
  applyUp,
  getStatus,
  planDown,
  planUp,
  type ApplyResult,
  type MigrationMeta,
} from '../lib/actions/migrate-versioned';
import { runMigrations } from '../lib/actions/run-migrations';
import { requireProject } from '../lib/project/find-project';
import { resolveProjectContext } from '../lib/project/project-context';
import { emitJson } from '../utils/json-output';
import * as logger from '../utils/logger';
import { getOutputMode } from '../utils/output-mode';
import { confirm, confirmChoice } from '../utils/prompt';
import { action } from '../utils/run-command';

/**
 * `tale migrate` — versioned data migrations against the running deployment.
 *
 *   tale migrate                 (no subcommand) provision defaults + apply safe
 *                                pending migrations (the deploy-time runner)
 *   tale migrate status          show frontier, pending, destructive flags
 *   tale migrate up [--to] …     apply pending up-migrations
 *   tale migrate down --to <v> … roll back to a target version
 *
 * Up auto-applies non-destructive migrations; destructive ones require explicit
 * acceptance (`--yes`) or per-step review (`--step`). Down always warns.
 */
export function createMigrateCommand(): Command {
  const migrate = new Command('migrate')
    .description(
      'Apply pending data migrations and re-provision built-in defaults ' +
        'against the running deployment. Use the status/up/down subcommands ' +
        'for granular, reversible control.',
    )
    .option(
      '--dry-run',
      'Preview the deploy-time runner invocation without executing it',
      false,
    )
    .action(
      action(async (opts: { dryRun?: boolean }) => {
        // Bare `tale migrate` keeps its original behaviour: run the deploy-time
        // provisioning runner (provisioning:provisionAll) then the safe-migration
        // runner (migrations:runAll), as two separate steps.
        await withProject(async () => {
          await runMigrations({ dryRun: opts.dryRun ?? false });
        });
      }),
    );

  migrate.addCommand(statusCommand());
  migrate.addCommand(upCommand());
  migrate.addCommand(downCommand());
  return migrate;
}

// --------------------------------------------------------------------------

function statusCommand(): Command {
  return new Command('status')
    .description('Show the migration frontier, pending migrations, and flags.')
    .action(
      action(async () => {
        await withProject(async () => {
          const s = await getStatus();
          const failed = s.failed ?? [];
          if (getOutputMode().json) {
            emitJson('migrate status', {
              frontier: s.frontier ?? null,
              applied: s.applied.length,
              pending: s.pending.map((m) => ({
                id: m.numericId,
                semver: m.semver,
                slug: m.slug,
                destructive: m.destructive,
                snapshot: m.snapshot,
              })),
              pendingDestructive: s.pendingDestructive.length,
              failed: failed.map((m) => ({
                id: m.id,
                error: s.failedErrors?.[m.id] ?? 'unknown error',
              })),
            });
            return;
          }
          logger.header('Migration status');
          logger.table([
            ['Frontier', s.frontier ?? '(none applied)'],
            ['Applied', String(s.applied.length)],
            ['Pending', String(s.pending.length)],
            ['Destructive pending', String(s.pendingDestructive.length)],
            ...(failed.length > 0
              ? [['FAILED', String(failed.length)] as [string, string]]
              : []),
          ]);
          if (failed.length > 0) {
            logger.blank();
            logger.error(
              'FAILED — the last run of these migrations raised; the runner is resumable, re-run `tale migrate up` after addressing the cause:',
            );
            for (const m of failed) {
              printMeta(m);
              logger.info(`    error: ${s.failedErrors?.[m.id] ?? 'unknown'}`);
            }
          }
          if (s.pending.length > 0) {
            logger.blank();
            logger.info('PENDING');
            for (const m of s.pending) printMeta(m);
            logger.blank();
            const cmd = s.pendingDestructive.length
              ? '`tale migrate up --step` to review each, or `tale migrate up --yes` to apply all'
              : '`tale migrate up`';
            logger.info(
              `${s.pending.length} pending; ${s.pendingDestructive.length} destructive. Run ${cmd}.`,
            );
          } else {
            logger.success('Up to date — no pending migrations.');
          }
        });
      }),
    );
}

function upCommand(): Command {
  return new Command('up')
    .description('Apply pending up-migrations (oldest first).')
    .option('--to <version>', 'Apply up to and including this version')
    .option(
      '-y, --yes',
      'Accept all destructive steps without prompting',
      false,
    )
    .option('--step', 'Review each migration before it runs', false)
    .option('--dry-run', 'Show the plan without applying anything', false)
    .action(
      action(
        async (opts: {
          to?: string;
          yes?: boolean;
          step?: boolean;
          dryRun?: boolean;
        }) => {
          await withProject(async () => {
            if (opts.dryRun) {
              const plan = await planUp(opts.to);
              printPlanPreview(plan, 'up');
              return;
            }
            const isTty = process.stdin.isTTY;
            if (opts.step && !isTty) {
              throw new Error('--step requires an interactive terminal.');
            }
            if (!opts.yes && !opts.step && !isTty) {
              throw new Error(
                'tale migrate up requires --yes (-y) when stdin is not a TTY (e.g. CI).',
              );
            }
            if (opts.step) {
              await runStepwise('up', opts.to);
              return;
            }

            const plan = await planUp(opts.to);
            if (plan.length === 0) {
              logger.success('No pending migrations.');
              return;
            }
            printPlanPreview(plan, 'up');
            if (!opts.yes) {
              const destructive = plan.filter((m) => m.destructive);
              const ok = await confirm({
                message:
                  `Apply ${plan.length} migration(s)` +
                  (destructive.length
                    ? `, ${destructive.length} DESTRUCTIVE (snapshotted first)`
                    : '') +
                  '?',
                default: false,
              });
              if (!ok) {
                logger.info('Aborted by user.');
                return;
              }
            }
            report(
              await applyUp({ to: opts.to, allowDestructive: true }),
              'up',
            );
          });
        },
      ),
    );
}

function downCommand(): Command {
  return new Command('down')
    .description('Roll back applied migrations to a target version (reverse).')
    .requiredOption(
      '--to <version>',
      'Roll back until the frontier is this version',
    )
    .option('-y, --yes', 'Accept the rollback without prompting', false)
    .option('--step', 'Review each down-migration before it runs', false)
    .option('--dry-run', 'Show the plan without applying anything', false)
    .action(
      action(
        async (opts: {
          to: string;
          yes?: boolean;
          step?: boolean;
          dryRun?: boolean;
        }) => {
          await withProject(async () => {
            if (opts.dryRun) {
              const plan = await planDown(opts.to);
              printPlanPreview(plan, 'down');
              return;
            }
            const isTty = process.stdin.isTTY;
            if (opts.step && !isTty) {
              throw new Error('--step requires an interactive terminal.');
            }
            if (!opts.yes && !opts.step && !isTty) {
              throw new Error(
                'tale migrate down requires --yes (-y) when stdin is not a TTY (e.g. CI).',
              );
            }

            const plan = await planDown(opts.to);
            if (plan.length === 0) {
              logger.success(
                `Already at or below ${opts.to} — nothing to roll back.`,
              );
              return;
            }
            logger.header('Rolling back migrations (DOWN)');
            logger.notice(
              `Rolling back ${plan.length} migration(s) to ${opts.to}. ` +
                'Down-migrations can lose data written since these versions applied.',
            );
            for (const m of plan) printMeta(m);

            if (opts.step) {
              await runStepwise('down', opts.to);
              return;
            }
            if (!opts.yes) {
              const ok = await confirm({
                message: 'Proceed with the rollback?',
                default: false,
              });
              if (!ok) {
                logger.info('Aborted by user.');
                return;
              }
            }
            report(await applyDown({ to: opts.to }), 'down');
          });
        },
      ),
    );
}

// --------------------------------------------------------------------------

/** Per-step interactive review loop, shared by up and down. */
async function runStepwise(
  direction: 'up' | 'down',
  to: string | undefined,
): Promise<void> {
  const plan = direction === 'up' ? await planUp(to) : await planDown(to ?? '');
  if (plan.length === 0) {
    logger.success('Nothing to do.');
    return;
  }
  let acceptAll = false;
  for (let i = 0; i < plan.length; i++) {
    const m = plan[i];
    if (!acceptAll) {
      logger.blank();
      logger.notice(`[${i + 1}/${plan.length}] ${m.id}`);
      logger.table([
        ['Direction', direction.toUpperCase()],
        ['Destructive', m.destructive ? 'YES' : 'no'],
        [
          'Snapshot',
          m.snapshot === 'none'
            ? 'none'
            : `${m.snapshot} (restore via tale migrate down)`,
        ],
        ['Description', m.description],
      ]);
      const choice = await confirmChoice({ message: 'Apply this migration?' });
      if (choice === 'abort') {
        logger.info('Aborted — already-applied migrations remain applied.');
        return;
      }
      if (choice === 'skip') {
        logger.warn(`Skipped ${m.id}. Later migrations may assume it ran.`);
        continue;
      }
      if (choice === 'accept-all') acceptAll = true;
    }
    const result =
      direction === 'up'
        ? await applyUp({ only: [m.id], allowDestructive: true })
        : await applyDown({ to: to ?? '', only: [m.id] });
    report(result, direction);
  }
}

function printMeta(m: MigrationMeta): void {
  const tag = `[${m.semver}/${String(m.numericId).padStart(2, '0')}]`;
  const flag = m.destructive ? 'DESTRUCTIVE' : 'safe';
  const snap = m.snapshot !== 'none' ? ` (snapshot: ${m.snapshot})` : '';
  logger.info(`  ${tag} ${m.slug}  ${flag}${snap}`);
}

function printPlanPreview(
  plan: MigrationMeta[],
  direction: 'up' | 'down',
): void {
  if (plan.length === 0) {
    logger.success('No pending migrations.');
    return;
  }
  logger.info(`${plan.length} migration(s) would run (${direction}):`);
  for (const m of plan) printMeta(m);
}

function report(result: ApplyResult, direction: 'up' | 'down'): void {
  if (result.completed.length > 0) {
    logger.success(
      `${direction === 'up' ? 'Applied' : 'Rolled back'} ${result.completed.length}: ` +
        result.completed.join(', '),
    );
  } else {
    logger.info('No migrations were applied.');
  }
  const destructive = result.skipped.filter((m) => m.destructive);
  if (destructive.length > 0) {
    logger.warn(
      `Skipped ${destructive.length} destructive migration(s) — re-run with ` +
        `--yes or --step to apply: ${destructive.map((m) => m.id).join(', ')}`,
    );
  }
}

/** Resolve the project context, then run `fn`. Errors propagate to the central
 *  `action()` dispatch (every migrate subcommand is wrapped in it). */
async function withProject(fn: () => Promise<void>): Promise<void> {
  const projectDir = requireProject();
  await resolveProjectContext(projectDir);
  await fn();
}
