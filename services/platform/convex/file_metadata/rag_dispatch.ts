import type { GenericMutationCtx } from 'convex/server';

import { internal } from '../_generated/api';
import type { DataModel, Doc, Id } from '../_generated/dataModel';

type MutationCtx = GenericMutationCtx<DataModel>;

/**
 * Max file-indexing jobs a single org may run at once. Indexing is a
 * synchronous extract/chunk/embed inside a Node action against the shared
 * knowledge-db pool (default max 10 connections); an unbounded batch of large
 * uploads saturated the pool and pushed single jobs past Convex's 30-min action
 * ceiling — the root of the "larger files didn't work consistently" report.
 * 3 keeps a healthy margin under the pool while draining a backlog steadily.
 */
export const MAX_CONCURRENT_RAG_INDEXING_PER_ORG = 3;

/**
 * Count an org's in-flight file-indexing jobs: rows that are `'running'`, plus
 * `'queued'` rows whose action is actually dispatched (NOT parked). Iterates
 * the `by_organizationId_and_ragStatus_and_documentId` index and short-circuits
 * at the cap, so it never materializes more than a handful of rows.
 *
 * `excludeStorageId` omits the row being decided on: at enqueue the caller's own
 * row is already `'queued'` (and would otherwise count against itself, making
 * the effective cap one too small).
 */
async function countRagInFlight(
  ctx: MutationCtx,
  organizationId: string,
  excludeStorageId?: Id<'_storage'>,
): Promise<number> {
  let inFlight = 0;
  for await (const row of ctx.db
    .query('fileMetadata')
    .withIndex('by_organizationId_and_ragStatus_and_documentId', (q) =>
      q.eq('organizationId', organizationId).eq('ragStatus', 'running'),
    )) {
    if (row.storageId === excludeStorageId) continue;
    inFlight += 1;
    if (inFlight >= MAX_CONCURRENT_RAG_INDEXING_PER_ORG) return inFlight;
  }
  for await (const row of ctx.db
    .query('fileMetadata')
    .withIndex('by_organizationId_and_ragStatus_and_documentId', (q) =>
      q.eq('organizationId', organizationId).eq('ragStatus', 'queued'),
    )) {
    if (row.storageId === excludeStorageId) continue;
    if (row.ragParked !== true) {
      inFlight += 1;
      if (inFlight >= MAX_CONCURRENT_RAG_INDEXING_PER_ORG) return inFlight;
    }
  }
  return inFlight;
}

/** Schedule the upload-path indexing action for a row and clear any park flag. */
async function dispatchRow(
  ctx: MutationCtx,
  row: Doc<'fileMetadata'>,
): Promise<void> {
  if (row.ragParked) {
    await ctx.db.patch(row._id, { ragParked: undefined });
  }
  await ctx.scheduler.runAfter(
    0,
    internal.file_metadata.internal_actions.uploadFileToRag,
    {
      organizationId: row.organizationId,
      storageId: row.storageId,
      fileName: row.fileName,
      contentType: row.contentType,
    },
  );
}

/**
 * Enqueue-time gate for the upload → `uploadFileToRag` path. The caller has
 * already written the `fileMetadata` row as `'queued'`; this decides whether to
 * dispatch its indexing action now or park it. Under the cap → dispatch;
 * at/over the cap → set `ragParked` and leave it for `promoteQueuedRagJobs`.
 * No-op if the row is gone or not `'queued'` (e.g. audio/unsupported).
 */
export async function maybeDispatchRagIndexing(
  ctx: MutationCtx,
  storageId: Id<'_storage'>,
): Promise<void> {
  const row = await ctx.db
    .query('fileMetadata')
    .withIndex('by_storageId', (q) => q.eq('storageId', storageId))
    .first();
  if (!row || row.ragStatus !== 'queued') return;

  const inFlight = await countRagInFlight(ctx, row.organizationId, storageId);
  if (inFlight < MAX_CONCURRENT_RAG_INDEXING_PER_ORG) {
    await dispatchRow(ctx, row);
  } else if (row.ragParked !== true) {
    await ctx.db.patch(row._id, { ragParked: true });
  }
}

/**
 * Promote parked jobs for an org until the cap is reached. Called on every
 * terminal RAG transition (a completion/failure frees a slot) so a parked
 * backlog drains as jobs finish. The watchdog also reaches this path — when it
 * fails a stuck dispatched job it calls the terminal mutation, which promotes —
 * so a parked row can never be stranded while any job is in flight.
 */
export async function promoteQueuedRagJobs(
  ctx: MutationCtx,
  organizationId: string,
): Promise<void> {
  let inFlight = await countRagInFlight(ctx, organizationId);
  while (inFlight < MAX_CONCURRENT_RAG_INDEXING_PER_ORG) {
    let next: Doc<'fileMetadata'> | null = null;
    for await (const row of ctx.db
      .query('fileMetadata')
      .withIndex('by_organizationId_and_ragStatus_and_documentId', (q) =>
        q.eq('organizationId', organizationId).eq('ragStatus', 'queued'),
      )) {
      if (row.ragParked === true) {
        next = row;
        break;
      }
    }
    if (!next) return;
    await dispatchRow(ctx, next);
    inFlight += 1;
  }
}
