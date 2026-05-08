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
import { createAuditLog } from '../audit_logs/helpers';
import { authComponent } from '../auth';
import { loadActiveHolds } from '../governance/legal_hold';
import { isAdmin } from '../lib/rls/helpers/role_helpers';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';

// Audit actions emitted by this file. Keep grep-able:
//   chat_thread.restored_by_user
//   chat_thread.restored_by_admin
//   chat_thread.retention_override_restore

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
      } catch (err) {
        // getOrganizationMember throws on non-membership and on storage
        // errors. Either way the caller is not an admin of this org.
        // Log the unexpected variant so a backend outage isn't silently
        // collapsed into "not an admin".
        console.warn(
          '[restoreChatThread] org-admin lookup failed; treating as non-admin',
          err,
        );
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
    // 'trashed' (current code path) and legacy 'deleted' rows share the
    // same owner-or-admin gate. Without the explicit 'deleted' branch
    // any signed-in user could resurrect a legacy hard-delete record.
    if (
      (status === 'trashed' || status === 'deleted') &&
      !isOwner &&
      !orgAdmin
    ) {
      throw new ConvexError({
        code: 'forbidden',
        message: 'You do not have permission to restore this thread.',
      });
    }

    // Legal-hold gate. Restore would re-open a held thread for edits,
    // defeating the preservation contract. Refuse — owner / admin must
    // wait for the hold to be released through the dual-control flow.
    if (metadata.organizationId !== undefined) {
      const holds = await loadActiveHolds(ctx, metadata.organizationId);
      const ownerHeld =
        metadata.userId !== undefined &&
        holds.userMembershipIds.has(metadata.userId);
      if (
        holds.orgHeld ||
        holds.threadIds.has(metadata.threadId) ||
        ownerHeld
      ) {
        throw new ConvexError({
          code: 'LEGAL_HOLD_BLOCKS_RESTORE',
          message: holds.orgHeld
            ? 'Org is under an active legal hold — restore is blocked until the hold is released.'
            : ownerHeld
              ? 'Thread owner is on a custodian legal hold — restore is blocked until the hold is released.'
              : 'Thread is under an active legal hold — restore is blocked until the hold is released.',
          threadId: metadata.threadId,
          orgHeld: holds.orgHeld,
          userCustodianHeld: ownerHeld,
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

    const action =
      status === 'expired'
        ? 'chat_thread.retention_override_restore'
        : isOwner
          ? 'chat_thread.restored_by_user'
          : 'chat_thread.restored_by_admin';
    if (metadata.organizationId) {
      await createAuditLog(ctx, {
        organizationId: metadata.organizationId,
        actorId: userId,
        actorEmail: authUser.email ?? undefined,
        actorType: 'user',
        action,
        category: 'data',
        resourceType: 'thread',
        resourceId: args.threadId,
        resourceName: metadata.title ?? args.threadId,
        status: 'success',
        previousState: { status },
        newState: { status: 'active' },
      });
    }

    return null;
  },
});
