'use node';

/**
 * Per-org blob BACKFILL — move an org's PRE-EXISTING Convex `_storage` blobs
 * into its bring-your-own S3 bucket. When an org configures object storage,
 * only NEW uploads route to the bucket; this engine relocates the historical
 * blobs so every byte lives in the org's own infrastructure (data residency).
 *
 * # Why this is NOT a versioned migration
 *
 * The migrations framework (`convex/migrations/`) is deploy-coupled: every
 * migration runs once per deployment at a release boundary, ledgered and
 * reversible against the world corpus. This move is the opposite shape —
 * org-scoped, operator/admin-triggered ON DEMAND, and gated on per-org runtime
 * config (the bucket connection, which an org may add years after any release).
 * A deploy-hook migration cannot express "run when the admin turns this on",
 * so the backfill is a plain internal action with its own run ledger
 * (`objectStorageBackfillRuns`); the versioned framework stays untouched.
 *
 * # Scope
 *
 * Exactly the rows whose blob references are S3-routed today:
 * `fileMetadata.storageId`, `documents.fileId`, `documents.historyFiles[]`.
 * Other tables' blobs are not yet routed through the blob seam and MUST NOT be
 * moved — their readers only know `_storage`.
 *
 * # Crash safety (per blob)
 *
 *   read `_storage` bytes → `putBlob` into the org bucket → GET the object
 *   back and byte-compare → ONE ATOMIC MUTATION rewrites every referencing row
 *   AND deletes the `_storage` source.
 *
 * The rewrite+delete transaction means the classic "rows rewritten but source
 * not yet deleted" crash window cannot exist; a crash anywhere else leaves the
 * blob readable (source intact, at worst an orphaned copy in the bucket that a
 * re-run supersedes). Re-runs are idempotent: `s3:` refs are skipped at
 * enumeration, incomplete blobs are simply re-done.
 *
 * # Ordering: documents first
 *
 * `documents.historyFiles` has no reverse index, so "which documents reference
 * storage id X?" is only answerable by visiting every document. The engine
 * therefore drains the DOCUMENTS phase first — every history entry is
 * rewritten while its own row is in hand — and only then walks fileMetadata,
 * by which point no document can still reference a convex id (all
 * `historyFiles` writers append the document's own previous `fileId`, so a
 * history entry is never shared across documents). The two indexed lookups
 * (`fileMetadata.by_storageId`, `documents.by_organizationId_and_fileId`)
 * cover every other sharing shape in both phases.
 *
 * # Budgeting
 *
 * A Convex node action is hard-killed near ~10 min, so the engine processes
 * pages until a WALL-CLOCK budget elapses, persists its cursor + counters on
 * the run row, and reschedules itself (the `scan_scheduler.ts` pattern). All
 * knobs are env-tunable. Memory is bounded: one blob's bytes (plus its verify
 * read-back) at a time, never an accumulation.
 */

import { ConvexError, v } from 'convex/values';

import { internal } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import { internalAction, type ActionCtx } from '../_generated/server';
import { orgSlugFromId } from '../lib/helpers/org_slug';
import {
  deleteBlob,
  isS3Ref,
  putBlob,
  readBlobBytes,
} from '../lib/storage/blob_access';
import { resolveOrgObjectStore } from '../lib/storage/object_store';

const envInt = (name: string, fallback: number): number => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

interface BackfillKnobs {
  /** Wall-clock budget per action before rescheduling a continuation. */
  budgetMs: number;
  /** Rows per enumeration page. */
  pageSize: number;
  /** Hard page cap per action (0 = budget-only) — deterministic lever for tests/pacing. */
  maxPagesPerRun: number;
  /** Hard cap on the self-continuation chain from a single trigger. */
  maxContinuations: number;
  /** Pause between chained actions, keeping the backend responsive. */
  pacingMs: number;
}

