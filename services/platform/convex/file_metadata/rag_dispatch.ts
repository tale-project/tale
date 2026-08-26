/**
 * Enqueue file indexing onto a workpool, and record the outcome on the row.
 *
 * Concurrency is the pool's job. This module decides only three things: which
 * action indexes a row, which pool it belongs in, and what the row's status
 * says afterwards.
 *
 * ## What replaced what
 *
 * This used to hand-roll the queue: count an org's in-flight rows, count the
 * global total, and either dispatch or set `ragParked` and wait for a later
 * terminal transition to promote it. Two defects came out of that shape.
 *
 * A parked row was excluded from the watchdog, so a promotion that never fired
 * left it queued forever with no signal (#2986). The pool has no parked state —
 * it owns the queue and drains itself, and its own recovery pass fails a job
 * whose completion never ran, so a lost job cannot sit invisible.
 *
 * The budget was also undifferentiated, so a connector backlog held every slot
 * and member uploads waited behind it — seven days of it on a live deployment
 * (#2987). Provenance now picks the pool, so the two kinds of work no longer
 * compete.
 */

import type { GenericMutationCtx } from 'convex/server';
import { v } from 'convex/values';

import { internal } from '../_generated/api';
import type { DataModel, Doc, Id } from '../_generated/dataModel';
import { internalMutation } from '../_generated/server';
import type { BlobRef } from '../lib/storage/blob_ref';
import { ragPoolFor } from './rag_pools';

type MutationCtx = GenericMutationCtx<DataModel>;

/**
 * A Document Hub row whose document has since been replaced must not index:
 * its blob is no longer the document's current file. Chat-bound rows
 * (`threadId`) and plain uploads have no document to diverge from.
 */
async function isCurrentHubRow(
  ctx: MutationCtx,
  row: Doc<'fileMetadata'>,
): Promise<boolean> {
  if (!row.documentId || row.threadId) return true;
  const document = await ctx.db.get(row.documentId);
  return (
    document !== null &&
    document.organizationId === row.organizationId &&
    (document.fileId ?? '') === row.storageId
  );
}

async function failSupersededHubRow(
  ctx: MutationCtx,
  row: Doc<'fileMetadata'>,
): Promise<void> {
  await ctx.db.patch(row._id, {
    ragStatus: 'failed',
    ragError: 'Indexing stopped because this file was replaced.',
    ragProgress: undefined,
    ragParked: undefined,
  });
}

/**
 * Record a pool job's outcome on the row it indexed.
 *
 * The pool guarantees this runs — via its recovery pass if the job itself
 * vanished — so it is the single place a terminal `ragStatus` is written for a
 * pooled job. A row cannot be stranded mid-flight the way a parked row could.
 *
 * A success leaves the status alone: the indexing action writes `'completed'`
 * with its chunk counts as it finishes, and overwriting that here would erase
 * detail the action has and this mutation does not.
 */
export const recordRagJobResult = internalMutation({
  // The pool's own `vOnCompleteArgs` helper is NOT used: it builds its
  // validator with its own resolved copy of `convex`, and the identity check
  // inside `v.object()` then rejects a validator built with the platform's
  // copy ("v.object() entries must be validators"). Declaring the documented
  // shape here with our own validators avoids depending on which copy wins.
  args: {
    workId: v.string(),
    context: v.object({ storageId: v.string() }),
    result: v.union(
      v.object({ kind: v.literal('success'), returnValue: v.any() }),
      v.object({ kind: v.literal('failed'), error: v.string() }),
      v.object({ kind: v.literal('canceled') }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    if (args.result.kind === 'success') return null;
    const row = await ctx.db
      .query('fileMetadata')
      .withIndex('by_storageId', (q) =>
        q.eq('storageId', args.context.storageId),
      )
      .first();
    if (!row) return null;
    // The action's own catch writes a specific message where it can reach one.
    // This covers what it cannot: a hard kill at the 30-minute action ceiling,
    // a backend restart, a cancel from the dashboard.
    if (row.ragStatus === 'completed') return null;
    const detail =
      args.result.kind === 'failed' ? args.result.error : 'Indexing canceled.';
    await ctx.db.patch(row._id, {
      ragStatus: 'failed',
      ragError: detail.slice(0, 500),
      ragProgress: undefined,
      ragParked: undefined,
    });
    return null;
  },
});

/**
 * Enqueue a `'queued'` row's indexing action on the pool its provenance picks.
 *
 * Called by every writer that marks a row `'queued'`. A no-op when the row is
 * gone or is not queued (audio, unsupported types), and when a Hub row's
 * document has moved on.
 *
 * Both ingestion paths write `fileMetadata` rows, so the action has to match
 * the row: a current Document Hub row indexes through the documents pipeline,
 * every other queued row is a plain file upload.
 */
export async function maybeDispatchRagIndexing(
  ctx: MutationCtx,
  storageId: BlobRef,
): Promise<void> {
  const row = await ctx.db
    .query('fileMetadata')
    .withIndex('by_storageId', (q) => q.eq('storageId', storageId))
    .first();
  if (!row || row.ragStatus !== 'queued') return;
  if (!(await isCurrentHubRow(ctx, row))) {
    await failSupersededHubRow(ctx, row);
    return;
  }
  // `ragParked` is no longer written. Clearing it keeps a row that predates
  // the pools readable as in-flight rather than parked forever.
  if (row.ragParked) {
    await ctx.db.patch(row._id, { ragParked: undefined });
  }

  await enqueueRagIndexing(ctx, row);
}

/**
 * Enqueue a row's indexing action on the pool its provenance selects, writing
 * nothing to the row itself.
 *
 * Separate from the guards above so the cutover migration can enqueue a row
 * that predates the pools WITHOUT touching any field — a migration that writes
 * nothing is reversible by construction, and there is no second copy of the
 * pool choice or the action choice to drift.
 */
export interface RagIndexableRow {
  readonly organizationId: string;
  readonly storageId: BlobRef;
  readonly fileName: string;
  readonly contentType: string;
  readonly source?: string | undefined;
  readonly documentId?: Id<'documents'> | undefined;
  readonly threadId?: string | undefined;
}

export async function enqueueRagIndexing(
  ctx: MutationCtx,
  row: RagIndexableRow,
): Promise<void> {
  const pool = ragPoolFor(row.source);

  if (row.documentId && !row.threadId) {
    await pool.enqueueAction(
      ctx,
      internal.documents.internal_actions.uploadDocumentToRag,
      { documentId: row.documentId, expectedFileId: row.storageId },
      {
        onComplete: internal.file_metadata.rag_dispatch.recordRagJobResult,
        context: { storageId: String(row.storageId) },
      },
    );
    return;
  }
  await pool.enqueueAction(
    ctx,
    internal.file_metadata.internal_actions.uploadFileToRag,
    {
      organizationId: row.organizationId,
      storageId: row.storageId,
      fileName: row.fileName,
      contentType: row.contentType,
    },
    {
      onComplete: internal.file_metadata.rag_dispatch.recordRagJobResult,
      context: { storageId: String(row.storageId) },
    },
  );
}
