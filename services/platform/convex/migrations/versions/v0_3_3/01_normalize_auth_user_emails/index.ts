import type { MutationCtx } from '../../../../_generated/server';
import { applyAuthEmailNormalizationBatch } from '../../../../lib/auth/resolve_auth_user_email_group';
import type {
  ComponentBatchResult,
  ComponentMigration,
} from '../../../framework/types';
import { meta } from './meta';

async function runUpBatch(
  ctx: MutationCtx,
  cursor: string | null,
  batchSize: number,
): Promise<ComponentBatchResult & { continueCursor: string | null }> {
  const batch = await applyAuthEmailNormalizationBatch(
    ctx,
    cursor,
    batchSize,
    meta.id,
  );
  return {
    isDone: batch.isDone,
    processed: batch.processed,
    renamed: batch.stats.renamed,
    merged: batch.stats.merged,
    skipped: batch.stats.skipped,
    noop: batch.stats.noop,
    continueCursor: batch.continueCursor,
  };
}

export const migration: ComponentMigration = {
  meta,
  batchSize: 50,
  up: runUpBatch,
  async down(ctx, cursor) {
    // Component rollback is handled by restoreComponentSnapshotBatch in the runner.
    void ctx;
    void cursor;
    return {
      isDone: true,
      processed: 0,
      renamed: 0,
      merged: 0,
      skipped: 0,
      noop: 0,
      continueCursor: null,
    };
  },
};