/** Read at call time (not module init) so operators/tests can tune per run. */
function readKnobs(): BackfillKnobs {
  return {
    budgetMs: envInt('OBJECT_STORAGE_BACKFILL_BUDGET_MS', 240_000),
    pageSize: envInt('OBJECT_STORAGE_BACKFILL_PAGE_SIZE', 25),
    maxPagesPerRun: envInt('OBJECT_STORAGE_BACKFILL_MAX_PAGES_PER_RUN', 0),
    maxContinuations: envInt('OBJECT_STORAGE_BACKFILL_MAX_CONTINUATIONS', 1000),
    pacingMs: envInt('OBJECT_STORAGE_BACKFILL_PACING_MS', 1000),
  };
}

/** Dry-run sample cap — enough to eyeball, bounded on the run row. */
const SAMPLE_CAP = 50;

type RunDoc = Doc<'objectStorageBackfillRuns'>;
type Phase = RunDoc['phase'];

/** Mutable per-run totals, flushed to the run row after every page. */
interface Totals {
  rowsScanned: number;
  migrated: number;
  skipped: number;
  failed: number;
  bytesMigrated: number;
  candidates: number;
  candidateBytes: number;
  sample: { ref: string; table: string; name?: string; size?: number }[];
}

/** A page's distinct convex-backed blob to move, merged across its rows. */
interface PageCandidate {
  ref: string;
  size: number | null;
  contentType: string | null;
  table: 'documents' | 'fileMetadata';
  name?: string;
  /** A document whose `historyFiles` may carry the ref (no reverse index). */
  drivingDocumentId?: Id<'documents'>;
}

/** A failure that must abort the RUN (not just skip the blob). */
class BackfillRunAborted extends Error {
  override readonly name = 'BackfillRunAborted';
}

