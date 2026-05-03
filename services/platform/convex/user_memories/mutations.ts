import { ConvexError, v } from 'convex/values';

import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { mutation, type MutationCtx } from '../_generated/server';
import { estimateTokens } from '../lib/context_management/estimate_tokens';
import { assertSelfAndOrgMember } from '../lib/rls/auth/assert_self_and_org_member';
import { requireAuthenticatedUser } from '../lib/rls/auth/require_authenticated_user';
import { evaluatePersonalizationGates } from '../personalization/internal_queries';
import { ILLEGAL_CONTENT_RE, MEMORY_CONTENT_MAX_TOKENS } from './constants';
import { maybeRunCleanup } from './lazy_cleanup';

function validateContent(content: string): void {
  if (!content || content.length === 0) {
    throw new ConvexError({ code: 'invalid', message: 'Content is empty' });
  }
  if (ILLEGAL_CONTENT_RE.test(content)) {
    throw new ConvexError({
      code: 'invalid',
      message:
        'Content contains disallowed characters (newlines, angle brackets, ' +
        'backticks, or control characters)',
    });
  }
  const tokens = estimateTokens(content);
  if (tokens > MEMORY_CONTENT_MAX_TOKENS) {
    throw new ConvexError({
      code: 'too_long',
      message: `Memory content exceeds ${MEMORY_CONTENT_MAX_TOKENS} token budget (got ~${tokens}).`,
    });
  }
}

type AuditPayload = {
  organizationId: string;
  actorUserId: string;
  subjectUserId: string;
  action: 'propose' | 'create' | 'approve' | 'dismiss' | 'delete';
  outcome: 'ok' | 'denied' | 'error';
  memoryId?: Id<'userMemories'>;
};

async function audit(ctx: MutationCtx, payload: AuditPayload): Promise<void> {
  await ctx.runMutation(
    internal.user_memory_audit_log.internal_mutations.appendAudit,
    payload,
  );
}

/**
 * Manually add a new memory directly in the approved state — settings UI
 * "Add memory" button.
 */
export const addMemory = mutation({
  args: {
    organizationId: v.string(),
    content: v.string(),
  },
  handler: async (ctx, args): Promise<Id<'userMemories'>> => {
    const authUser = await requireAuthenticatedUser(ctx);
    await assertSelfAndOrgMember(
      ctx,
      authUser,
      authUser.userId,
      args.organizationId,
    );
    const allowed = await evaluatePersonalizationGates(ctx, {
      userId: authUser.userId,
      organizationId: args.organizationId,
    });
    if (!allowed) {
      await audit(ctx, {
        organizationId: args.organizationId,
        actorUserId: authUser.userId,
        subjectUserId: authUser.userId,
        action: 'create',
        outcome: 'denied',
      });
      throw new ConvexError({
        code: 'forbidden',
        message: 'Personalization is disabled for this user or organization.',
      });
    }
    await maybeRunCleanup(ctx, authUser.userId, args.organizationId);
    validateContent(args.content);

    const id = await ctx.db.insert('userMemories', {
      userId: authUser.userId,
      organizationId: args.organizationId,
      content: args.content,
      source: 'manual',
      status: 'approved',
      createdAt: Date.now(),
    });
    await audit(ctx, {
      organizationId: args.organizationId,
      actorUserId: authUser.userId,
      subjectUserId: authUser.userId,
      action: 'create',
      outcome: 'ok',
      memoryId: id,
    });
    return id;
  },
});

/**
 * User accepts a propose_memory proposal (Save or Edit&Save in the chat
 * inline card or settings/Pending tab). Optionally edits content.
 */
export const approvePendingMemory = mutation({
  args: {
    memoryId: v.id('userMemories'),
    content: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    const authUser = await requireAuthenticatedUser(ctx);
    const row = await ctx.db.get(args.memoryId);
    if (!row || row.userId !== authUser.userId) {
      throw new ConvexError({
        code: 'forbidden',
        message: 'Memory not found',
      });
    }
    await assertSelfAndOrgMember(
      ctx,
      authUser,
      authUser.userId,
      row.organizationId,
    );
    const now = Date.now();
    if (
      row.status !== 'pending' ||
      typeof row.deletedAt === 'number' ||
      (typeof row.pendingExpiresAt === 'number' && row.pendingExpiresAt < now)
    ) {
      throw new ConvexError({
        code: 'invalid',
        message: 'Memory is not approvable (not pending, deleted, or expired)',
      });
    }
    await maybeRunCleanup(ctx, authUser.userId, row.organizationId);

    let nextContent = row.content;
    if (args.content !== undefined) {
      const trimmed = args.content.trim();
      validateContent(trimmed);
      nextContent = trimmed;
    }

    await ctx.db.patch(args.memoryId, {
      status: 'approved',
      content: nextContent,
      pendingExpiresAt: undefined,
    });
    await audit(ctx, {
      organizationId: row.organizationId,
      actorUserId: authUser.userId,
      subjectUserId: authUser.userId,
      action: 'approve',
      outcome: 'ok',
      memoryId: args.memoryId,
    });
  },
});

/**
 * User dismisses a pending proposal — the row is hard-deleted (the
 * proposal was never approved, so no soft-delete trail is kept). The
 * audit-log row remains with `action='dismiss'` and no content.
 */
export const dismissPendingMemory = mutation({
  args: {
    memoryId: v.id('userMemories'),
  },
  handler: async (ctx, args): Promise<void> => {
    const authUser = await requireAuthenticatedUser(ctx);
    const row = await ctx.db.get(args.memoryId);
    if (!row || row.userId !== authUser.userId) {
      throw new ConvexError({
        code: 'forbidden',
        message: 'Memory not found',
      });
    }
    await assertSelfAndOrgMember(
      ctx,
      authUser,
      authUser.userId,
      row.organizationId,
    );
    if (row.status !== 'pending') {
      throw new ConvexError({
        code: 'invalid',
        message: 'Memory is not pending',
      });
    }
    await maybeRunCleanup(ctx, authUser.userId, row.organizationId);
    await audit(ctx, {
      organizationId: row.organizationId,
      actorUserId: authUser.userId,
      subjectUserId: authUser.userId,
      action: 'dismiss',
      outcome: 'ok',
      memoryId: args.memoryId,
    });
    await ctx.db.delete(args.memoryId);
  },
});

export const softDeleteMemory = mutation({
  args: { memoryId: v.id('userMemories') },
  handler: async (ctx, args): Promise<void> => {
    const authUser = await requireAuthenticatedUser(ctx);
    const row = await ctx.db.get(args.memoryId);
    if (!row || row.userId !== authUser.userId) {
      throw new ConvexError({
        code: 'forbidden',
        message: 'Memory not found',
      });
    }
    await assertSelfAndOrgMember(
      ctx,
      authUser,
      authUser.userId,
      row.organizationId,
    );
    if (typeof row.deletedAt === 'number') return;
    await maybeRunCleanup(ctx, authUser.userId, row.organizationId);
    await ctx.db.patch(args.memoryId, { deletedAt: Date.now() });
    await audit(ctx, {
      organizationId: row.organizationId,
      actorUserId: authUser.userId,
      subjectUserId: authUser.userId,
      action: 'delete',
      outcome: 'ok',
      memoryId: args.memoryId,
    });
  },
});
