import { ConvexError } from 'convex/values';

import { parseJson } from '../../lib/utils/type-cast-helpers';
import { components, internal } from '../_generated/api';
import type { MutationCtx } from '../_generated/server';
import type { ThreadSummaryWithSubThreads } from '../agent_tools/sub_agents/helpers/types';
import { createAuditLog } from '../audit_logs/helpers';
import { loadActiveHolds } from '../governance/legal_hold';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { cascadeDeleteThreadChildren } from './cascade_helpers';

// Audit actions emitted by this file. Keep grep-able:
//   chat_thread.trashed         — user-initiated soft delete (mode='user-trash')
//   chat_thread.cascade_deleted — internal hard delete (mode='internal-cascade')

/**
 * Mode determines what "delete" means for this thread:
 *
 * - **`user-trash`** (default) — user-initiated soft delete. Flips
 *   status to `'trashed'`, preserves the row for the grace window so
 *   the user can restore from Trash.
 * - **`internal-cascade`** — non-user, ephemeral internal cleanup
 *   (e.g. arena Thread B after a winner is selected). Hard-deletes
 *   immediately via `cascadeDeleteThreadChildren`; never enters Trash
 *   because there is no user-facing surface that would expect a
 *   recoverable artifact for these rows.
 */
export type DeleteMode = 'user-trash' | 'internal-cascade';

export async function deleteChatThread(
  ctx: MutationCtx,
  threadId: string,
  mode: DeleteMode = 'user-trash',
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
    const ownerHeld =
      existing.userId !== undefined &&
      holds.userMembershipIds.has(existing.userId);
    if (holds.orgHeld || holds.threadIds.has(threadId) || ownerHeld) {
      throw new ConvexError({
        code: 'LEGAL_HOLD_BLOCKS_DELETE',
        message: holds.orgHeld
          ? 'Org is under an active legal hold — delete is blocked.'
          : ownerHeld
            ? 'Thread owner is on a custodian legal hold — delete is blocked.'
            : 'Thread is under an active legal hold — delete is blocked.',
        threadId,
        orgHeld: holds.orgHeld,
        userCustodianHeld: ownerHeld,
      });
    }
  }

  if (mode === 'internal-cascade') {
    // Hard-delete path for internal callers (e.g. arena Thread B
    // cleanup). Bypasses Trash entirely; ephemeral internal artifacts
    // would otherwise pollute the user's Trash with rows they never
    // saw and can't reason about.
    //
    // Capture org + title BEFORE cascade so the audit row can name the
    // resource even after the threadMetadata row is gone, then emit
    // AFTER cascade so a failure (paginated cascade not done in one
    // shot, transient throw) records `status: 'failure'` instead of a
    // misleading `success` (round-2 M8).
    const auditOrgId = existing?.organizationId;
    const auditTitle = existing?.title ?? threadId;
    let cascadeResult: Awaited<
      ReturnType<typeof cascadeDeleteThreadChildren>
    > | null = null;
    let cascadeError: string | undefined;
    try {
      cascadeResult = await cascadeDeleteThreadChildren(ctx, {
        threadId,
        organizationId: existing?.organizationId,
      });
    } catch (err) {
      cascadeError = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      if (auditOrgId) {
        await createAuditLog(ctx, {
          organizationId: auditOrgId,
          actorId: 'system',
          actorType: 'system',
          action: 'chat_thread.cascade_deleted',
          category: 'data',
          resourceType: 'thread',
          resourceId: threadId,
          resourceName: auditTitle,
          status:
            cascadeError !== undefined
              ? 'failure'
              : cascadeResult && !cascadeResult.done
                ? 'failure'
                : 'success',
          errorMessage:
            cascadeError ??
            (cascadeResult && !cascadeResult.done
              ? 'cascade not complete in single pass'
              : undefined),
        });
      }
    }
    // cascade_helpers handles the threadMetadata + agent-component
    // thread + webhook-mapping cleanup transactionally; nothing more
    // for this caller to do.
    return;
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
    // Idempotent on `statusChangedAt`: don't reset the grace clock if
    // the thread is already trashed/expired (defeats a grace-extension
    // attack where a user re-trashes to keep the row alive forever).
    if (existing.status !== 'trashed' && existing.status !== 'expired') {
      const trashedAt = Date.now();
      await ctx.db.patch(existing._id, {
        status: 'trashed',
        statusChangedAt: trashedAt,
      });
      if (existing.organizationId) {
        const identity = await getAuthUserIdentity(ctx);
        await createAuditLog(ctx, {
          organizationId: existing.organizationId,
          actorId: identity?.userId ?? 'system',
          actorEmail: identity?.email,
          actorType: identity ? 'user' : 'system',
          action: 'chat_thread.trashed',
          category: 'data',
          resourceType: 'thread',
          resourceId: threadId,
          resourceName: existing.title ?? threadId,
          status: 'success',
        });

        // Cascade soft-delete to chat-uploaded fileMetadata rows. The
        // user mental model: "trashing the conversation also trashes
        // the files attached in it". Pass B (`cascadeDeleteThreadChildren`)
        // physically removes them once grace expires. Restore-thread
        // walks the same index to flip these back to 'active'.
        //
        // Skip rows already in a terminal-ish state ('trashed' /
        // 'expired' / 'deleted') so we don't reset their grace clocks
        // (mirrors the grace-extension defense applied to threads above).
        const orgId = existing.organizationId;
        for await (const fileMeta of ctx.db
          .query('fileMetadata')
          .withIndex('by_organizationId_and_threadId', (q) =>
            q.eq('organizationId', orgId).eq('threadId', threadId),
          )) {
          const status = fileMeta.lifecycleStatus;
          if (
            status === 'trashed' ||
            status === 'expired' ||
            status === 'deleted'
          ) {
            continue;
          }
          await ctx.db.patch(fileMeta._id, {
            lifecycleStatus: 'trashed',
            statusChangedAt: trashedAt,
          });
        }
      }
    }
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
