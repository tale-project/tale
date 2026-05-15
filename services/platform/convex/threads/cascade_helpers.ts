/**
 * Shared cascade-deletion logic used by:
 *   - retention Pass B (`internal_mutations_retention.deleteExpiredThread`)
 *   - any future explicit "permanently delete" path
 *
 * The user-initiated `deleteChatThread` path does NOT call cascade — it
 * only flips status to `'trashed'`. Pass B (after grace expiry) calls this
 * helper to physically remove the thread + all its descendant rows.
 *
 * Order (children-first, parent-last) — verified in the v2 plan against
 * round-2 schema audit:
 *   1. agent-component messages (`components.agent.messages.deleteByIds`,
 *      paged)
 *   2. messageMetadata (by_threadId)
 *   3. threadTodos (by_thread)
 *   4. approvals (by_threadId, scoped to rows where threadId === args.threadId)
 *   5. threadBranches (by_rootThreadId ∪ by_branchThreadId ∪
 *      by_parentThreadId_forkAfterMessageId)
 *   6. messageFeedback (by_threadId)
 *   7. chatFilterEvents (by_org_threadId_createdAt)
 *   8. artifacts + artifactRevisions (two-step lookup via by_artifact)
 *   9. agentWebhookUserThreads (by_threadId)
 *  10. sub-threads — recurse via parsed parent summary
 *  11. agent-component thread (`components.agent.threads.deleteAllForThreadIdAsync`)
 *  12. threadMetadata row (db.delete)
 *
 * `messageMetadata.organizationId` is not yet a field (Phase 10 backfill);
 * we look it up via `threadId` which is sufficient for cascade.
 */

import { components, internal } from '../_generated/api';
import type { MutationCtx } from '../_generated/server';
import { createAuditLog } from '../audit_logs/helpers';
import type { ActiveHolds } from '../governance/legal_hold';
import { loadActiveHolds } from '../governance/legal_hold';
import { parseSubThreadIds } from './delete_chat_thread';

// Audit actions emitted by this file. Keep grep-able:
//   chat_thread.cascade_skipped_hold