/** Did a heartbeat bounce because the run row is no longer 'running'? */
function isRunNotActive(err: unknown): boolean {
  return (
    err instanceof ConvexError &&
    typeof err.data === 'object' &&
    err.data !== null &&
    'code' in err.data &&
    err.data.code === 'RUN_NOT_ACTIVE'
  );
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Move ONE blob: read the `_storage` source, put it into the org's bucket,
 * verify the object round-trips byte-identically, then atomically rewrite all
 * referencing rows and delete the source. Fail-closed per blob: any error is
 * logged + counted and the source is left fully intact — one bad blob never
 * wedges the run.
 */
async function migrateOneBlob(
  ctx: ActionCtx,
  run: RunDoc,
  candidate: { ref: string; contentType: string | null },
  drivingDocumentId: Id<'documents'> | undefined,
  totals: Totals,
): Promise<void> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- candidate.ref came out of `convexStorageId`
  const storageId = candidate.ref as Id<'_storage'>;
  try {
    const blob = await ctx.storage.get(storageId);
    if (blob === null) {
      // Disambiguate: an earlier candidate's atomic rewrite may already have
      // moved this blob (this candidate came from a now-stale page snapshot —
      // nothing references it anymore, a clean skip). A blob that is missing
      // while rows still point at it is a genuine failure.
      const stillReferenced = await ctx.runQuery(
        internal.object_storage.backfill_internal.isStorageIdReferenced,
        {
          organizationId: run.organizationId,
          storageId,
          drivingDocumentId,
        },
      );
      if (!stillReferenced) {
        console.info(
          `[blob-backfill] ${candidate.ref} already handled earlier in the run (no row references it); skipping`,
        );
        return;
      }
      totals.failed++;
      console.warn(
        `[blob-backfill] blob missing in _storage: ${candidate.ref} (org ${run.orgSlug}) but rows still reference it; skipping`,
      );
      return;
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const contentType =
      blob.type || candidate.contentType || 'application/octet-stream';

    const newRef = await putBlob(ctx, run.orgSlug, bytes, contentType);
    if (!isS3Ref(newRef)) {
      // The org stopped resolving to S3 mid-run (config removed?). `putBlob`
      // stored a DUPLICATE convex blob — remove it and abort the whole run:
      // continuing would churn rows without moving anything off Convex.
      try {
        await deleteBlob(ctx, run.orgSlug, newRef);
      } catch (cleanupErr) {
        console.warn(
          `[blob-backfill] cleanup of duplicate convex blob ${String(newRef)} failed: ${
            cleanupErr instanceof Error
              ? cleanupErr.message
              : String(cleanupErr)
          }`,
        );
      }
      throw new BackfillRunAborted(
        `org '${run.orgSlug}' no longer resolves to an S3 object store; aborting`,
      );
    }

    // Verify BEFORE any row is touched: GET the object back and compare byte
    // length + content. Never rewrite or delete on a mismatch.
    const readBack = await readBlobBytes(ctx, run.orgSlug, newRef);
    if (
      readBack.byteLength !== bytes.byteLength ||
      !bytesEqual(readBack, bytes)
    ) {
      totals.failed++;
      console.error(
        `[blob-backfill] verify mismatch for ${candidate.ref} → ${String(newRef)} ` +
          `(${bytes.byteLength} bytes written, ${readBack.byteLength} read back); source left intact`,
      );
      try {
        await deleteBlob(ctx, run.orgSlug, newRef);
      } catch (cleanupErr) {
        console.warn(
          `[blob-backfill] cleanup of mismatched object ${String(newRef)} failed: ${
            cleanupErr instanceof Error
              ? cleanupErr.message
              : String(cleanupErr)
          }`,
        );
      }
      return;
    }

    const res = await ctx.runMutation(
      internal.object_storage.backfill_internal.rewriteBlobRefAndDelete,
      {
        organizationId: run.organizationId,
        fromStorageId: storageId,
        toRef: String(newRef),
        drivingDocumentId,
      },
    );
    if (res.foreignRows > 0) {
      // Rows outside the org still reference the source (should be impossible)
      // — their rows were NOT rewritten and the source was kept so they stay
      // readable. This org's rows all point at the bucket now.
      totals.skipped++;
      console.warn(
        `[blob-backfill] ${res.foreignRows} row(s) outside org '${run.orgSlug}' still reference ` +
          `${candidate.ref}; _storage source kept (delete withheld)`,
      );
      return;
    }
    totals.migrated++;
    totals.bytesMigrated += bytes.byteLength;
  } catch (err) {
    if (err instanceof BackfillRunAborted) throw err;
    totals.failed++;
    console.error(
      `[blob-backfill] failed to migrate ${candidate.ref} (org ${run.orgSlug}): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

/**
 * The backfill engine. Directly runnable by an operator
 * (`convex run object_storage/backfill_actions:migrateOrgBlobsToObjectStorage
 * '{"organizationId": "…"}'`) — it creates its own run row when `runId` is
 * absent; the admin-facing trigger is
 * `object_storage/actions.ts:startObjectStorageBlobBackfill`. Progress lives on
 * the `objectStorageBackfillRuns` row (see `backfill_queries.ts`).
 *
 * `dryRun: true` only counts + samples what WOULD move — zero writes. A ref
 * shared between a document and a fileMetadata row is counted once per phase
 * in the dry run, so the real run's `migrated` (distinct blobs) may come in
 * lower than `candidates`.
 */
export const migrateOrgBlobsToObjectStorage = internalAction({
  args: {
    organizationId: v.string(),
    dryRun: v.optional(v.boolean()),
    /** Present on continuations + when the public trigger pre-created the run. */
    runId: v.optional(v.id('objectStorageBackfillRuns')),
    /** Better Auth user id of the triggering admin (audit trail on the run row). */
    triggeredBy: v.optional(v.string()),
  },
  returns: v.object({ runId: v.id('objectStorageBackfillRuns') }),
  handler: async (
    ctx,
    args,
  ): Promise<{ runId: Id<'objectStorageBackfillRuns'> }> => {
    const knobs = readKnobs();

    let runId = args.runId;
    if (!runId) {
      // Operator entry: resolve the slug and open the run here (the public
      // trigger resolves membership + slug itself and passes `runId`).
      const orgSlug = await orgSlugFromId(ctx, args.organizationId);
      runId = await ctx.runMutation(
        internal.object_storage.backfill_internal.createRun,
        {
          organizationId: args.organizationId,
          orgSlug,
          dryRun: args.dryRun ?? false,
          triggeredBy: args.triggeredBy,
        },
      );
    }
    const run: RunDoc | null = await ctx.runQuery(
      internal.object_storage.backfill_internal.getRun,
      { runId },
    );
    if (!run) {
      console.warn(`[blob-backfill] run ${runId} not found; nothing to do`);
      return { runId };
    }
    if (run.status !== 'running') {
      console.warn(
        `[blob-backfill] run ${runId} is '${run.status}'; not continuing`,
      );
      return { runId };
    }

    // Fail-closed: a REAL run must target the org's own bucket. (A dry run is
    // allowed without one — "what would move?" is a legitimate pre-config
    // question and it writes nothing.) A present-but-broken connection also
    // fails the run here (`resolveOrgObjectStore` throws fail-closed) instead
    // of leaving it wedged 'running'.
    if (!run.dryRun) {
      let backend: 'convex' | 's3';
      let resolveError: string | null = null;
      try {
        backend = (await resolveOrgObjectStore(run.orgSlug)).backend;
      } catch (err) {
        backend = 'convex';
        resolveError = err instanceof Error ? err.message : String(err);
      }
      if (backend !== 's3') {
        const message =
          resolveError !== null
            ? `object-storage connection for org '${run.orgSlug}' is unusable (${resolveError}); refusing to move blobs`
            : `org '${run.orgSlug}' has no object-storage connection configured; refusing to move blobs`;
        console.error(`[blob-backfill] ${message}`);
        await ctx.runMutation(
          internal.object_storage.backfill_internal.finishRun,
          { runId, status: 'failed', lastError: message },
        );
        return { runId };
      }
    }

    const totals: Totals = {
      rowsScanned: run.rowsScanned,
      migrated: run.migrated,
      skipped: run.skipped,
      failed: run.failed,
      bytesMigrated: run.bytesMigrated,
      candidates: run.candidates,
      candidateBytes: run.candidateBytes,
      sample: [...run.sample],
    };
    let phase: Phase = run.phase;
    let cursor: string | null = run.cursor;
    const deadline = Date.now() + knobs.budgetMs;
    let pagesThisRun = 0;

    const flush = async (): Promise<void> => {
      await ctx.runMutation(
        internal.object_storage.backfill_internal.updateRunProgress,
        { runId, phase, cursor, continuation: run.continuation, ...totals },
      );
    };

    try {
      while (
        phase !== 'done' &&
        Date.now() < deadline &&
        (knobs.maxPagesPerRun === 0 || pagesThisRun < knobs.maxPagesPerRun)
      ) {
        pagesThisRun++;
        // Distinct candidates for THIS page: several rows in one page can
        // reference the same storageId (a document's fileId doubling as
        // another's history entry, etc.). The first candidate's atomic
        // rewrite+delete would make its page-snapshot siblings stale, so the
        // blob is migrated once per page with all row shapes covered by the
        // rewrite's indexed lookups. (Cross-page duplicates never arise —
        // each page is fetched AFTER the previous page's rewrites, so an
        // already-moved ref comes back as `s3:` and is filtered out.)
        const candidates = new Map<string, PageCandidate>();
        const addCandidate = (
          candidate: {
            ref: string;
            size: number | null;
            contentType: string | null;
          },
          table: 'documents' | 'fileMetadata',
          name: string | undefined,
          drivingDocumentId: Id<'documents'> | undefined,
        ): void => {
          const existing = candidates.get(candidate.ref);
          if (existing) {
            if (!existing.drivingDocumentId && drivingDocumentId) {
              existing.drivingDocumentId = drivingDocumentId;
            }
            if (existing.contentType === null) {
              existing.contentType = candidate.contentType;
            }
            return;
          }
          candidates.set(candidate.ref, {
            ref: candidate.ref,
            size: candidate.size,
            contentType: candidate.contentType,
            table,
            name,
            drivingDocumentId,
          });
        };

        if (phase === 'documents') {
          const result = await ctx.runQuery(
            internal.object_storage.backfill_internal.pageDocumentBlobRefs,
            {
              organizationId: run.organizationId,
              cursor,
              numItems: knobs.pageSize,
            },
          );
          for (const row of result.page) {
            totals.rowsScanned++;
            for (const candidate of row.refs) {
              addCandidate(candidate, 'documents', row.name, row.documentId);
            }
          }
          cursor = result.continueCursor;
          if (result.isDone) {
            phase = 'fileMetadata';
            cursor = null;
          }
        } else {
          const result = await ctx.runQuery(
            internal.object_storage.backfill_internal.pageFileMetadataBlobRefs,
            {
              organizationId: run.organizationId,
              cursor,
              numItems: knobs.pageSize,
            },
          );
          for (const row of result.page) {
            totals.rowsScanned++;
            for (const candidate of row.refs) {
              addCandidate(candidate, 'fileMetadata', row.name, undefined);
            }
          }
          cursor = result.continueCursor;
          if (result.isDone) {
            phase = 'done';
            cursor = null;
          }
        }

        for (const candidate of candidates.values()) {
          if (run.dryRun) {
            totals.candidates++;
            totals.candidateBytes += candidate.size ?? 0;
            if (totals.sample.length < SAMPLE_CAP) {
              totals.sample.push({
                ref: candidate.ref,
                table: candidate.table,
                name: candidate.name,
                size: candidate.size ?? undefined,
              });
            }
          } else {
            await migrateOneBlob(
              ctx,
              run,
              candidate,
              candidate.drivingDocumentId,
              totals,
            );
          }
        }
        await flush();
      }
    } catch (err) {
      // Run-level failure (aborted mid-blob or an enumeration/flush error).
      // Everything flushed so far is durable; re-triggering resumes safely
      // (idempotent per blob).
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[blob-backfill] run ${runId} failed: ${message}`);
      if (isRunNotActive(err)) {
        // A rejected heartbeat: the run was superseded while this invocation
        // stalled — the replacement run owns the row now, so just stop.
        return { runId };
      }
      try {
        await flush();
      } catch (flushErr) {
        console.warn(
          `[blob-backfill] final progress flush for run ${runId} failed: ${
            flushErr instanceof Error ? flushErr.message : String(flushErr)
          }`,
        );
      }
      await ctx.runMutation(
        internal.object_storage.backfill_internal.finishRun,
        { runId, status: 'failed', lastError: message },
      );
      return { runId };
    }

    if (phase === 'done') {
      await ctx.runMutation(
        internal.object_storage.backfill_internal.finishRun,
        { runId, status: 'completed' },
      );
      console.info(
        `[blob-backfill] ${run.dryRun ? 'DRY RUN ' : ''}completed for org '${run.orgSlug}': ` +
          `${totals.rowsScanned} rows scanned, ${totals.migrated} blob(s) migrated ` +
          `(${totals.bytesMigrated} bytes), ${totals.skipped} skipped, ${totals.failed} failed` +
          (run.dryRun
            ? `, ${totals.candidates} candidate ref(s) (${totals.candidateBytes} bytes) would move`
            : ''),
      );
      return { runId };
    }

    // Budget elapsed with work remaining — continue in a fresh action.
    if (run.continuation + 1 > knobs.maxContinuations) {
      const message = `continuation cap (${knobs.maxContinuations}) reached; re-trigger the backfill to resume from the saved cursor`;
      console.error(`[blob-backfill] run ${runId}: ${message}`);
      await ctx.runMutation(
        internal.object_storage.backfill_internal.finishRun,
        { runId, status: 'failed', lastError: message },
      );
      return { runId };
    }
    await ctx.runMutation(
      internal.object_storage.backfill_internal.updateRunProgress,
      { runId, phase, cursor, continuation: run.continuation + 1, ...totals },
    );
    await ctx.scheduler.runAfter(
      knobs.pacingMs,
      internal.object_storage.backfill_actions.migrateOrgBlobsToObjectStorage,
      { organizationId: run.organizationId, runId },
    );
    return { runId };
  },
});
