import { v } from 'convex/values';

import { internal } from '../_generated/api';
import { internalAction } from '../_generated/server';
import { isE2ECronSuppressed } from '../lib/e2e_cron_guard';
import { orgSlugFromIdOrNull } from '../lib/helpers/org_slug';
import type { BlobRef } from '../lib/storage/blob_ref';

/**
 * A row is only a recovery candidate once its age exceeds the Convex 30-min
 * action ceiling with margin. Convex hard-kills an action at 30 min WITHOUT
 * running its catch block, so an indexing job that dies there (a large file,
 * or a backend restart mid-index) leaves `fileMetadata.ragStatus` stuck at
 * `'running'` — and the server poller that would have timed it out can die in
 * the same event. 35 min guarantees a genuinely-live in-action job is never
 * swept.
 */
const STALE_AFTER_MS = 35 * 60 * 1000;

/**
 * Bound the work of a single tick so one mass-stuck incident (e.g. a batch of
 * large uploads all interrupted by a redeploy) can't make one run unbounded.
 * The next 5-min tick drains the remainder.
 */
const MAX_PER_RUN = 200;

/**
 * How far back `failed` rows stay in the reconcile sweep. Recent failures may
 * be false (a straggling writer beat a live indexing chain) and self-heal when
 * the corpus reaches its real terminal state; older ones are settled history.
 */
const FAILED_RECONCILE_WINDOW_MS = 48 * 60 * 60 * 1000;

/**
 * Detail stored on `ragError` when a row is failed by the watchdog. English,
 * matching every other server-written `ragError` (the UI badge label is
 * localized separately). Names the cause and the remedy — the desk "Retry
 * indexing" affordance re-queues the file.
 */
const INTERRUPTED_MESSAGE =
  'Indexing was interrupted (timed out or the backend restarted before it ' +
  'finished). Use "Retry indexing" to run it again.';

/**
 * Watchdog: recover `fileMetadata` rows stuck in RAG indexing.
 *
 * Convex actions have no `finally`-on-kill guarantee at the 30-min ceiling, so
 * three failure shapes strand a row forever:
 *  - `'running'` whose indexing action was killed mid-transaction,
 *  - `'queued'` whose scheduled `uploadFileToRag` never ran,
 *  - either of the above whose server poll chain (`pollFileRagStatus`) died
 *    alongside the action.
 * The desk has no client-side poller, so these never self-heal without this
 * sweep — the exact "after an indexing error, nothing indexes anymore" report.
 *
 * Reconciles each candidate against the knowledge corpus BEFORE failing it, so
 * a file whose indexing actually SUCCEEDED (but whose poll chain died before
 * writing `'completed'`) is adopted as completed instead of being wrongly
 * failed. Only fails a row when the corpus was reachable and reports the
 * document as dead: `processing` counts as dead only once the corpus row has
 * stopped moving for the stale window (sliced indexing touches it per batch),
 * `null` means never ingested. A corpus lookup that THROWS (knowledge-db
 * transient fault) is left for the next tick rather than failing the whole
 * org's rows — the cross-org failure-propagation hazard the chat poller guards.
 *
 * RECENT `failed` rows are reconciled too, so a false failure self-heals
 * without a manual retry: a straggling writer (killed sibling dispatcher, dead
 * poll chain) may have stamped `failed` while the indexing chain lived on —
 * when the corpus later reads `completed` the row is adopted, while a live
 * fresh-`processing` corpus flips it back to `running`, and a corpus-side
 * `failed` refreshes the row with the REAL terminal error.
 *
 * Scheduled from `crons.ts` every 5 minutes; suppressed under E2E (the
 * hermetic stack has no knowledge DB, so every upload deterministically fails
 * and this would just add churn).
 */
