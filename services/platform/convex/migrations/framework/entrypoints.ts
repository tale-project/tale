/**
 * Public surface for the migration framework — the functions the CLI invokes
 * via `bunx convex run`:
 *
 *   migrations/framework/entrypoints:status      (query)  — frontier + plan
 *   migrations/framework/entrypoints:planUp      (query)  — pending ups
 *   migrations/framework/entrypoints:planDown    (query)  — rollback steps
 *   migrations/framework/entrypoints:applyUp     (action) — run pending ups
 *   migrations/framework/entrypoints:applyDown   (action) — roll back to a ver
 *
 * Actions orchestrate; the heavy lifting is in the batch mutations (`runner`),
 * the node runner (`node_runner`), and the ledger. Only an action can both
 * `runMutation` (db batches) and `runAction` (node-per-org), which is why the
 * apply* entrypoints are actions.
 */

import { v } from 'convex/values';

import { internal } from '../../_generated/api';
import {
  internalAction,
  internalQuery,
  type ActionCtx,
} from '../../_generated/server';
import { BASELINE_VERSION } from './baseline';
import { getLimits } from './limits';
import {
  appliedFrontier,
  computePendingUp,
  computeRollback,
  foldLedgerAliases,
  indexLedger,
  isApplied,
  orderMigrations,
  restrictToOnly,
  type LedgerState,
  type PlanStep,
} from './planner';
import { ALL_META } from './registry.gen';
import { buildOrderKey, compareSemver } from './semver';
import {
  isRunnableKind,
  type MigrationDirection,
  type MigrationMeta,
} from './types';

const metaValidator = v.object({
  id: v.string(),
  semver: v.string(),
  numericId: v.number(),
  slug: v.string(),
  title: v.string(),
  description: v.string(),
  kind: v.union(
    v.literal('db'),
    v.literal('node'),
    v.literal('component'),
    v.literal('reference'),
  ),
  reversible: v.boolean(),
  destructive: v.boolean(),
  snapshot: v.union(
    v.literal('none'),
    v.literal('table-rows'),
    v.literal('fs-tree'),
  ),
  formerIds: v.optional(v.array(v.string())),
});

/**
 * Re-homed migrations whose ledger rows may still sit under a former id.
 * The apply actions adopt those rows before planning (`ledger.reconcileAliases`);
 * the read-only queries fold them at read time instead (they cannot write).
 */
const LEDGER_ALIASES = ALL_META.filter(
  (m) => (m.formerIds?.length ?? 0) > 0,
).map((m) => ({
  migrationId: m.id,
  semver: m.semver,
  numericId: m.numericId,
  orderKey: buildOrderKey(m.semver, m.numericId),
  formerIds: [...(m.formerIds ?? [])],
}));

async function adoptFormerLedgerRows(ctx: ActionCtx): Promise<void> {
  if (LEDGER_ALIASES.length === 0) return;
  await ctx.runMutation(internal.migrations.framework.ledger.reconcileAliases, {
    aliases: LEDGER_ALIASES,
  });
}

// --------------------------------------------------------------------------
// Reads (queries)
// --------------------------------------------------------------------------

interface LedgerRowView extends LedgerState {
  error?: string;
}

/** Reduce ledger rows to the planner's view (+ the error for failed rows). */
async function readLedgerRows(ctx: {
  db: {
    query: (t: 'migrationLedger') => { collect: () => Promise<unknown[]> };
  };
}): Promise<LedgerRowView[]> {
  const rows = (await ctx.db.query('migrationLedger').collect()) as Array<{
    migrationId: string;
    direction: 'up' | 'down';
    status: 'running' | 'applied' | 'rolledBack' | 'failed';
    error?: string;
  }>;
  return rows.map((r) => ({
    migrationId: r.migrationId,
    direction: r.direction,
    status: r.status,
    error: r.error,
  }));
}

export const status = internalQuery({
  args: {},
  returns: v.object({
    frontier: v.union(v.string(), v.null()),
    applied: v.array(metaValidator),
    pending: v.array(metaValidator),
    pendingDestructive: v.array(v.string()),
    references: v.array(metaValidator),
    /** Migrations whose last run FAILED — resumable via `tale migrate up`. */
    failed: v.array(metaValidator),
    /** migrationId → the recorded failure message, for operator triage. */
    failedErrors: v.record(v.string(), v.string()),
  }),
  handler: async (ctx) => {
    const ledgerRows = foldLedgerAliases(await readLedgerRows(ctx), ALL_META);
    const ledger = indexLedger(ledgerRows);
    const steps = orderMigrations(ALL_META);

    const applied = steps
      .filter((s) => isApplied(s.meta.id, ledger))
      .map((s) => s.meta);
    const pending = computePendingUp(ALL_META, ledgerRows).map((s) => s.meta);
    const references = steps
      .filter((s) => s.meta.kind === 'reference')
      .map((s) => s.meta);
    const frontier = appliedFrontier(steps, ledger);

    const failedRows = ledgerRows.filter((r) => r.status === 'failed');
    const failedIds = new Set(failedRows.map((r) => r.migrationId));
    const failed = steps
      .filter((s) => failedIds.has(s.meta.id))
      .map((s) => s.meta);
    const failedErrors: Record<string, string> = {};
    for (const row of failedRows) {
      failedErrors[row.migrationId] = row.error ?? 'unknown error';
    }

    return {
      frontier: frontier?.meta.id ?? null,
      applied,
      pending,
      pendingDestructive: pending.filter((m) => m.destructive).map((m) => m.id),
      references,
      failed,
      failedErrors,
    };
  },
});

