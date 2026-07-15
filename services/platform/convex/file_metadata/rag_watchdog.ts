import { v } from 'convex/values';

import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { internalAction } from '../_generated/server';
import { isE2ECronSuppressed } from '../lib/e2e_cron_guard';
import { orgSlugFromIdOrNull } from '../lib/helpers/org_slug';

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
 * document as still `processing` (a >35-min-old processing row is dead) or
 * absent (`null` — never ingested). A corpus lookup that THROWS (knowledge-db
 * transient fault) is left for the next tick rather than failing the whole
 * org's rows — the cross-org failure-propagation hazard the chat poller guards.
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
      { staleBeforeMs: Date.now() - STALE_AFTER_MS, limit: MAX_PER_RUN },
    );
    if (candidates.length === 0) return null;

    // One knowledge-corpus status call per distinct org.
    const byOrg = new Map<string, Array<{ storageId: Id<'_storage'> }>>();
    for (const c of candidates) {
      const bucket = byOrg.get(c.organizationId);
      if (bucket) bucket.push({ storageId: c.storageId });
      else byOrg.set(c.organizationId, [{ storageId: c.storageId }]);
    }

    for (const [organizationId, rows] of byOrg) {
      const orgSlug = await orgSlugFromIdOrNull(ctx, organizationId);

      // Org row gone (deleted). getStatuses can't be called; the files are
      // orphaned. Fail them so any lingering poll stops — matches
      // `pollFileRagStatus`'s unresolvable-org branch.
      if (orgSlug === null) {
        for (const row of rows) {
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
        } | null
      > = {};
      try {
        const result = await ctx.runAction(internal.rag.documents.getStatuses, {
          orgSlug,
          fileIds: rows.map((r) => r.storageId),
        });
        statuses = result.statuses;
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
          await ctx.runMutation(
            internal.file_metadata.internal_mutations.updateFileRagStatus,
            {
              storageId: row.storageId,
              ragStatus: 'failed',
              ragError: docStatus.error || INTERRUPTED_MESSAGE,
            },
          );
          continue;
        }

        // `processing` (a >35-min-old corpus row whose indexer is dead) or
        // `null` (never ingested): the job is not going to finish. Fail with
        // a retryable message. The corpus was reachable (getStatuses did not
        // throw), so this is a confirmed dead job, not a reachability blip.
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
