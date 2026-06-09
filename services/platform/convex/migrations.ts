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
    // (artifact backfill migrations removed — artifacts module deleted.)
    // Idempotent: orgs that already carry an applied-bounds snapshot are
    // skipped inside `seedInitialBoundsInternal`, so re-running on every
    // deploy is safe. Without this seed, retention_cleanup silently no-ops
    // for any org that enabled retention before the explicit-apply-gate
    // landed (round-2 v17 B3).
    await ctx.runAction(internal.migrations.seed_applied_bounds.apply, {});
    // Splits the legacy `userPreferences.enabled` flag and the single
    // `personalization` org policy into independent Custom Instructions
    // and User Memories gates. Idempotent. Exposed as an action because
    // it orchestrates two paginated mutations (Convex caps each
    // function at one paginated query).
    await ctx.runAction(
      internal.migrations.split_personalization_toggle.apply,
      {},
    );
    // Copies legacy documents.ragInfo.{status,error,indexedAt} onto the now-
    // canonical fileMetadata.{ragStatus,ragError,ragIndexedAt}. Self-scheduling
    // (one paginated batch per call), idempotent, fills holes only — safe to
    // re-run on every deploy. Keys on storageId, so it does not depend on the
    // documentId backfill.
    await ctx.runMutation(
      internal.migrations.backfill_filemetadata_rag_status
        .backfillFilemetadataRagStatus,
      {},
    );
  },
});
