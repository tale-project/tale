import { v } from 'convex/values';

import { getString, isRecord } from '../lib/utils/type-utils';
import { internal } from './_generated/api';
import { internalAction } from './_generated/server';

/**
 * Deploy-time MIGRATION runner: applies pending versioned data migrations.
 * Runs on every deploy (services/platform/docker-entrypoint.sh) and on demand
 * via `tale migrate`.
 *
 * Provisioning of built-in default content (prompt library, task-ops pack) is
 * a SEPARATE concern handled by `provisioning.ts:provisionAll` — it is not a
 * migration and is invoked as its own deploy step.
 */
interface RunAllSummary {
  ok: boolean;
  applied: string[];
  destructivePending: string[];
  failedId: string | null;
  error: string | null;
}

export const runAll = internalAction({
  args: {},
  returns: v.object({
    ok: v.boolean(),
    applied: v.array(v.string()),
    destructivePending: v.array(v.string()),
    failedId: v.union(v.string(), v.null()),
    error: v.union(v.string(), v.null()),
  }),
  // The explicit return annotation breaks the self-referential inference
  // cycle (this module's exported type feeds `internal`, which the handler
  // consumes) — without it the whole generated api degrades to `any`.
  handler: async (ctx): Promise<RunAllSummary> => {
    // Apply pending versioned data migrations — but only NON-destructive ones.
    // Destructive migrations (table/column drops, row deletions) are never run
    // automatically on a deploy/restart; the operator applies them deliberately
    // via `tale migrate up` after reviewing them. `applyUp` stops at the first
    // destructive migration and reports the rest as skipped.
    try {
      const result = await ctx.runAction(
        internal.migrations.framework.entrypoints.applyUp,
        { allowDestructive: false },
      );
      if (result.completed.length > 0) {
        console.log('[migrations] applied on deploy', result.completed);
      }
      const destructivePending = result.skipped.filter((m) => m.destructive);
      if (destructivePending.length > 0) {
        console.warn(
          '[migrations] destructive migration(s) pending — NOT run automatically. ' +
            'Apply with `tale migrate up --step` (a snapshot is taken first): ' +
            destructivePending.map((m) => m.id).join(', '),
        );
      }
      return {
        ok: true,
        applied: result.completed,
        destructivePending: destructivePending.map((m) => m.id),
        failedId: null,
        error: null,
      };
    } catch (err) {
      // A migration failure must not wedge the deploy — the platform still
      // boots on the current schema; the operator re-runs `tale migrate up`.
      // The bracketed marker is GREP-STABLE: docker-entrypoint.sh keys its
      // boot banner on it and `tale migrate status` shows the failed ledger
      // rows — change it only with both consumers.
      const message = err instanceof Error ? err.message : String(err);
      const failedId = await failedMigrationId(ctx);
      console.error(
        `[migrations][deploy-failure] id=${failedId ?? 'unknown'} error=${message} — ` +
          "platform continues on the current schema; inspect with 'tale migrate status' " +
          "and re-run 'tale migrate up' (idempotent, resumable).",
      );
      return {
        ok: false,
        applied: [],
        destructivePending: [],
        failedId,
        error: message,
      };
    }
  },
});

/** The ledger row the failed run left behind, for the deploy-failure line. */
async function failedMigrationId(ctx: {
  // oxlint-disable-next-line typescript/no-explicit-any -- structural cross-fn typing; a `typeof internal…status` reference here would make this module's types circular through the generated api
  runQuery: (...args: any[]) => Promise<any>;
}): Promise<string | null> {
  try {
    const status: unknown = await ctx.runQuery(
      internal.migrations.framework.entrypoints.status,
      {},
    );
    if (!isRecord(status) || !Array.isArray(status.failed)) return null;
    const first: unknown = status.failed[0];
    return isRecord(first) ? (getString(first, 'id') ?? null) : null;
  } catch (statusErr) {
    console.warn(
      '[migrations] could not read failed-migration status:',
      statusErr instanceof Error ? statusErr.message : statusErr,
    );
    return null;
  }
}
