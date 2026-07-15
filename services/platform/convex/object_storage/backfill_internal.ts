import { ConvexError, v } from 'convex/values';

import type { Doc, Id } from '../_generated/dataModel';
import {
  internalMutation,
  internalQuery,
  type QueryCtx,
} from '../_generated/server';
import { convexStorageId } from '../lib/storage/blob_ref';

/**
 * V8 half of the per-org blob backfill (the `'use node'` engine lives in
 * `backfill_actions.ts`): paginated enumeration of the org's convex-backed blob
 * references, the ATOMIC rewrite-and-delete mutation, and the run-row
 * lifecycle. Kept out of the node module because `'use node'` files may only
 * export actions.
 */

/** How stale a 'running' heartbeat may be before the run counts as crashed. */
const STALE_RUN_MS = 10 * 60 * 1000;

/** One enumerated convex-backed blob reference (with its `_storage` metadata). */
const candidateRefValidator = v.object({
  /** The `_storage` id, as the string stored in the row. */
  ref: v.string(),
  /** Blob size from the `_storage` system doc; null when the blob is missing. */
  size: v.union(v.number(), v.null()),
  contentType: v.union(v.string(), v.null()),
});

interface CandidateRef {
  ref: string;
  size: number | null;
  contentType: string | null;
}

/** Collect the distinct convex-backed refs of a row, joined with blob metadata. */
async function toCandidateRefs(
  ctx: QueryCtx,
  refs: (string | Id<'_storage'>)[],
): Promise<CandidateRef[]> {
  const seen = new Set<string>();
  const out: CandidateRef[] = [];
  for (const ref of refs) {
    const storageId = convexStorageId(ref);
    if (storageId === null || seen.has(String(storageId))) continue;
    seen.add(String(storageId));
    const meta = await ctx.db.system.get(storageId);
    out.push({
      ref: String(storageId),
      size: typeof meta?.size === 'number' ? meta.size : null,
      contentType:
        typeof meta?.contentType === 'string' ? meta.contentType : null,
    });
  }
  return out;
}

/**
 * One page of the org's DOCUMENTS with their convex-backed blob refs
 * (`fileId` + every `historyFiles[]` entry). Rows whose refs are all `s3:`
 * come back with an empty `refs` array — still scanned, nothing to move.
 */
