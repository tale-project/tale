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
    // Both backfills below are independent and idempotent. The documentId
    // backfill keys on (organizationId, fileId); the rag-status backfill keys on
    // storageId and has NO documentId dependency — so call order is cosmetic.
    // Each runs only its first batch synchronously here and self-schedules its
    // tail, so the two walks interleave regardless. Agent RAG retrieval requires
    // BOTH documentId set AND ragStatus === 'completed', so a legacy
    // completed-but-unlinked blob is transiently invisible until both chains
    // drain, then converges. (The rag-status backfill self-heals missing rows it
    // creates with documentId already set; the documentId backfill skips those.)
    //
    // Links fileMetadata.documentId from the matching (organizationId, fileId)
    // document. Self-scheduling, idempotent (skips rows that already have
    // documentId).
    await ctx.runMutation(
      internal.migrations.backfill_file_metadata_document_id
        .backfillFileMetadataDocumentId,
      {},
    );
    // Mirrors TERMINAL legacy documents.ragInfo.{status,error,indexedAt} onto the
    // canonical fileMetadata.{ragStatus,ragError,ragIndexedAt}, creating the row
    // when missing. Self-scheduling (one paginated batch per call), idempotent —
    // safe to re-run on every deploy.
    await ctx.runMutation(
      internal.migrations.backfill_filemetadata_rag_status
        .backfillFilemetadataRagStatus,
      {},
    );
    // The default task-ops workflow pack comes PREINSTALLED: provision every
    // existing org (new orgs get it from the org-creation hook). Idempotent —
    // per-workflow provision rows make re-runs no-ops, and org opt-outs
    // (uninstalled workflows, deactivated triggers) are never overridden.
    await ctx.runAction(
      internal.migrations.provision_task_ops_pack.provisionTaskOpsPackAllOrgs,
      {},
    );
  },
});
