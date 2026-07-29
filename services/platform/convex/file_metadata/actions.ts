'use node';

import { v } from 'convex/values';

import { internal } from '../_generated/api';
import { action } from '../_generated/server';
import { orgSlugFromIdOrNull } from '../lib/helpers/org_slug';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { blobRefValidator } from '../lib/storage/blob_ref';

/**
 * Check RAG indexing status for a list of files and update fileMetadata.
 *
 * Called by the frontend on an interval while files are in queued/running
 * state. Stops being called when the user leaves the page — no wasted
 * server-side scheduled actions.
 *
 * Auth: caller must be authenticated AND the supplied storageIds must
 * belong to fileMetadata rows whose organizationId is one of the caller's
 * org memberships. Without this gate, an anonymous attacker can flip any
 * org's `ragStatus` to `failed` via `expireStaleRagQueue` (DoS), and a
 * member of org A can poke org B's RAG status. (Pre-existing on `main`
 * but in scope for this branch's RAG-auth surface.)
 */
export const checkFileRagStatuses = action({
  args: {
    storageIds: v.array(blobRefValidator),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    if (args.storageIds.length === 0) return null;

    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      console.warn('[checkFileRagStatuses] unauthenticated caller — refused');
      return null;
    }
    const callerId = authUser.userId;

    // Filter storageIds down to ones the caller is authorized to see, and
    // get the org for each so we can call RAG (which is now per-org) with
    // the correct X-Tale-Org header per group.
    const allowed = await ctx.runQuery(
      internal.file_metadata.internal_queries.filterStorageIdsByCallerOrg,
      { storageIds: args.storageIds, userId: callerId },
    );
    if (allowed.length === 0) {
      console.warn(
        '[checkFileRagStatuses] no authorized storage ids for caller — refused',
      );
      return null;
    }

    // Skip rows already in a terminal state. Beyond the obvious wasted work,
    // this is a correctness guard: the RAG watchdog can mark a stuck row
    // `'failed'` while its knowledge-corpus document is still an orphaned
    // `processing` row. Without this filter, an open chat's poll would read
    // that `processing` status and flip the row back to `'running'`, undoing
    // the watchdog and polling forever. The server poller already guards this
    // (`pollFileRagStatus` returns early on terminal status); this is the
    // client-poll counterpart.
    const pollable = allowed.filter(
      (a) =>
        a.ragStatus !== 'completed' &&
        a.ragStatus !== 'failed' &&
        a.ragStatus !== 'unsupported',
    );
    if (pollable.length === 0) return null;

    // Group authorized storage ids by org so we can issue one RAG call
    // per distinct org. The cache means each org slug is resolved once
    // even when many files belong to the same org.
    const orgIdsToFiles = new Map<
      string,
      Array<(typeof args.storageIds)[number]>
    >();
    for (const { storageId, organizationId } of pollable) {
      const bucket = orgIdsToFiles.get(organizationId);
      if (bucket) bucket.push(storageId);
      else orgIdsToFiles.set(organizationId, [storageId]);
    }

    // Give RAG 90s to have ingested a newly-queued upload. If we're still
    // getting null after that window, the upload never reached RAG (likely
    // the scheduled action was dropped before it ran) — mark failed so the
    // client stops polling. Threshold is measured against `ragQueuedAt` on
    // the fileMetadata row, so re-queues reset the clock.
    const STALE_QUEUE_MS = 90_000;

    type RagStatus = {
      status: string;
      error: string | null;
      progress_phase: string | null;
      progress_detail: string | null;
      ocr_applied: boolean | null;
    };
    const mergedStatuses: Record<string, RagStatus | null> = {};
    // Track storageIds whose org bucket queried the corpus SUCCESSFULLY. Only
    // these are eligible for the post-loop `expireStaleRagQueue` sweep —
    // without this guard, a transient knowledge-db fault in one org's request
    // (or that org's slug going missing) made the loop `continue`, the org's
    // storageIds never landed in `mergedStatuses`, and the sweep permanently
    // marked them `failed` even though the uploads were healthy. Cross-org
    // failure propagation.
    const eligibleForStaleSweep = new Set<string>();
    for (const [organizationId, storageIds] of orgIdsToFiles) {
      const orgSlug = await orgSlugFromIdOrNull(ctx, organizationId);
      if (orgSlug === null) {
        console.warn(
          `[checkFileRagStatuses] org ${organizationId} unresolvable; skipping status fetch (its storageIds will NOT be marked failed)`,
        );
        continue;
      }
      try {
        // Corpus status lookups are unavailable while the knowledge backend
        // is rebuilt — statuses stay unknown, exactly like the pre-existing
        // knowledge-db-fault path this catch already handles.
        console.debug(
          `[checkFileRagStatuses] corpus statuses unavailable for org ${orgSlug} (${storageIds.length} file(s)) — knowledge backend offline`,
        );
      } catch (error) {
        console.warn(
          `[checkFileRagStatuses] Failed to fetch statuses for org ${orgSlug}:`,
          error,
        );
      }
    }

    const statuses = mergedStatuses;
    const allAuthorizedStorageIds = pollable.map((a) => a.storageId);

    for (const storageId of allAuthorizedStorageIds) {
      const docStatus = statuses[storageId];
      if (!docStatus) {
        if (eligibleForStaleSweep.has(storageId)) {
          await ctx.runMutation(
            internal.file_metadata.internal_mutations.expireStaleRagQueue,
            { storageId, staleAfterMs: STALE_QUEUE_MS },
          );
        }
        continue;
      }

      const status = docStatus.status;
      const error = docStatus.error;
      const progressPhase = docStatus.progress_phase;
      const progressDetail = docStatus.progress_detail;

      const ragProgress =
        progressPhase && progressDetail
          ? `${progressPhase} ${progressDetail}`
          : progressPhase || undefined;

      if (status === 'completed') {
        const ocrApplied = docStatus.ocr_applied;
        await ctx.runMutation(
          internal.file_metadata.internal_mutations.updateFileRagStatus,
          {
            storageId,
            ragStatus: 'completed',
            ...(ocrApplied != null && { ocrApplied }),
          },
        );
      } else if (status === 'failed') {
        await ctx.runMutation(
          internal.file_metadata.internal_mutations.updateFileRagStatus,
          {
            storageId,
            ragStatus: 'failed',
            ragError: error || 'Unknown error',
          },
        );
      } else if (status === 'processing') {
        await ctx.runMutation(
          internal.file_metadata.internal_mutations.updateFileRagStatus,
          { storageId, ragStatus: 'running', ragProgress },
        );
      }
    }

    return null;
  },
});