export const pageDocumentBlobRefs = internalQuery({
  args: {
    organizationId: v.string(),
    cursor: v.union(v.string(), v.null()),
    numItems: v.number(),
  },
  returns: v.object({
    page: v.array(
      v.object({
        documentId: v.id('documents'),
        name: v.optional(v.string()),
        refs: v.array(candidateRefValidator),
      }),
    ),
    isDone: v.boolean(),
    continueCursor: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query('documents')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .paginate({ cursor: args.cursor, numItems: args.numItems });
    const page = [];
    for (const doc of result.page) {
      const rawRefs = [
        ...(doc.fileId ? [doc.fileId] : []),
        ...(doc.historyFiles ?? []),
      ];
      page.push({
        documentId: doc._id,
        name: doc.title,
        refs: await toCandidateRefs(ctx, rawRefs),
      });
    }
    return {
      page,
      isDone: result.isDone,
      continueCursor: result.isDone ? null : result.continueCursor,
    };
  },
});

/**
 * One page of the org's FILE-METADATA rows with their convex-backed
 * `storageId` (empty `refs` when the row already points at `s3:`).
 */
export const pageFileMetadataBlobRefs = internalQuery({
  args: {
    organizationId: v.string(),
    cursor: v.union(v.string(), v.null()),
    numItems: v.number(),
  },
  returns: v.object({
    page: v.array(
      v.object({
        name: v.optional(v.string()),
        refs: v.array(candidateRefValidator),
      }),
    ),
    isDone: v.boolean(),
    continueCursor: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query('fileMetadata')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .paginate({ cursor: args.cursor, numItems: args.numItems });
    const page = [];
    for (const row of result.page) {
      page.push({
        name: row.fileName,
        refs: await toCandidateRefs(ctx, [row.storageId]),
      });
    }
    return {
      page,
      isDone: result.isDone,
      continueCursor: result.isDone ? null : result.continueCursor,
    };
  },
});

/**
 * Is `fromStorageId` still referenced by any of the org's rows? Disambiguates
 * a `_storage` miss during the run: an earlier candidate's rewrite may already
 * have moved this blob (its page-snapshot sibling is stale — nothing references
 * it anymore, a clean skip), whereas a still-referenced-but-missing blob is a
 * genuine failure the operator must see. Checks the two indexed reference
 * shapes plus the driving document's `historyFiles`.
 */
export const isStorageIdReferenced = internalQuery({
  args: {
    organizationId: v.string(),
    storageId: v.id('_storage'),
    drivingDocumentId: v.optional(v.id('documents')),
  },
  returns: v.boolean(),
  handler: async (ctx, args): Promise<boolean> => {
    const fileRow = await ctx.db
      .query('fileMetadata')
      .withIndex('by_storageId', (q) => q.eq('storageId', args.storageId))
      .first();
    if (fileRow) return true;
    const docRow = await ctx.db
      .query('documents')
      .withIndex('by_organizationId_and_fileId', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('fileId', args.storageId),
      )
      .first();
    if (docRow) return true;
    if (args.drivingDocumentId) {
      const doc = await ctx.db.get(args.drivingDocumentId);
      if (doc?.historyFiles?.includes(args.storageId)) return true;
    }
    return false;
  },
});

/**
 * ATOMICALLY rewrite every row that references `fromStorageId` to `toRef`, then
 * delete the `_storage` blob — one transaction, so the crash window between
 * "rows rewritten" and "source deleted" cannot exist: either nothing happened
 * (rows still convex-backed, blob intact, re-run redoes the copy) or everything
 * did (rows `s3:`, source gone).
 *
 * Coverage: fileMetadata rows via the global `by_storageId` index, documents
 * via `by_organizationId_and_fileId`, and the DRIVING document's
 * `historyFiles[]` occurrences (history has no reverse index; the engine's
 * documents-first phase order guarantees every history entry is visited —
 * all `historyFiles` writers only ever append the document's own previous
 * `fileId`, so a history entry is never shared across documents).
 *
 * TENANT ISOLATION / fail-safe: a referencing row that belongs to a DIFFERENT
 * org (should be impossible) is never rewritten, and the source blob is then
 * kept (delete withheld) so that row stays readable.
 */
export const rewriteBlobRefAndDelete = internalMutation({
  args: {
    organizationId: v.string(),
    fromStorageId: v.id('_storage'),
    /** The verified `s3:<key>` reference the rows move to. */
    toRef: v.string(),
    /** The document whose `historyFiles` drove this blob, when applicable. */
    drivingDocumentId: v.optional(v.id('documents')),
  },
  returns: v.object({
    rewrittenRows: v.number(),
    foreignRows: v.number(),
    deleted: v.boolean(),
  }),
  handler: async (ctx, args) => {
    if (!args.toRef.startsWith('s3:')) {
      // Never rewrite rows at something that is not an org-bucket ref — a bug
      // upstream must fail loudly, not corrupt references.
      throw new ConvexError({
        code: 'INVALID_TARGET_REF',
        message: `refusing to rewrite blob refs to non-s3 target "${args.toRef}"`,
      });
    }
    let rewrittenRows = 0;
    let foreignRows = 0;

    const fileRows = await ctx.db
      .query('fileMetadata')
      .withIndex('by_storageId', (q) => q.eq('storageId', args.fromStorageId))
      .collect();
    for (const row of fileRows) {
      if (row.organizationId !== args.organizationId) {
        foreignRows++;
        continue;
      }
      await ctx.db.patch(row._id, { storageId: args.toRef });
      rewrittenRows++;
    }

    const docRows = await ctx.db
      .query('documents')
      .withIndex('by_organizationId_and_fileId', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('fileId', args.fromStorageId),
      )
      .collect();
    for (const doc of docRows) {
      await ctx.db.patch(doc._id, { fileId: args.toRef });
      rewrittenRows++;
    }

    if (args.drivingDocumentId) {
      const doc = await ctx.db.get(args.drivingDocumentId);
      if (doc && doc.organizationId === args.organizationId) {
        const patch: Partial<Doc<'documents'>> = {};
        if (doc.fileId === args.fromStorageId) patch.fileId = args.toRef;
        if (doc.historyFiles?.includes(args.fromStorageId)) {
          patch.historyFiles = doc.historyFiles.map((ref) =>
            ref === args.fromStorageId ? args.toRef : ref,
          );
        }
        if (Object.keys(patch).length > 0) {
          await ctx.db.patch(doc._id, patch);
          rewrittenRows++;
        }
      }
    }

    let deleted = false;
    if (foreignRows === 0) {
      try {
        await ctx.storage.delete(args.fromStorageId);
        deleted = true;
      } catch (err) {
        // Already gone (e.g. a prior partial run) — the rows are rewritten and
        // the bytes live in the bucket, which is the converged state.
        console.warn(
          `[blob-backfill] _storage delete failed for ${args.fromStorageId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    return { rewrittenRows, foreignRows, deleted };
  },
});

/** Load a run row (engine + continuation entry). */
export const getRun = internalQuery({
  args: { runId: v.id('objectStorageBackfillRuns') },
  returns: v.any(),
  handler: async (
    ctx,
    args,
  ): Promise<Doc<'objectStorageBackfillRuns'> | null> => {
    return await ctx.db.get(args.runId);
  },
});

/**
 * Create a run row — the single-flight gate. Refuses while another run for the
 * org is 'running' with a fresh heartbeat; a STALE 'running' row (crashed
 * engine, no continuation ever fired) is marked failed and superseded.
 */
export const createRun = internalMutation({
  args: {
    organizationId: v.string(),
    orgSlug: v.string(),
    dryRun: v.boolean(),
    triggeredBy: v.optional(v.string()),
  },
  returns: v.id('objectStorageBackfillRuns'),
  handler: async (ctx, args): Promise<Id<'objectStorageBackfillRuns'>> => {
    const now = Date.now();
    const existing = await ctx.db
      .query('objectStorageBackfillRuns')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .collect();
    for (const run of existing) {
      if (run.status !== 'running') continue;
      if (now - run.updatedAt < STALE_RUN_MS) {
        throw new ConvexError({
          code: 'BACKFILL_ALREADY_RUNNING',
          message:
            'A blob backfill is already running for this organization. Wait for it to finish (or go stale) before starting another.',
        });
      }
      await ctx.db.patch(run._id, {
        status: 'failed',
        lastError: 'superseded — run went stale without a heartbeat',
        finishedAt: now,
        updatedAt: now,
      });
    }
    return await ctx.db.insert('objectStorageBackfillRuns', {
      organizationId: args.organizationId,
      orgSlug: args.orgSlug,
      dryRun: args.dryRun,
      status: 'running',
      phase: 'documents',
      cursor: null,
      continuation: 0,
      rowsScanned: 0,
      migrated: 0,
      skipped: 0,
      failed: 0,
      bytesMigrated: 0,
      candidates: 0,
      candidateBytes: 0,
      sample: [],
      startedAt: now,
      updatedAt: now,
      triggeredBy: args.triggeredBy,
    });
  },
});

const progressPatchArgs = {
  runId: v.id('objectStorageBackfillRuns'),
  phase: v.union(
    v.literal('documents'),
    v.literal('fileMetadata'),
    v.literal('done'),
  ),
  cursor: v.union(v.string(), v.null()),
  continuation: v.number(),
  rowsScanned: v.number(),
  migrated: v.number(),
  skipped: v.number(),
  failed: v.number(),
  bytesMigrated: v.number(),
  candidates: v.number(),
  candidateBytes: v.number(),
  sample: v.array(
    v.object({
      ref: v.string(),
      table: v.string(),
      name: v.optional(v.string()),
      size: v.optional(v.number()),
    }),
  ),
} as const;

/**
 * Flush absolute progress totals + the resume cursor; doubles as the
 * heartbeat. Refuses a run that is no longer 'running' — that kills a zombie
 * engine invocation whose run was superseded after going stale (one blob
 * stalled longer than the staleness window), instead of letting it fight the
 * replacement run over the same row.
 */
export const updateRunProgress = internalMutation({
  args: progressPatchArgs,
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const { runId, ...progress } = args;
    const run = await ctx.db.get(runId);
    if (!run || run.status !== 'running') {
      throw new ConvexError({
        code: 'RUN_NOT_ACTIVE',
        message: `backfill run ${runId} is ${run ? `'${run.status}'` : 'gone'}; progress rejected`,
      });
    }
    await ctx.db.patch(runId, { ...progress, updatedAt: Date.now() });
    return null;
  },
});

/** Terminal transition — completed or failed (with the recorded error). */
export const finishRun = internalMutation({
  args: {
    runId: v.id('objectStorageBackfillRuns'),
    status: v.union(v.literal('completed'), v.literal('failed')),
    lastError: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const now = Date.now();
    await ctx.db.patch(args.runId, {
      status: args.status,
      lastError: args.lastError,
      finishedAt: now,
      updatedAt: now,
    });
    return null;
  },
});