export const recoverStuckRagIndexing = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx): Promise<null> => {
    if (isE2ECronSuppressed()) return null;

    const candidates = await ctx.runQuery(
      internal.file_metadata.internal_queries.listStuckRagCandidates,
      {
        staleBeforeMs: Date.now() - STALE_AFTER_MS,
        failedAfterMs: Date.now() - FAILED_RECONCILE_WINDOW_MS,
        limit: MAX_PER_RUN,
      },
    );
    if (candidates.length === 0) return null;

    // One knowledge-corpus status call per distinct org.
    type CandidateRow = {
      storageId: BlobRef;
      ragStatus: 'queued' | 'running' | 'failed';
      ragError?: string;
    };
    const byOrg = new Map<string, CandidateRow[]>();
    for (const c of candidates) {
      const entry: CandidateRow = {
        storageId: c.storageId,
        ragStatus: c.ragStatus,
        ...(c.ragError !== undefined && { ragError: c.ragError }),
      };
      const bucket = byOrg.get(c.organizationId);
      if (bucket) bucket.push(entry);
      else byOrg.set(c.organizationId, [entry]);
    }

    for (const [organizationId, rows] of byOrg) {
      const orgSlug = await orgSlugFromIdOrNull(ctx, organizationId);

      // Org row gone (deleted). getStatuses can't be called; the files are
      // orphaned. Fail them so any lingering poll stops — matches
      // `pollFileRagStatus`'s unresolvable-org branch.
      if (orgSlug === null) {
        for (const row of rows) {
          if (row.ragStatus === 'failed') continue;
          await ctx.runMutation(
            internal.file_metadata.internal_mutations.updateFileRagStatus,
            {
              storageId: row.storageId,
              ragStatus: 'failed',
              ragError: 'Organization unresolvable (deleted or missing slug).',
            },
          );
        }
        continue;
      }

      let statuses: Record<
        string,
        {
          status: string;
          error: string | null;
          ocr_applied: boolean | null;
          updated_at: string | null;
        } | null
      > = {};
      try {
        statuses = await ctx.runAction(
          internal.knowledge.corpus_status.getStatuses,
          {
            orgSlug,
            fileIds: rows.map((r) => String(r.storageId)),
          },
        );
      } catch (error) {
        // Transient knowledge-db fault: do NOT fail this org's rows on a
        // reachability blip — leave them for the next tick.
        console.warn(
          `[recoverStuckRagIndexing] status lookup failed for org ${orgSlug}; deferring ${rows.length} row(s):`,
          error instanceof Error ? error.message : String(error),
        );
        continue;
      }

      for (const row of rows) {
        const docStatus = statuses[row.storageId] ?? null;

        if (docStatus?.status === 'completed') {
          // Indexing succeeded; only the status write was lost. Adopt it.
          await ctx.runMutation(
            internal.file_metadata.internal_mutations.updateFileRagStatus,
            {
              storageId: row.storageId,
              ragStatus: 'completed',
              ...(docStatus.ocr_applied != null && {
                ocrApplied: docStatus.ocr_applied,
              }),
            },
          );
          continue;
        }

        if (docStatus?.status === 'failed') {
          const realError = docStatus.error || INTERRUPTED_MESSAGE;
          // Already failed with the same text → nothing to reconcile; without
          // this the failed-row sweep would rewrite the row every tick.
          if (row.ragStatus === 'failed' && row.ragError === realError) {
            continue;
          }
          await ctx.runMutation(
            internal.file_metadata.internal_mutations.updateFileRagStatus,
            {
              storageId: row.storageId,
              ragStatus: 'failed',
              ragError: realError,
            },
          );
          continue;
        }

        // A `processing` corpus row is no longer dead just because the
        // fileMetadata row is old: sliced indexing (#2752) keeps a large
        // document legitimately `processing` for hours, touching the row's
        // `updated_at` on every committed batch. Only declare it dead when the
        // row itself has stopped moving for the stale window — a live run is
        // left alone for the next tick.
        if (docStatus?.status === 'processing') {
          const updatedAtMs = docStatus.updated_at
            ? Date.parse(docStatus.updated_at)
            : Number.NaN;
          const fresh =
            Number.isFinite(updatedAtMs) &&
            Date.now() - updatedAtMs < STALE_AFTER_MS;
          if (fresh) {
            // A failed row with a LIVE corpus chain is a false failure (a
            // straggling writer lost the race) — flip it back to running so
            // the user watches real progress instead of a wrong error.
            if (row.ragStatus === 'failed') {
              await ctx.runMutation(
                internal.file_metadata.internal_mutations.updateFileRagStatus,
                { storageId: row.storageId, ragStatus: 'running' },
              );
            }
            continue;
          }
        }

        // Dead job (stale processing or never ingested): an already-failed row
        // is already terminal — never overwrite its (possibly real) error with
        // the generic interrupted text.
        if (row.ragStatus === 'failed') {
          continue;
        }

        // Stale `processing` (no batch committed for the whole stale window)
        // or `null` (never ingested): the job is not going to finish. Fail
        // with a retryable message. The corpus was reachable (getStatuses did
        // not throw), so this is a confirmed dead job, not a reachability
        // blip.
        await ctx.runMutation(
          internal.file_metadata.internal_mutations.updateFileRagStatus,
          {
            storageId: row.storageId,
            ragStatus: 'failed',
            ragError: INTERRUPTED_MESSAGE,
          },
        );
      }
    }

    return null;
  },
});
