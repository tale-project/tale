import { ConvexError, v } from 'convex/values';

import { components } from '../_generated/api';
import { mutation } from '../_generated/server';
import { createAuditLog } from '../audit_logs/helpers';
import { authComponent } from '../auth';
import { getOrganizationMember } from '../lib/rls';
import { isAdmin } from '../lib/rls/helpers/role_helpers';
import { loadActiveHolds } from './legal_hold';
import {
  restoreRowToActive,
  SOFT_DELETE_RESOURCE_CONFIG,
} from './soft_delete_helpers';
import { softDeleteResourceTypeValidator } from './soft_delete_validators';

/**
 * Admin-only generic restore for retention-trashed rows. Powers the
 * `settings/governance/trash` UI.
 *
 * Permission: org admin only. Owner self-restore is a separate flow
 * (`restoreChatThread` for threads — surfaced in chat sidebar UI; not
 * built yet for other resource types).
 *
 * Legal-hold contract: org-wide hold blocks every resource type;
 * thread-id holds block thread restore; document-id holds block
 * document restore. Other categories aren't covered by `loadActiveHolds`
 * today — the org-wide hold gate is sufficient to keep them frozen
 * during a litigation hold.
 *
 * Audit: emits `<resource>.restored_by_admin` (regular trashed rows) or
 * `<resource>.retention_override_restore` (rows that were Pass-A
 * `'expired'`, the compliance-override path that the UI gates behind a
 * type-to-confirm dialog).
 */
