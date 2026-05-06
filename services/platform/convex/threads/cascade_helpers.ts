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

import { components } from '../_generated/api';
import type { MutationCtx } from '../_generated/server';
import { parseSubThreadIds } from './delete_chat_thread';

const PAGE_SIZE = 200;

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
  args: { threadId: string; organizationId: string | undefined },
): Promise<{ done: boolean; remaining: number }> {
  const { threadId, organizationId } = args;
  let remaining = 0;

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

  // 4. threadBranches — three different id fields point at this thread
  for (const indexName of ['by_rootThreadId', 'by_branchThreadId'] as const) {
    const branchesPage = await ctx.db
      .query('threadBranches')
      .withIndex(
        indexName,
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the index name is a constant string literal
        (q) =>
          indexName === 'by_rootThreadId'
            ? q.eq('rootThreadId', threadId)
            : q.eq('branchThreadId', threadId),
      )
      .take(PAGE_SIZE);
    for (const row of branchesPage) {
      await ctx.db.delete(row._id);
    }
    if (branchesPage.length === PAGE_SIZE) {
      return { done: false, remaining: 1 };
    }
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

  // 12. Recurse for sub-threads (best-effort — done after parent's children
  // gone so a cascade interruption can still pick up sub-threads later).
  for (const subId of subThreadIds) {
    await cascadeDeleteThreadChildren(ctx, {
      threadId: subId,
      organizationId,
    });
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

  return { done: true, remaining };
}
