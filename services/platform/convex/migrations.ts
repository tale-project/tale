import { Migrations } from '@convex-dev/migrations';

import { components, internal } from './_generated/api';
import type { DataModel } from './_generated/dataModel';
import { internalAction } from './_generated/server';

export const migrations = new Migrations<DataModel>(components.migrations);

export const runAll = internalAction({
  args: {},
  handler: async (ctx) => {
    await ctx.runMutation(
      internal.migrations.backfill_apikey_reference_id.apply,
    );
    await ctx.runMutation(
      internal.migrations.backfill_ledger_granularity.apply,
    );
    // Multi-file artifact refactor — Phase A. Synthesizes `files`/`entryFile`
    // for legacy single-`content` artifact rows. Idempotent (skip-if-set).
    await ctx.runMutation(internal.migrations.backfill_artifact_files.apply);
    // Multi-file artifact refactor — Phase B. Backfills the dedicated
    // `artifactFiles` / `artifactRuns` / `artifactRunFiles` tables from
    // the legacy embedded fields. Depends on Phase A (reads the
    // synthesized `files[]`). Sentinel-gated idempotent — partially-done
    // artifacts roll back atomically per batch and retry skips completed
    // ones at O(1).
    await ctx.runMutation(
      internal.migrations.backfill_artifact_files_table.apply,
    );
    // Idempotent: orgs that already carry an applied-bounds snapshot are
    // skipped inside `seedInitialBoundsInternal`, so re-running on every
    // deploy is safe. Without this seed, retention_cleanup silently no-ops
    // for any org that enabled retention before the explicit-apply-gate
    // landed (round-2 v17 B3).
    await ctx.runAction(internal.migrations.seed_applied_bounds.apply, {});
    // Splits the legacy `userPreferences.enabled` flag and the single
    // `personalization` org policy into independent Custom Instructions
    // and User Memories gates. Idempotent.
    await ctx.runMutation(
      internal.migrations.split_personalization_toggle.apply,
    );
  },
});