const PAGE_SIZE = 200;

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
 *
 * NOTE on `messageMetadata`: that table's `_id` is the messageId; one
 * row per message. A thread with N messages produces N metadata rows.
 * For very-large threads (1000s of messages), the page-200 cap on this
 * step requires multiple calls — a future Phase-7 dispatcher will manage
 * this via cursor resume.
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

  // 1. messageMetadata — paged
  const metadataPage = await ctx.db
    .query('messageMetadata')
    .withIndex('by_threadId', (q) => q.eq('threadId', threadId))
    .take(PAGE_SIZE);
  for (const row of metadataPage) {
    await ctx.db.delete(row._id);
  }
  if (metadataPage.length === PAGE_SIZE) {
    return { done: false, remaining: 1 };
  }

  // 2. threadTodos
  if (organizationId) {
    const todosPage = await ctx.db
      .query('threadTodos')
      .withIndex('by_org_thread', (q) =>
        q.eq('organizationId', organizationId).eq('threadId', threadId),
      )
      .take(PAGE_SIZE);
    for (const row of todosPage) {
      await ctx.db.delete(row._id);
    }
    if (todosPage.length === PAGE_SIZE) {
      return { done: false, remaining: 1 };
    }
  }

  // 3. approvals (only rows tied to this thread)
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

  // 4. threadBranches — three different id fields point at this thread.
  //    Iterate by_rootThreadId, by_branchThreadId, AND
  //    by_parentThreadId_forkAfterMessageId so a thread that is the
  //    parent of a branch (but not the root or the branch itself) is
  //    not orphaned. Without the parentThreadId pass, cascading thread
  //    A leaves a `threadBranches` row pointing parentThreadId=A in
  //    place even though A is gone.
  const rootBranchesPage = await ctx.db
    .query('threadBranches')
    .withIndex('by_rootThreadId', (q) => q.eq('rootThreadId', threadId))
    .take(PAGE_SIZE);
  for (const row of rootBranchesPage) {
    await ctx.db.delete(row._id);
  }
  if (rootBranchesPage.length === PAGE_SIZE) {
    return { done: false, remaining: 1 };
  }

  const branchBranchesPage = await ctx.db
    .query('threadBranches')
    .withIndex('by_branchThreadId', (q) => q.eq('branchThreadId', threadId))
    .take(PAGE_SIZE);
  for (const row of branchBranchesPage) {
    await ctx.db.delete(row._id);
  }
  if (branchBranchesPage.length === PAGE_SIZE) {
    return { done: false, remaining: 1 };
  }

  const parentBranchesPage = await ctx.db
    .query('threadBranches')
    .withIndex('by_parentThreadId_forkAfterMessageId', (q) =>
      q.eq('parentThreadId', threadId),
    )
    .take(PAGE_SIZE);
  for (const row of parentBranchesPage) {
    await ctx.db.delete(row._id);
  }
  if (parentBranchesPage.length === PAGE_SIZE) {
    return { done: false, remaining: 1 };
  }

  // 5. messageFeedback
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

  // 6. chatFilterEvents
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

  // 7. artifacts (+ revisions, two-step lookup via artifactId)
  if (organizationId) {
    const artifactsPage = await ctx.db
      .query('artifacts')
      .withIndex('by_organizationId_and_thread', (q) =>
        q.eq('organizationId', organizationId).eq('threadId', threadId),
      )
      .take(PAGE_SIZE);
    for (const artifact of artifactsPage) {
      const revisions = await ctx.db
        .query('artifactRevisions')
        .withIndex('by_artifact', (q) => q.eq('artifactId', artifact._id))
        .take(PAGE_SIZE);
      for (const rev of revisions) {
        await ctx.db.delete(rev._id);
      }
      // If a single artifact has > PAGE_SIZE revisions, surface that as
      // remaining so the caller re-invokes us; we'll resume from this
      // artifact next round (its revisions still exist; the artifact row
      // itself isn't deleted yet on this iteration).
      if (revisions.length === PAGE_SIZE) {
        return { done: false, remaining: 1 };
      }
      await ctx.db.delete(artifact._id);
    }
    if (artifactsPage.length === PAGE_SIZE) {
      return { done: false, remaining: 1 };
    }
  }

  // 7.5 chat-upload fileMetadata bound to this thread.
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
  if (organizationId) {
    const filesPage = await ctx.db
      .query('fileMetadata')
      .withIndex('by_organizationId_and_threadId', (q) =>
        q.eq('organizationId', organizationId).eq('threadId', threadId),
      )
      .take(PAGE_SIZE);
    const ragPurgeStorageIds: string[] = [];
    for (const fileMeta of filesPage) {
      try {
        await ctx.storage.delete(fileMeta.storageId);
      } catch (error) {
        console.warn(
          `[cascadeDeleteThreadChildren] storage.delete failed for ${String(fileMeta.storageId)}:`,
          error,
        );
      }
      ragPurgeStorageIds.push(String(fileMeta.storageId));
      await ctx.db.delete(fileMeta._id);
    }
    if (ragPurgeStorageIds.length > 0) {
      await ctx.scheduler.runAfter(
        0,
        internal.workflow_engine.action_defs.rag.helpers.delete_document
          .deleteFromRagBatch,
        { fileIds: ragPurgeStorageIds },
      );
    }
    if (filesPage.length === PAGE_SIZE) {
      return { done: false, remaining: 1 };
    }
  }

  // 7c. ttsAudioChunks — voice-mode output is per-message but indexed
  // by thread for cascade. Both the `_storage` audio blob and the DB
  // row need cleanup; without this, voice content (PII verbatim of
  // assistant replies) survives thread deletion forever and the GDPR
  // erasure path can't reach the rows either (no per-user index).
  //
  // Paged via `by_thread_age`. The whole thread share the same threadId,
  // so a thread with > PAGE_SIZE chunks comes back through here on the
  // dispatcher's next sweep.
  const ttsPage = await ctx.db
    .query('ttsAudioChunks')
    .withIndex('by_thread_age', (q) => q.eq('threadId', threadId))
    .take(PAGE_SIZE);
  for (const chunk of ttsPage) {
    if (chunk.storageId) {
      try {
        await ctx.storage.delete(chunk.storageId);
      } catch (error) {
        console.warn(
          `[cascadeDeleteThreadChildren] tts storage.delete failed for ${String(chunk.storageId)}:`,
          error,
        );
      }
    }
    await ctx.db.delete(chunk._id);
  }
  if (ttsPage.length === PAGE_SIZE) {
    return { done: false, remaining: 1 };
  }

  // 8. agentWebhookUserThreads
  const webhookPage = await ctx.db
    .query('agentWebhookUserThreads')
    .withIndex('by_threadId', (q) => q.eq('threadId', threadId))
    .take(PAGE_SIZE);
  for (const row of webhookPage) {
    await ctx.db.delete(row._id);
  }
  if (webhookPage.length === PAGE_SIZE) {
    return { done: false, remaining: 1 };
  }

  // 9. sub-threads — schedule cascade for each. Sub-threads are themselves
  // threadMetadata rows; the cleanupOrphanedSubThreads internal mutation
  // handles them via its own scheduling logic. We trigger here (best-effort)
  // before deleting the parent so its summary is still parseable.
  const thread = await ctx.runQuery(components.agent.threads.getThread, {
    threadId,
  });
  const subThreadIds = parseSubThreadIds(thread?.summary ?? undefined);

  // 10. agent-component messages + thread — bulk delete via the component
  // API (paged internally, async). The component handles message + stream
  // + thread cleanup transactionally. After this call the agent-side state
  // is effectively gone.
  await ctx.runMutation(components.agent.threads.deleteAllForThreadIdAsync, {
    threadId,
  });

  // 12. Recurse for sub-threads. Round-2 review CRITICAL #16: previously
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

  // 13. threadMetadata row itself — last step, only fires when every child
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
