import { Migrations } from '@convex-dev/migrations';

import { components, internal } from './_generated/api';
import type { DataModel } from './_generated/dataModel';
import { internalAction } from './_generated/server';

/**
 * Registry for one-time, run-once data migrations. Define future migrations
 * here with `migrations.define(...)` and run them via `migrations.runner(...)`;
 * the component tracks which have applied so each runs exactly once across
 * deploys. There are none today — the product ships greenfield — but the
 * machinery is kept so future schema changes have a first-class home.
 */
export const migrations = new Migrations<DataModel>(components.migrations);

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