/**
 * Breaking-cutover sentinel: ledger rows recorded by releases OLDER than the
 * migration baseline. Any hit means this deployment lived through a
 * pre-baseline release (every install replays the whole chain on first boot,
 * so even a fresh 0.3 install stamped rows) — post-baseline code must refuse
 * to serve its data, because the upgrade history was reset and nothing can
 * migrate it. `status` above cannot see this: with the post-reset EMPTY
 * registry it derives everything from ALL_META and reports a clean slate
 * even over a pre-baseline ledger.
 *
 * Consumed by the docker-entrypoint boot backstop (fatal, escape hatch
 * `TALE_ACCEPT_DATA_LOSS=1`); the CLI deploy guard refuses earlier via the
 * running container's image version, before anything is touched.
 */
export const preBaselineLedger = internalQuery({
  args: {},
  returns: v.object({
    baseline: v.string(),
    count: v.number(),
    examples: v.array(v.string()),
  }),
  handler: async (ctx) => {
    const rows = await ctx.db.query('migrationLedger').collect();
    const pre = rows.filter(
      (r) => compareSemver(r.semver, BASELINE_VERSION) < 0,
    );
    return {
      baseline: BASELINE_VERSION,
      count: pre.length,
      examples: pre.slice(0, 5).map((r) => r.migrationId),
    };
  },
});

export const planUp = internalQuery({
  args: { to: v.optional(v.string()) },
  returns: v.array(metaValidator),
  handler: async (ctx, args) => {
    const ledgerRows = foldLedgerAliases(await readLedgerRows(ctx), ALL_META);
    return computePendingUp(ALL_META, ledgerRows, args.to).map((s) => s.meta);
  },
});

export const planDown = internalQuery({
  args: { to: v.string() },
  returns: v.array(metaValidator),
  handler: async (ctx, args) => {
    const ledgerRows = foldLedgerAliases(await readLedgerRows(ctx), ALL_META);
    return computeRollback(ALL_META, ledgerRows, args.to).map((s) => s.meta);
  },
});

// --------------------------------------------------------------------------
// Apply (actions)
// --------------------------------------------------------------------------

const applyResultValidator = v.object({
  dryRun: v.boolean(),
  /** Migration ids actually applied/reverted this run. */
  completed: v.array(v.string()),
  /** Planned but not executed (dry-run, or destructive without acceptance). */
  skipped: v.array(metaValidator),
});

export const applyUp = internalAction({
  args: {
    to: v.optional(v.string()),
    only: v.optional(v.array(v.string())),
    allowDestructive: v.optional(v.boolean()),
    dryRun: v.optional(v.boolean()),
  },
  returns: applyResultValidator,
  handler: async (ctx, args) => {
    await adoptFormerLedgerRows(ctx);
    const ledgerRows = await ctx.runQuery(
      internal.migrations.framework.ledger.getLedgerState,
      {},
    );
    const states = toStates(ledgerRows);
    let plan = computePendingUp(ALL_META, states, args.to);
    if (args.only) plan = restrictToOnly(plan, args.only);

    if (args.dryRun) {
      return { dryRun: true, completed: [], skipped: plan.map((s) => s.meta) };
    }

    const completed: string[] = [];
    const skipped: MigrationMeta[] = [];
    for (const step of plan) {
      // Stop at the first destructive migration we're not allowed to run —
      // running later migrations past a skipped one would violate ordering.
      if (step.meta.destructive && !args.allowDestructive) {
        skipped.push(...plan.slice(plan.indexOf(step)).map((s) => s.meta));
        break;
      }
      await runOne(ctx, step, 'up');
      completed.push(step.meta.id);
    }
    return { dryRun: false, completed, skipped };
  },
});

export const applyDown = internalAction({
  args: {
    to: v.string(),
    only: v.optional(v.array(v.string())),
    dryRun: v.optional(v.boolean()),
  },
  returns: applyResultValidator,
  handler: async (ctx, args) => {
    await adoptFormerLedgerRows(ctx);
    const ledgerRows = await ctx.runQuery(
      internal.migrations.framework.ledger.getLedgerState,
      {},
    );
    const states = toStates(ledgerRows);
    let plan = computeRollback(ALL_META, states, args.to);
    if (args.only) plan = restrictToOnly(plan, args.only);

    if (args.dryRun) {
      return { dryRun: true, completed: [], skipped: plan.map((s) => s.meta) };
    }

    const completed: string[] = [];
    for (const step of plan) {
      await runOne(ctx, step, 'down');
      completed.push(step.meta.id);
    }
    return { dryRun: false, completed, skipped: [] };
  },
});

