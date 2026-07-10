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
export const runAll = internalAction({
  args: {},
  handler: async (ctx) => {
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
    } catch (err) {
      // A migration failure must not wedge the deploy — the platform still
      // boots on the current schema; the operator re-runs `tale migrate up`.
      console.error(
        '[migrations] applyUp failed during deploy (continuing):',
        err instanceof Error ? err.message : err,
      );
    }
  },
});
