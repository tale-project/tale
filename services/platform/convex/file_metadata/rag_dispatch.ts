import type { GenericMutationCtx } from 'convex/server';

import { internal } from '../_generated/api';
import type { DataModel, Doc } from '../_generated/dataModel';
import type { BlobRef } from '../lib/storage/blob_ref';

type MutationCtx = GenericMutationCtx<DataModel>;

/**
 * Max file-indexing jobs a single org may run at once. Indexing is a
 * synchronous extract/chunk/embed inside a Node action against the shared
 * knowledge-db pool (default max 10 connections); an unbounded batch of large
 * uploads saturated the pool and pushed single jobs past Convex's 30-min action
 * ceiling — the root of the "larger files didn't work consistently" report.
 * The per-org cap isolates tenants: one org's backlog never touches another's
 * slots or parked queue.
 */
export const MAX_CONCURRENT_RAG_INDEXING_PER_ORG = 3;

/**
 * Max file-indexing jobs across ALL orgs at once. The knowledge-db pool is
 * shared per deployment, so the per-org cap alone doesn't bound total load —
 * N orgs × the per-org cap can exceed the pool. This global ceiling sits under
 * the default pool max (10), leaving headroom for RAG search + status polls,
 * and promotion is fair (oldest-first, still per-org-capped) so a busy org
 * can't starve a quiet one for the shared budget.
 */
export const MAX_CONCURRENT_RAG_INDEXING_GLOBAL = 8;

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
  excludeStorageId?: BlobRef,
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

/**
 * Count in-flight file-indexing jobs across ALL orgs — `'running'` rows plus
 * dispatched (non-parked) `'queued'` rows — via the `by_ragStatus` index.
 * Short-circuits at the global cap.
 */
async function countGlobalRagInFlight(
  ctx: MutationCtx,
  excludeStorageId?: BlobRef,
): Promise<number> {
  let inFlight = 0;
  for await (const row of ctx.db
    .query('fileMetadata')
    .withIndex('by_ragStatus', (q) => q.eq('ragStatus', 'running'))) {
    if (row.storageId === excludeStorageId) continue;
    inFlight += 1;
    if (inFlight >= MAX_CONCURRENT_RAG_INDEXING_GLOBAL) return inFlight;
  }
  for await (const row of ctx.db
    .query('fileMetadata')
    .withIndex('by_ragStatus', (q) => q.eq('ragStatus', 'queued'))) {
    if (row.storageId === excludeStorageId) continue;
    if (row.ragParked !== true) {
      inFlight += 1;
      if (inFlight >= MAX_CONCURRENT_RAG_INDEXING_GLOBAL) return inFlight;
    }
  }
  return inFlight;
}

/**
 * Schedule the indexing action for a row and clear any park flag. Both
 * ingestion paths write `fileMetadata` rows and count against the same cap, so
 * the dispatcher must schedule whichever action matches the row: a Document Hub
 * row (`documentId` set, not chat-bound) indexes through the documents pipeline
 * (`uploadDocumentToRag`); every other queued row is a plain file upload
 * (`uploadFileToRag`). Keeps a parked hub-doc row correct when the fair promoter
 * later dispatches it.
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

async function dispatchRow(
  ctx: MutationCtx,
  row: Doc<'fileMetadata'>,
): Promise<boolean> {
  if (!(await isCurrentHubRow(ctx, row))) {
    await failSupersededHubRow(ctx, row);
    return false;
  }
  if (row.ragParked) {
    await ctx.db.patch(row._id, { ragParked: undefined });
  }
  if (row.documentId && !row.threadId) {
    await ctx.scheduler.runAfter(
      0,
      internal.documents.internal_actions.uploadDocumentToRag,
      {
        documentId: row.documentId,
        expectedFileId: row.storageId,
      },
    );
    return true;
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
  return true;
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
  storageId: BlobRef,
): Promise<void> {
  const row = await ctx.db
    .query('fileMetadata')
    .withIndex('by_storageId', (q) => q.eq('storageId', storageId))
    .first();
  if (!row || row.ragStatus !== 'queued') return;

  // Dispatch only when BOTH the org's slots and the shared global budget have
  // room; otherwise park and let the fair promoter pick it up.
  const orgInFlight = await countRagInFlight(
    ctx,
    row.organizationId,
    storageId,
  );
  const globalInFlight =
    orgInFlight < MAX_CONCURRENT_RAG_INDEXING_PER_ORG
      ? await countGlobalRagInFlight(ctx, storageId)
      : MAX_CONCURRENT_RAG_INDEXING_GLOBAL;
  if (
    orgInFlight < MAX_CONCURRENT_RAG_INDEXING_PER_ORG &&
    globalInFlight < MAX_CONCURRENT_RAG_INDEXING_GLOBAL
  ) {
    if (!(await dispatchRow(ctx, row))) {
      await promoteQueuedRagJobs(ctx);
    }
  } else if (row.ragParked !== true) {
    await ctx.db.patch(row._id, { ragParked: true });
  }
}

/**
 * Promote parked jobs across ALL orgs when slots free, called on every terminal
 * RAG transition. Fairness: it walks parked rows oldest-first (the `by_ragStatus`
 * index is ordered by `_creationTime`) and dispatches each whose org is still
 * under its per-org cap, up to the global cap — so the shared budget is shared
 * FIFO across tenants while no single org can take more than its per-org share.
 * Because a job failed by the watchdog is a terminal transition too, a parked
 * row can never be stranded while any job is in flight.
 *
 * Single scan pass: per-org in-flight counts are computed once (lazily) and
 * tracked as dispatches are projected, and rows are dispatched after the scan
 * so iteration is never mutated mid-flight.
 */
export async function promoteQueuedRagJobs(ctx: MutationCtx): Promise<void> {
  let globalInFlight = await countGlobalRagInFlight(ctx);
  if (globalInFlight >= MAX_CONCURRENT_RAG_INDEXING_GLOBAL) return;

  const orgProjected = new Map<string, number>();
  const toDispatch: Doc<'fileMetadata'>[] = [];
  for await (const row of ctx.db
    .query('fileMetadata')
    .withIndex('by_ragStatus', (q) => q.eq('ragStatus', 'queued'))) {
    if (globalInFlight >= MAX_CONCURRENT_RAG_INDEXING_GLOBAL) break;
    if (row.ragParked !== true) continue;
    if (!(await isCurrentHubRow(ctx, row))) {
      await failSupersededHubRow(ctx, row);
      continue;
    }

    let orgCount = orgProjected.get(row.organizationId);
    if (orgCount === undefined) {
      orgCount = await countRagInFlight(ctx, row.organizationId);
    }
    if (orgCount < MAX_CONCURRENT_RAG_INDEXING_PER_ORG) {
      toDispatch.push(row);
      orgProjected.set(row.organizationId, orgCount + 1);
      globalInFlight += 1;
    } else {
      // Remember the cap-hit so the org's later parked rows skip the recount.
      orgProjected.set(row.organizationId, orgCount);
    }
  }

  for (const row of toDispatch) {
    await dispatchRow(ctx, row);
  }
}