// --------------------------------------------------------------------------
// Internals
// --------------------------------------------------------------------------

// oxlint-disable-next-line typescript/no-explicit-any -- runQuery returns the ledger Doc shape
function toStates(rows: any[]): LedgerState[] {
  return rows.map((r) => ({
    migrationId: r.migrationId,
    direction: r.direction,
    status: r.status,
  }));
}

type ApplyCtx = ActionCtx;

/** Run a single migration end to end, recording ledger state around it. */
async function runOne(
  ctx: ApplyCtx,
  step: PlanStep,
  direction: MigrationDirection,
): Promise<void> {
  const { meta } = step;
  if (!isRunnableKind(meta.kind)) {
    throw new Error(`Migration ${meta.id} (kind=${meta.kind}) is not runnable`);
  }
  const startedAt = Date.now();
  const resume = await ctx.runMutation(
    internal.migrations.framework.ledger.beginRun,
    {
      migrationId: meta.id,
      semver: meta.semver,
      numericId: meta.numericId,
      orderKey: buildOrderKey(meta.semver, meta.numericId),
      direction,
    },
  );

  try {
    if (meta.kind === 'db') {
      await runDbMigration(ctx, meta, direction);
    } else if (meta.kind === 'component') {
      await runComponentMigration(ctx, meta, direction);
    } else {
      await runNodeMigration(ctx, meta, direction, resume);
    }
    await ctx.runMutation(internal.migrations.framework.ledger.completeRun, {
      migrationId: meta.id,
      direction,
      durationMs: Date.now() - startedAt,
    });
  } catch (err) {
    await ctx.runMutation(internal.migrations.framework.ledger.failRun, {
      migrationId: meta.id,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

async function runDbMigration(
  ctx: ApplyCtx,
  meta: MigrationMeta,
  direction: MigrationDirection,
): Promise<void> {
  const { maxBatches } = getLimits();
  const useRestore = direction === 'down' && meta.snapshot === 'table-rows';
  for (let i = 0; i < maxBatches; i++) {
    const result = useRestore
      ? await ctx.runMutation(
          internal.migrations.framework.runner.restoreSnapshotBatch,
          { migrationId: meta.id },
        )
      : await ctx.runMutation(
          internal.migrations.framework.runner.applyDbBatch,
          { migrationId: meta.id, direction },
        );
    if (result.isDone) return;
  }
  throw new Error(`Migration ${meta.id} exceeded ${maxBatches} batches`);
}

async function runComponentMigration(
  ctx: ApplyCtx,
  meta: MigrationMeta,
  direction: MigrationDirection,
): Promise<void> {
  const { maxBatches } = getLimits();
  const useRestore = direction === 'down' && meta.snapshot === 'table-rows';
  for (let i = 0; i < maxBatches; i++) {
    const result = useRestore
      ? await ctx.runMutation(
          internal.migrations.framework.runner.restoreComponentSnapshotBatch,
          { migrationId: meta.id },
        )
      : await ctx.runMutation(
          internal.migrations.framework.runner.applyComponentBatch,
          { migrationId: meta.id, direction },
        );
    if (result.isDone) return;
  }
  throw new Error(`Migration ${meta.id} exceeded ${maxBatches} batches`);
}

async function runNodeMigration(
  ctx: ApplyCtx,
  meta: MigrationMeta,
  direction: MigrationDirection,
  resume: {
    orgCursor: string | null;
    processedOrgs: string[];
  },
): Promise<void> {
  const { maxOrgPages } = getLimits();
  const processed = new Set(resume.processedOrgs);
  let cursor: string | null = resume.orgCursor;
  let prevCursor: string | null | undefined;
  let isDone = false;
  let pages = 0;

  while (!isDone) {
    if (pages++ >= maxOrgPages) {
      throw new Error(`Migration ${meta.id}: org pagination did not terminate`);
    }
    if (prevCursor !== undefined && cursor === prevCursor) {
      throw new Error(
        `Migration ${meta.id}: org pagination cursor did not advance`,
      );
    }
    prevCursor = cursor;

    const res = await ctx.runQuery(
      internal.migrations.framework.org_source.listOrgsPage,
      { cursor, numItems: 200 },
    );

    for (const org of res.page) {
      if (processed.has(org.id)) continue;

      await ctx.runAction(
        internal.migrations.framework.node_runner.applyNodeForOrg,
        {
          migrationId: meta.id,
          orgId: org.id,
          orgSlug: org.slug,
          direction,
        },
      );
      processed.add(org.id);
      // Record the cursor that FETCHED this page, not `res.continueCursor`:
      // a mid-page crash must resume by re-fetching the SAME page (the
      // processed set skips finished orgs; handlers are idempotent). Storing
      // the next page's cursor would silently skip the crashed org and the
      // rest of its page while the run still completed as applied.
      await ctx.runMutation(
        internal.migrations.framework.ledger.recordOrgProgress,
        { migrationId: meta.id, orgId: org.id, orgCursor: cursor },
      );
    }

    cursor = res.continueCursor;
    isDone = res.isDone;
  }
}
