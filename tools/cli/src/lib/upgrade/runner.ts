import pkg from '../../../package.json';
import { confirm } from '../../utils/confirm';
import * as logger from '../../utils/logger';
import { readMigrationsState, recordApplied, appliedIds } from './state';
import type { Migration, MigrationContext } from './types';

/**
 * Compute the pending subset of migrations: those whose `id` is not already
 * recorded in `.tale/migrations.json` and whose `detect()` returns true for
 * the current state.
 *
 * Order is preserved from the registry — callers must not reorder.
 */
export async function computePending(
  registry: readonly Migration[],
  ctx: MigrationContext,
): Promise<Migration[]> {
  const state = await readMigrationsState(ctx.projectDir);
  const already = appliedIds(state);
  const pending: Migration[] = [];
  for (const m of registry) {
    if (already.has(m.id)) continue;
    try {
      if (await m.detect(ctx)) pending.push(m);
    } catch (err) {
      // A failing detect() should not silently drop the migration — surface
      // it loudly so operators can investigate before we either apply an
      // unsafe migration or skip a necessary one.
      throw new Error(
        `migration ${m.id}: detect() failed: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
  }
  return pending;
}

function resolveDescription(m: Migration, ctx: MigrationContext): string {
  return typeof m.description === 'function'
    ? m.description(ctx)
    : m.description;
}

function printPlan(
  pending: readonly Migration[],
  stops: readonly string[],
  ctx: MigrationContext,
): void {
  logger.blank();
  logger.header(`${pending.length} pending migration(s)`);
  for (const m of pending) {
    logger.info(`  • ${m.id} (introduced in ${m.introducedIn})`);
    logger.info(`      ${resolveDescription(m, ctx)}`);
  }
  if (stops.length > 0) {
    logger.blank();
    logger.info('The following compose projects / containers will be stopped:');
    for (const s of stops) logger.info(`  - ${s}`);
  }
  logger.blank();
}

function isNonInteractive(): boolean {
  return !(process.stdin.isTTY && process.stdout.isTTY);
}

export interface RunPendingOptions {
  /** Where we're being called from — used in messages only. */
  context: 'start' | 'deploy' | 'upgrade';
  /** Skip the interactive prompt and proceed. Required for non-TTY use. */
  assumeYes?: boolean;
  /** Print the plan but apply nothing. */
  dryRun?: boolean;
  /**
   * Callback invoked with the union of `requiredStops()` across pending
   * migrations, before apply runs. Callers implement the actual
   * `docker compose -p <name> down` since that behaviour varies between
   * start and deploy call sites.
   */
  performStops?: (stops: string[]) => Promise<void>;
}

export interface RunPendingResult {
  /** True if the caller should keep executing the original command. */
  proceed: boolean;
  /** Migrations that ran successfully this pass. */
  applied: string[];
  /** True if migrations were pending but the user declined to apply. */
  declined: boolean;
}

/**
 * Runs the pending-migration pipeline.
 *
 *  - If nothing is pending → proceed=true, no side effects.
 *  - If pending and interactive → print plan, prompt [y/N]:
 *      yes → apply all in order, record each, proceed=true
 *      no  → exit cleanly with proceed=false, declined=true, no side effects
 *  - If pending and non-TTY and not assumeYes → throw (caller turns this
 *    into a process exit with a clear error).
 *  - If pending and (TTY or assumeYes) → apply all in order.
 *
 * This is the single entry point used by `tale start` and `tale deploy`.
 */
export async function runPendingMigrations(
  registry: readonly Migration[],
  ctx: MigrationContext,
  opts: RunPendingOptions,
): Promise<RunPendingResult> {
  const pending = await computePending(registry, ctx);
  if (pending.length === 0) {
    return { proceed: true, applied: [], declined: false };
  }

  // Collect the union of requiredStops across pending migrations so we can
  // show the full blast radius up front.
  const stopsSet = new Set<string>();
  for (const m of pending) {
    for (const s of await m.requiredStops(ctx)) stopsSet.add(s);
  }
  const stops = [...stopsSet];

  printPlan(pending, stops, ctx);

  if (opts.dryRun) {
    logger.notice(
      'DRY RUN — migrations NOT applied. Re-run without --dry-run to apply.',
    );
    return { proceed: true, applied: [], declined: false };
  }

  // Decide whether to proceed.
  let approved = opts.assumeYes === true;
  if (!approved) {
    if (isNonInteractive()) {
      throw new Error(
        'Pending migrations detected but stdin/stdout is not a TTY. ' +
          'Re-run this command in an interactive shell to confirm, or pass --yes to accept non-interactively.',
      );
    }
    approved = await confirm(
      `Apply ${pending.length} pending migration(s) now?`,
    );
    if (!approved) {
      logger.info('Migration declined. Nothing changed.');
      return { proceed: false, applied: [], declined: true };
    }
  }

  // Stop everything the pending migrations need down.
  if (stops.length > 0 && opts.performStops) {
    logger.step('Stopping containers before migration...');
    await opts.performStops(stops);
  }

  // Apply in order. Record each as soon as it succeeds so a mid-pipeline
  // failure leaves us resumable.
  const applied: string[] = [];
  for (const m of pending) {
    logger.step(`Applying migration: ${m.id}`);
    const outcome = await m.apply(ctx, { dryRun: false });
    await recordApplied(ctx.projectDir, {
      id: m.id,
      at: new Date().toISOString(),
      cliVersion: pkg.version,
    });
    if (outcome === 'applied') {
      logger.success(`Migration ${m.id} applied.`);
    } else {
      logger.info(`Migration ${m.id} was a no-op (already satisfied).`);
    }
    applied.push(m.id);
  }

  return { proceed: true, applied, declined: false };
}

/**
 * Plan-only variant used by `tale upgrade`. Never stops containers, never
 * runs apply(). Just logs the plan so operators know what `tale start` /
 * `tale deploy` will do next.
 */
export async function planPendingMigrations(
  registry: readonly Migration[],
  ctx: MigrationContext,
): Promise<Migration[]> {
  const pending = await computePending(registry, ctx);
  if (pending.length === 0) return [];
  const stopsSet = new Set<string>();
  for (const m of pending) {
    for (const s of await m.requiredStops(ctx)) stopsSet.add(s);
  }
  printPlan(pending, [...stopsSet], ctx);
  logger.notice(
    'Run "tale start" (dev) or "tale deploy" (prod) to apply — the CLI will prompt before changing anything.',
  );
  return pending;
}