export const restoreSoftDeletedRow = mutation({
  args: {
    organizationId: v.string(),
    resourceType: softDeleteResourceTypeValidator,
    rowId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new ConvexError({
        code: 'unauthenticated',
        message: 'Sign in required to restore.',
      });
    }
    const userId = String(authUser._id);

    const member = await getOrganizationMember(ctx, args.organizationId, {
      userId,
      email: authUser.email ?? '',
      name: authUser.name,
    });
    if (!isAdmin(member.role)) {
      throw new ConvexError({
        code: 'forbidden',
        message: 'Only organization admins can restore retention-trashed rows.',
      });
    }

    // Org-wide hold blocks every restore. Thread/document-specific holds
    // also blocked here so the helper layer below doesn't need to know.
    // User-membership cascade: if the row's author is on a custodian
    // hold, restore is blocked (mirrors `restoreChatThread` and the
    // public delete paths). This check requires reading the row's
    // author up-front; thread branch reads it from `threadMetadata.userId`,
    // generic branch reads it from `<row>.createdBy` / `<row>.userId` /
    // similar after `restoreRowToActive` reports the row exists.
    const holds = await loadActiveHolds(ctx, args.organizationId);
    if (holds.orgHeld) {
      throw new ConvexError({
        code: 'LEGAL_HOLD_BLOCKS_RESTORE',
        message: 'Organization is on legal hold — restore is blocked.',
        orgHeld: true,
      });
    }
    if (args.resourceType === 'thread' && holds.threadIds.has(args.rowId)) {
      throw new ConvexError({
        code: 'LEGAL_HOLD_BLOCKS_RESTORE',
        message: 'Thread is on legal hold — restore is blocked.',
      });
    }
    if (args.resourceType === 'document' && holds.documentIds.has(args.rowId)) {
      throw new ConvexError({
        code: 'LEGAL_HOLD_BLOCKS_RESTORE',
        message: 'Document is on legal hold — restore is blocked.',
      });
    }

    const config = SOFT_DELETE_RESOURCE_CONFIG[args.resourceType];

    // Threads keep their bespoke flip semantics (un-archive the agent
    // component thread). Replicate the minimal needed bits here rather
    // than calling the existing `restoreChatThread` mutation (mutations
    // can't call mutations).
    if (args.resourceType === 'thread') {
      const id = ctx.db.normalizeId('threadMetadata', args.rowId);
      if (!id) {
        throw new ConvexError({
          code: 'not_found',
          message: 'Thread does not exist.',
        });
      }
      const metadata = await ctx.db.get(id);
      if (!metadata) {
        throw new ConvexError({
          code: 'not_found',
          message: 'Thread does not exist.',
        });
      }
      // `not_found` (not `forbidden`) on cross-org so the mutation isn't
      // a foreign-id existence oracle.
      if (metadata.organizationId !== args.organizationId) {
        throw new ConvexError({
          code: 'not_found',
          message: 'Thread does not exist.',
        });
      }
      // User-membership cascade: thread author on custodian hold blocks
      // restore. Mirrors `restoreChatThread` and `assertNotHeld`.
      if (holds.userMembershipIds.has(metadata.userId)) {
        throw new ConvexError({
          code: 'LEGAL_HOLD_BLOCKS_RESTORE',
          message:
            'Thread author is on a custodian legal hold — restore is blocked.',
          userCustodianHeld: true,
        });
      }
      const status = metadata.status;
      if (
        status !== 'trashed' &&
        status !== 'expired' &&
        status !== 'deleted'
      ) {
        throw new ConvexError({
          code: 'NOT_RESTORABLE',
          message: `Thread is in '${status}' state — only trashed/expired threads can be restored.`,
        });
      }
      await ctx.db.patch(id, { status: 'active', statusChangedAt: Date.now() });
      await ctx.runMutation(components.agent.threads.updateThread, {
        threadId: metadata.threadId,
        patch: { status: 'active' },
      });
      await createAuditLog(ctx, {
        organizationId: args.organizationId,
        actorId: userId,
        actorEmail: authUser.email ?? undefined,
        actorType: 'user',
        action:
          status === 'expired'
            ? 'chat_thread.retention_override_restore'
            : 'chat_thread.restored_by_admin',
        category: 'data',
        resourceType: 'thread',
        resourceId: metadata.threadId,
        resourceName: metadata.title ?? metadata.threadId,
        status: 'success',
        previousState: { status },
        newState: { status: 'active' },
      });
      return null;
    }

    const result = await restoreRowToActive(
      ctx,
      args.resourceType,
      args.rowId,
      args.organizationId,
      holds.userMembershipIds,
    );
    if (!result.ok) {
      if (result.reason === 'user_custodian_hold') {
        throw new ConvexError({
          code: 'LEGAL_HOLD_BLOCKS_RESTORE',
          message:
            'Row author is on a custodian legal hold — restore is blocked.',
          userCustodianHeld: true,
        });
      }
      const code =
        result.reason === 'not_found'
          ? 'not_found'
          : result.reason === 'not_trashed'
            ? 'NOT_RESTORABLE'
            : 'NOT_RESTORABLE';
      throw new ConvexError({
        code,
        message: `Cannot restore: ${result.reason}.`,
      });
    }

    // Re-read for audit display name.
    const id = ctx.db.normalizeId(config.tableName, args.rowId);
    const row = id ? await ctx.db.get(id) : null;
    let displayName: string | undefined;
    if (row !== null && typeof row === 'object' && config.displayNameField) {
      const map = row as { [k: string]: unknown };
      const value = map[config.displayNameField];
      if (typeof value === 'string') displayName = value;
    }

    await createAuditLog(ctx, {
      organizationId: args.organizationId,
      actorId: userId,
      actorEmail: authUser.email ?? undefined,
      actorType: 'user',
      action:
        result.previousStatus === 'expired'
          ? `${config.auditPrefix}.retention_override_restore`
          : `${config.auditPrefix}.restored_by_admin`,
      category: 'data',
      resourceType: config.auditResourceType,
      resourceId: args.rowId,
      resourceName: displayName ?? args.rowId,
      status: 'success',
      previousState: { status: result.previousStatus },
      newState: { status: 'active' },
    });

    return null;
  },
});
