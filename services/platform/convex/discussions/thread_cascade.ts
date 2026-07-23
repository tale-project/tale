/**
 * Discussion-thread cascade — physically removes a `threadMetadata` thread
 * and every descendant row. Retention Pass B, GDPR erasure, and task
 * deletion all depend on this helper.
 *
 * Relocated from `legacy/thread_cascade.ts` by the 0.4 baseline reset with
 * the retired-table arms (messageMetadata, threadTodos, threadBranches,
 * ttsAudioChunks, agentWebhookUserThreads, slackThreads) removed — those
 * tables no longer exist. What remains is the LIVE cascade for the
 * discussion/thread world: sandbox rows, approvals, feedback, filter
 * events, chat-upload files (+ RAG purge), video-link jobs, the
 * agent-component thread, sub-threads, and finally the metadata row.
 *
 * The user-initiated delete path does NOT call cascade — it only flips
 * status to `'trashed'`. Pass B (after grace expiry) calls this helper to
 * physically remove the thread + all its descendant rows.
 */

import { makeFunctionReference } from 'convex/server';

import { parseJson } from '../../lib/utils/type-utils';
import { components, internal } from '../_generated/api';
import type { MutationCtx } from '../_generated/server';
import { createAuditLog } from '../audit_logs/helpers';
import type { ActiveHolds } from '../governance/legal_hold';
import { loadActiveHolds } from '../governance/legal_hold';
import type {
  DeleteDocumentsBatchArgs,
  DeleteDocumentsBatchResult,
} from '../legacy/knowledge_delete';
import { orgSlugFromIdOrNull } from '../lib/helpers/org_slug';
import {
  deleteBlobInMutation,
  scheduleS3BlobDeletes,
} from '../lib/storage/blob_delete';

// Audit actions emitted by this file. Keep grep-able:
//   chat_thread.cascade_skipped_hold

/**
 * Structure of the subThreads mapping in parent thread summary.
 * Origin: the retired `agent_tools/sub_agents/helpers/types.ts`
 * (`SubThreadsMap`) — inlined here because `agent_tools/` was retired
 * wholesale along with the rest of the sub-agent orchestration code.
 */
type SubThreadsMap = Record<string, string>;

/**
 * Extended summary structure for threads with sub-thread mappings.
 * Origin: the retired `agent_tools/sub_agents/helpers/types.ts`
 * (`ThreadSummaryWithSubThreads`).
 */
interface ThreadSummaryWithSubThreads {
  chatType?: string;
  subThreads?: SubThreadsMap;
  [key: string]: unknown;
}

/**
 * Origin: the retired `threads/delete_chat_thread.ts`
 * (`parseSubThreadIds`) — inlined here (rather than imported) because that
 * module was retired along with the rest of `convex/threads/`. Behavior is
 * unchanged: malformed/missing summaries fall back to "no sub-threads"
 * rather than throwing, so a single corrupt thread can't wedge the cascade.
 */
function parseSubThreadIds(summary: string | undefined): string[] {
  if (!summary) return [];

  try {
    const parsed = parseJson<ThreadSummaryWithSubThreads>(summary);
    if (!parsed.subThreads) return [];
    return Object.values(parsed.subThreads).filter(
      (id): id is string => typeof id === 'string',
    );
  } catch (err) {
    // Malformed summary — log so an operator can investigate, but
    // gracefully fall back to "no sub-threads" so the cascade can
    // continue. CLAUDE.md prohibits silent catches; this surfaces the
    // failure without making the cascade brittle.
    console.warn(
      '[parseSubThreadIds] failed to parse summary; treating as no sub-threads',
      err,
    );
    return [];
  }
}

const PAGE_SIZE = 200;

// Corpus purge for a deleted thread's files — see knowledge_delete.ts for
// why this reference is built by hand instead of via `internal.legacy.*`.
const deleteKnowledgeDocumentsBatch = makeFunctionReference<
  'action',
  DeleteDocumentsBatchArgs,
  DeleteDocumentsBatchResult
>('legacy/knowledge_delete:deleteDocumentsBatch');

