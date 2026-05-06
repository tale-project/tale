import { ConvexError } from 'convex/values';

import { parseJson } from '../../lib/utils/type-cast-helpers';
import { components, internal } from '../_generated/api';
import type { MutationCtx } from '../_generated/server';
import type { ThreadSummaryWithSubThreads } from '../agent_tools/sub_agents/helpers/types';
import { loadActiveHolds } from '../governance/legal_hold';

export async function deleteChatThread(
  ctx: MutationCtx,
  threadId: string,
): Promise<void> {
  const thread = await ctx.runQuery(components.agent.threads.getThread, {
    threadId,
  });

  if (!thread) {
    return;
  }

  // Fetch metadata up front so we can check legal hold before any
  // destructive action (archive on agent-component side, status flip,
  // webhook-mapping cascade). All callers are user-initiated or
  // internal-cascade; both must respect a hold — soft-delete of a held
  // thread breaks the eDiscovery contract even though Pass B preserves
  // physical data, because the user can no longer reach the thread to
  // produce its content on demand.
  const existing = await ctx.db
    .query('threadMetadata')
    .withIndex('by_threadId', (q) => q.eq('threadId', threadId))
    .first();

  if (existing && existing.organizationId !== undefined) {
    const holds = await loadActiveHolds(ctx, existing.organizationId);
    if (holds.orgHeld || holds.threadIds.has(threadId)) {
      throw new ConvexError({
        code: 'LEGAL_HOLD_BLOCKS_DELETE',
        message: holds.orgHeld
          ? 'Org is under an active legal hold — delete is blocked.'
          : 'Thread is under an active legal hold — delete is blocked.',
        threadId,
        orgHeld: holds.orgHeld,
      });
    }
  }

  await ctx.runMutation(components.agent.threads.updateThread, {
    threadId,
    patch: { status: 'archived' },
  });

  if (existing) {
    // User-initiated delete: enter the user-visible Trash. status='trashed'
    // distinguishes from retention-policy auto-deletion (status='expired'),
    // which is admin-only-visible. Both states are grace-windowed by
    // `statusChangedAt`; retention Pass B hard-deletes when grace elapses.
    await ctx.db.patch(existing._id, {
      status: 'trashed',
      statusChangedAt: Date.now(),
    });
  }

  // Cascade: drop any agent-webhook `user` → threadId mapping rows pointing
  // at this thread. Otherwise a deleted thread remains reachable via the
  // OpenAI-compat webhook path, and new POSTs would try to write into a
  // tombstoned thread.
  const webhookMappings = await ctx.db
    .query('agentWebhookUserThreads')
    .withIndex('by_threadId', (q) => q.eq('threadId', threadId))
    .collect();
  for (const row of webhookMappings) {
    await ctx.db.delete(row._id);
  }

  const subThreadIds = parseSubThreadIds(thread.summary);
  if (subThreadIds.length > 0) {
    await ctx.scheduler.runAfter(
      0,
      internal.threads.internal_mutations.cleanupOrphanedSubThreads,
      { parentThreadId: threadId, subThreadIds },
    );
  }
}

export function parseSubThreadIds(summary: string | undefined): string[] {
  if (!summary) return [];

  try {
    const parsed = parseJson<ThreadSummaryWithSubThreads>(summary);
    if (!parsed.subThreads) return [];
    return Object.values(parsed.subThreads).filter(
      (id): id is string => typeof id === 'string',
    );
  } catch {
    return [];
  }
}
