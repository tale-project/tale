/**
 * Restore a trashed/expired thread back to `'active'`.
 *
 * Permission split by origin (status):
 *   - `'trashed'`  — owner OR org admin can restore. Audit subtype:
 *                    `chat_thread.restored_by_user|admin`.
 *   - `'expired'`  — admin only. The admin is undoing a compliance policy
 *                    decision; UI requires a "type 'restore' to confirm"
 *                    dialog. Audit subtype: `chat_thread.retention_override_restore`.
 *   - other states — refuses (`THREAD_NOT_RESTORABLE`).
 *
 * Refuses if:
 *   - the thread's children have been cascade-deleted (Pass B already ran);
 *     in that case there's nothing to restore.
 *   - the thread is under an active legalHold — restore would defeat the
 *     freeze (the user could resume editing/deleting messages on a hold
 *     target). Throws `LEGAL_HOLD_BLOCKS_RESTORE`.
 *
 * The agent-component thread is NOT touched here (it stays in whatever
 * state the user-delete or retention path left it). If a future restore
 * needs to bring back agent-component messages, that's a follow-up — the
 * cascade helper today only fires from Pass B, which deletes them; for
 * `'trashed'` rows that haven't yet hit Pass B, the agent-component
 * thread is merely archived, which restoreChatThread reverses.
 */

import { ConvexError, v } from 'convex/values';

import { components } from '../_generated/api';
import { mutation } from '../_generated/server';
import { authComponent } from '../auth';
import { loadActiveHolds } from '../governance/legal_hold';
import { isAdmin } from '../lib/rls/helpers/role_helpers';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';

export const restoreChatThread = mutation({
  args: {
    threadId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new ConvexError({
        code: 'unauthenticated',
        message: 'Sign in required to restore threads.',
      });
    }
    const userId = String(authUser._id);

    const metadata = await ctx.db
      .query('threadMetadata')
      .withIndex('by_threadId', (q) => q.eq('threadId', args.threadId))
      .first();

    if (!metadata) {
      throw new ConvexError({
        code: 'not_found',
        message: 'Thread does not exist.',
      });
    }

    const status = metadata.status;
    if (status !== 'trashed' && status !== 'expired' && status !== 'deleted') {
      throw new ConvexError({
        code: 'THREAD_NOT_RESTORABLE',
        message: `Thread is in '${status}' state — only trashed or expired threads can be restored.`,
      });
    }

    // Permission gate by origin
    const isOwner = metadata.userId === userId;
    let orgAdmin = false;
    if (metadata.organizationId !== undefined) {
      try {
        const member = await getOrganizationMember(
          ctx,
          metadata.organizationId,
          { userId, email: authUser.email ?? '' },
        );
        orgAdmin = isAdmin(member.role);
      } catch {
        orgAdmin = false;
      }
    }

    if (status === 'expired' && !orgAdmin) {
      throw new ConvexError({
        code: 'RESTORE_REQUIRES_ADMIN',
        message:
          'Retention-expired threads can only be restored by an organization admin.',
      });
    }
    if (status === 'trashed' && !isOwner && !orgAdmin) {
      throw new ConvexError({
        code: 'forbidden',
        message: 'You do not have permission to restore this thread.',
      });
    }
    // Legacy `'deleted'` rows: same gate as `'trashed'`.

    // Legal-hold gate. Restore would re-open a held thread for edits,
    // defeating the preservation contract. Refuse — owner / admin must
    // wait for the hold to be released through the dual-control flow.
    if (metadata.organizationId !== undefined) {
      const holds = await loadActiveHolds(ctx, metadata.organizationId);
      if (holds.orgHeld || holds.threadIds.has(metadata.threadId)) {
        throw new ConvexError({
          code: 'LEGAL_HOLD_BLOCKS_RESTORE',
          message: holds.orgHeld
            ? 'Org is under an active legal hold — restore is blocked until the hold is released.'
            : 'Thread is under an active legal hold — restore is blocked until the hold is released.',
          threadId: metadata.threadId,
          orgHeld: holds.orgHeld,
        });
      }
    }

    // Restore: clear status + statusChangedAt; un-archive the agent thread.
    await ctx.db.patch(metadata._id, {
      status: 'active',
      statusChangedAt: Date.now(),
    });

    await ctx.runMutation(components.agent.threads.updateThread, {
      threadId: args.threadId,
      patch: { status: 'active' },
    });

    // Audit log writer is added in Bundle 1 follow-up; for now, console
    // trail keeps the operation traceable in deploy logs.
    const subtype =
      status === 'expired'
        ? 'chat_thread.retention_override_restore'
        : isOwner
          ? 'chat_thread.restored_by_user'
          : 'chat_thread.restored_by_admin';
    console.info(
      `[restoreChatThread] ${subtype} thread=${args.threadId} by=${userId} previousStatus=${status}`,
    );

    return null;
  },
});