/**
 * Hard ceiling on cascade recursion depth. Sub-thread links are stored as
 * free-form JSON inside `thread.summary` (round-2 v12 H6); a malformed
 * summary that reaches itself, or a deeply-nested legitimate tree,
 * could otherwise blow the Convex per-mutation write/scan budget or
 * loop forever. 32 is well above any realistic agent-driven nesting
 * (researcher subagent fan-out tops out at 4-5) but small enough that
 * a malicious row throws fast.
 */
const MAX_CASCADE_DEPTH = 32;

/**
 * Delete every descendant of `threadId` belonging to `organizationId`,
 * then the agent-component thread, then the threadMetadata row itself.
 *
 * Idempotent: re-invoking on an already-empty thread is a no-op (each
 * paged query returns zero rows).
 *
 * Bounded per call by PAGE_SIZE per child table. For threads with > 200
 * rows in any single child table, the caller is expected to invoke this
 * helper repeatedly until `done: true` is returned.
 */
export async function cascadeDeleteThreadChildren(
  ctx: MutationCtx,
  args: {
    threadId: string;
    organizationId: string | undefined;
    /**
     * Pre-fetched active holds for the org. When the caller already
     * holds a snapshot (retention dispatcher, GDPR erasure path), pass
     * it; the helper consults it before recursing into sub-threads so
     * a held child isn't silently wiped when its parent ages out.
     *
     * When omitted AND organizationId is set, the helper loads holds
     * itself for defense-in-depth — the snapshot-race window means a
     * caller's pre-fetched snapshot can be stale by the time the per-
     * thread cascade fires. Re-reading the row at cascade time is the
     * only authoritative gate.
     */
    holds?: ActiveHolds;
    /**
     * Recursion guard state, threaded through sub-thread recursion.
     * `visited` blocks summary-reference cycles (A→B→A) and
     * `depth` enforces `MAX_CASCADE_DEPTH`. The top-level caller
     * leaves these undefined; recursive calls pass them through.
     */
    visited?: Set<string>;
    depth?: number;
  },
): Promise<{ done: boolean; remaining: number; skippedByHold?: boolean }> {
  const { threadId, organizationId } = args;
  const depth = args.depth ?? 0;
  if (depth >= MAX_CASCADE_DEPTH) {
    if (organizationId !== undefined) {
      await createAuditLog(ctx, {
        organizationId,
        actorId: 'system',
        actorType: 'system',
        action: 'chat_thread.cascade_depth_exceeded',
        category: 'data',
        resourceType: 'thread',
        resourceId: threadId,
        resourceName: threadId,
        status: 'failure',
        errorMessage: `Cascade depth ${depth} >= ${MAX_CASCADE_DEPTH}`,
        metadata: { depth, maxDepth: MAX_CASCADE_DEPTH },
      });
    } else {
      console.warn(
        `[cascadeDeleteThreadChildren] depth ${depth} >= ${MAX_CASCADE_DEPTH} for thread ${threadId} — aborting recursion`,
      );
    }
    return { done: true, remaining: 0 };
  }
  const visited = args.visited ?? new Set<string>();
  if (visited.has(threadId)) {
    return { done: true, remaining: 0 };
  }
  visited.add(threadId);

  // Authoritative legal-hold check at cascade time. Re-reads even if the
  // caller passed a snapshot (the snapshot can be stale; a hold placed
  // mid-run otherwise has zero protection). Skips silently if the row is
  // held — the caller (retention dispatcher / erasure) is responsible
  // for surfacing the skip in its audit row.
  if (organizationId !== undefined) {
    const holds = args.holds ?? (await loadActiveHolds(ctx, organizationId));
    // Org-wide hold blocks every cascade. Per-thread hold target type
    // was deprecated by the User+Org pivot; user-custodian cascade is
    // checked via the thread metadata's `userId` (round-2 V3 P0).
    let userCustodianHeld = false;
    if (!holds.orgHeld) {
      const meta = await ctx.db
        .query('threadMetadata')
        .withIndex('by_threadId', (q) => q.eq('threadId', threadId))
        .first();
      if (meta?.userId && holds.userMembershipIds.has(meta.userId)) {
        userCustodianHeld = true;
      }
    }
    if (holds.orgHeld || userCustodianHeld) {
      // Emit a real audit row so the chain reflects "we attempted to
      // cascade and refused due to hold". Without this, the verifier /
      // operator UI sees no record of the skip — only a console line —
      // which makes "did this thread get deleted?" forensics fragile.
      await createAuditLog(ctx, {
        organizationId,
        actorId: 'system',
        actorType: 'system',
        action: 'chat_thread.cascade_skipped_hold',
        category: 'data',
        resourceType: 'thread',
        resourceId: threadId,
        resourceName: threadId,
        status: 'denied',
        metadata: {
          orgHeld: holds.orgHeld,
          userCustodianHeld,
        },
      });
      // Report the skip back to the caller (GDPR Art 17 erasure
      // distinguishes "thread cascade completed" from "preserved by
      // mid-flight hold" so the receipt's `threadsSkippedByHold`
      // counter reflects what was actually preserved).
      return { done: true, remaining: 0, skippedByHold: true };
    }
    // Stash for the sub-thread recursion below so we don't re-fetch.
    args.holds = holds;
  }

  // 1. The AGENT sandbox is per-USER (one persistent sandbox shared across
  // all the user's threads), so deleting a thread must NOT tear down the
  // sandbox — only prune this thread's progress/op rows. Thread-owned
  // sessions (the turn-scoped run_code session, destroyed at end of turn by
  // destroyThreadOwnedSessions; plus pre-per-user legacy rows) are destroyed
  // here too — normally a no-op, but it covers a thread deleted mid-turn.
  // Op deletion + teardown are scheduled (mutations can't make the HTTP
  // teardown calls).
  await ctx.scheduler.runAfter(
    0,
    internal.sandbox.session_mutations.deleteOpsForThread,
    { threadId },
  );
  const legacyThreadSessions = [];
  for await (const row of ctx.db
    .query('sandboxSessions')
    .withIndex('by_owner', (q) =>
      q.eq('ownerType', 'thread').eq('ownerId', threadId),
    )) {
    if (row.status !== 'destroyed' && row.status !== 'expired') {
      legacyThreadSessions.push(row);
    }
  }
  if (legacyThreadSessions.length > 0) {
    for (const row of legacyThreadSessions) {
      await ctx.db.patch(row._id, {
        status: 'destroyed',
        destroyedAt: Date.now(),
      });
    }
    await ctx.scheduler.runAfter(
      0,
      internal.node_only.sandbox.session_teardown.teardownThreadSessions,
      { sessionIds: legacyThreadSessions.map((r) => r.sessionId) },
    );
  }

  // 2. approvals (only rows tied to this thread)
  const approvalsPage = await ctx.db
    .query('approvals')
    .withIndex('by_threadId', (q) => q.eq('threadId', threadId))
    .take(PAGE_SIZE);
  for (const row of approvalsPage) {
    await ctx.db.delete(row._id);
  }
  if (approvalsPage.length === PAGE_SIZE) {
    return { done: false, remaining: 1 };
  }

  // 3. messageFeedback
  const feedbackPage = await ctx.db
    .query('messageFeedback')
    .withIndex('by_threadId', (q) => q.eq('threadId', threadId))
    .take(PAGE_SIZE);
  for (const row of feedbackPage) {
    await ctx.db.delete(row._id);
  }
  if (feedbackPage.length === PAGE_SIZE) {
    return { done: false, remaining: 1 };
  }

  // 4. chatFilterEvents
  if (organizationId) {
    const eventsPage = await ctx.db
      .query('chatFilterEvents')
      .withIndex('by_org_threadId_createdAt', (q) =>
        q.eq('organizationId', organizationId).eq('threadId', threadId),
      )
      .take(PAGE_SIZE);
    for (const row of eventsPage) {
      await ctx.db.delete(row._id);
    }
    if (eventsPage.length === PAGE_SIZE) {
      return { done: false, remaining: 1 };
    }
  }

  // 5. chat-upload fileMetadata bound to this thread.
  //
  // Files uploaded via the chat composer carry `fileMetadata.threadId` set
  // to the chat thread (no `documents` row — chat uploads index by
  // storageId only, see file_metadata/internal_actions.ts:uploadFileToRag).
  // Cascading them here closes the chat-upload "ghost file" residue that
  // would otherwise outlive the deleted thread on disk.
  //
  // Deletes the underlying _storage blob first, then the fileMetadata
  // row. Round-2 review CRITICAL #17: also schedule a RAG-side purge for
  // every storage id we deleted — without this the chat upload's vector
  // chunks survive thread deletion forever (the GDPR `eraseSubjectFileMetadata`
  // path can't reach them either, because the fileMetadata row is gone
  // by the time it runs after this cascade).
  // Chat-uploaded fileMetadata is org-scoped (needs the
  // `by_organizationId_and_threadId` compound index), so this branch
  // requires `organizationId`. If it's missing on a legacy thread row,
  // we still proceed past it to clean up the org-independent tables
  // below (videoLinkJobs) rather than silently skipping every
  // child cascade.
  const filesPageStorageIds: string[] = [];
  if (organizationId) {
    const filesPage = await ctx.db
      .query('fileMetadata')
      .withIndex('by_organizationId_and_threadId', (q) =>
        q.eq('organizationId', organizationId).eq('threadId', threadId),
      )
      .take(PAGE_SIZE);
    // Empty-page fast path: no files to cascade for this thread, skip
    // the (relatively expensive) Better Auth slug lookup. Common case
    // for chat-upload-less threads.
    if (filesPage.length > 0) {
      // Resolve slug BEFORE the delete loop. Previously the lookup ran
      // after every storage.delete + db.delete had committed; if it
      // threw, the DB tx rolls back so fileMetadata rows reappear but
      // `ctx.storage.delete` is out-of-band and NOT rolled back.
      // Resolving first means a slug-lookup failure aborts the loop
      // before any destructive op runs.
      //
      // We use `orgSlugFromIdOrNull` so a TERMINAL miss (org row gone,
      // missing slug — both unrecoverable) drops only the RAG-side
      // purge; the local fileMetadata rows + `_storage` blobs are
      // still cleaned and the cascade reports `done`. Previously a
      // throw here returned `{done:false, remaining:1}` forever, the
      // retention sweep's MAX_ATTEMPTS budget would exhaust, and the
      // orphan rows + blobs accumulated indefinitely.
      const orgSlug = await orgSlugFromIdOrNull(ctx, organizationId);
      if (orgSlug === null) {
        console.warn(
          `[cascadeDeleteThreadChildren] org ${organizationId} unresolvable (deleted/missing slug); cleaning local fileMetadata + storage but skipping RAG purge`,
        );
      }
      const ragPurgeStorageIds: string[] = [];
      const s3FileRefs: string[] = [];
      for (const fileMeta of filesPage) {
        // Backend-aware: `fileMetadata.storageId` is a blob REFERENCE — a
        // chat upload in a BYO-bucket org is an `s3:` ref a mutation cannot
        // sign for, so those batch onto the scheduled node delete lane.
        await deleteBlobInMutation(
          ctx,
          fileMeta.storageId,
          s3FileRefs,
          'cascadeDeleteThreadChildren',
        );
        ragPurgeStorageIds.push(String(fileMeta.storageId));
        filesPageStorageIds.push(String(fileMeta.storageId));
        await ctx.db.delete(fileMeta._id);
      }
      await scheduleS3BlobDeletes(ctx, organizationId, s3FileRefs);
      if (orgSlug !== null && ragPurgeStorageIds.length > 0) {
        // Repointed from the retired workflow_engine RAG
        // helper to the legacy corpus-purge action; the knowledge rebuild replaces
        // both. Reference built by hand — `convex/legacy/*` isn't in the
        // stale generated `internal` object (see knowledge_delete.ts header).
        await ctx.scheduler.runAfter(0, deleteKnowledgeDocumentsBatch, {
          orgSlug,
          fileIds: ragPurgeStorageIds,
        });
      }
      if (filesPage.length === PAGE_SIZE) {
        return { done: false, remaining: 1 };
      }
    }
  }

  // 6. video-link jobs bound to this thread. videoLinkJobs is a sidecar
  // to fileMetadata — the orchestrator action stores the transcript on
  // fileMetadata (deleted in 5 above when org is known) and stores the
  // job's pipeline state here. Lifted OUT of the `if (organizationId)`
  // guard above: the `by_threadId` index is org-independent, and legacy
  // thread rows without an organizationId would otherwise leak both
  // `videoLinkJobs` rows AND their `_storage` blobs forever (round-2 V11
  // claim D / cascade_helpers cluster).
  const videoLinksPage = await ctx.db
    .query('videoLinkJobs')
    .withIndex('by_threadId', (q) => q.eq('threadId', threadId))
    .take(PAGE_SIZE);
  const s3VideoRefs = new Map<string, string[]>();
  for (const job of videoLinksPage) {
    if (
      job.storageId &&
      // Skip when the blob was attached to a fileMetadata row we just
      // deleted in 5 — Convex `_storage` is reference-counted and
      // double-delete is a no-op, but logging the skip keeps the
      // diagnostic trail clean.
      !filesPageStorageIds.includes(String(job.storageId))
    ) {
      const refs = s3VideoRefs.get(job.organizationId) ?? [];
      await deleteBlobInMutation(
        ctx,
        job.storageId,
        refs,
        'cascadeDeleteThreadChildren.videoLink',
      );
      if (refs.length > 0) s3VideoRefs.set(job.organizationId, refs);
    }
    await ctx.db.delete(job._id);
  }
  for (const [orgId, refs] of s3VideoRefs) {
    await scheduleS3BlobDeletes(ctx, orgId, refs);
  }
  if (videoLinksPage.length === PAGE_SIZE) {
    return { done: false, remaining: 1 };
  }

  // 7. sub-threads — schedule cascade for each. Sub-threads are themselves
  // threadMetadata rows; the cleanupOrphanedSubThreads internal mutation
  // handles them via its own scheduling logic. We trigger here (best-effort)
  // before deleting the parent so its summary is still parseable.
  const thread = await ctx.runQuery(components.agent.threads.getThread, {
    threadId,
  });
  const subThreadIds = parseSubThreadIds(thread?.summary ?? undefined);

  // 8. agent-component messages + thread — bulk delete via the component
  // API (paged internally, async). The component handles message + stream
  // + thread cleanup transactionally. After this call the agent-side state
  // is effectively gone.
  await ctx.runMutation(components.agent.threads.deleteAllForThreadIdAsync, {
    threadId,
  });

  // 9. Recurse for sub-threads. Round-2 review CRITICAL #16: previously
  // the recursive return value was discarded and the parent metadata row
  // was deleted unconditionally. When a sub-thread itself had > PAGE_SIZE
  // child rows (recursive call returns `done: false`), the parent's
  // summary — the only place sub-thread IDs are recorded — was deleted
  // with the parent's metadata row, leaving the sub-thread's children
  // permanently orphaned. Now: if any sub-cascade is incomplete, return
  // `done: false` BEFORE deleting the parent so the dispatcher re-invokes
  // and can pick up where it left off via the still-present summary.
  let allSubThreadsDone = true;
  for (const subId of subThreadIds) {
    const subResult = await cascadeDeleteThreadChildren(ctx, {
      threadId: subId,
      organizationId,
      holds: args.holds,
      visited,
      depth: depth + 1,
    });
    if (!subResult.done) {
      allSubThreadsDone = false;
    }
  }
  if (!allSubThreadsDone) {
    return { done: false, remaining: 1 };
  }

  // 10. threadMetadata row itself — last step, only fires when every child
  // step above reported done.
  const metaRow = await ctx.db
    .query('threadMetadata')
    .withIndex('by_threadId', (q) => q.eq('threadId', threadId))
    .first();
  if (metaRow) {
    await ctx.db.delete(metaRow._id);
  }

  return { done: true, remaining: 0 };
}
