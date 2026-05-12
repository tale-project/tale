import { ConvexError, v } from 'convex/values';

import { internal } from '../_generated/api';
import type { MutationCtx } from '../_generated/server';
import { requireAuthenticatedUser } from '../lib/rls/auth/require_authenticated_user';
import { mutationWithRLS } from '../lib/rls/helpers/mutation_with_rls';
import { validateOrganizationAccess } from '../lib/rls/organization/validate_organization_access';
import type { RLSContext } from '../lib/rls/types';
import { assertPromptSizes } from './constants';
import { promptScopeValidator, promptTemplateValidator } from './validators';
import { buildNextVersionEntry } from './version_history';

/**
 * Audit emitter that bypasses RLS by routing through an internal mutation.
 * The `mutationWithRLS` wrapper denies non-admin `member` writes to the
 * `auditLogs` table by policy; an internal mutation uses raw ctx and writes
 * the row atomically within the parent mutation's transaction.
 */
async function emitPromptAudit(
  ctx: MutationCtx,
  rlsContext: RLSContext,
  action: string,
  resourceId: string,
  resourceName: string,
  newState?: Record<string, unknown>,
): Promise<void> {
  await ctx.runMutation(internal.audit_logs.internal_mutations.createAuditLog, {
    organizationId: rlsContext.organizationId,
    actorId: rlsContext.user.userId,
    actorEmail: rlsContext.user.email,
    actorRole: rlsContext.role,
    actorType: 'user',
    action,
    category: 'data',
    resourceType: 'prompt_template',
    resourceId,
    resourceName,
    newState,
    status: 'success',
  });
}

export const createPrompt = mutationWithRLS({
  args: {
    organizationId: v.string(),
    title: v.optional(v.string()),
    content: v.string(),
    description: v.optional(v.string()),
    scope: promptScopeValidator,
    teamId: v.optional(v.string()),
    category: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    sourceMessageId: v.optional(v.string()),
  },
  returns: promptTemplateValidator,
  handler: async (ctx, args) => {
    assertPromptSizes({
      content: args.content,
      title: args.title,
      description: args.description,
    });

    const user = await requireAuthenticatedUser(ctx);
    const rlsContext = await validateOrganizationAccess(
      ctx,
      args.organizationId,
      undefined,
      user,
    );

    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const randomId = Array.from(
      { length: 5 },
      () => chars[Math.floor(Math.random() * chars.length)],
    ).join('');
    const title = args.title?.trim() || `PROMPT-${randomId}`;
    const now = Date.now();

    const id = await ctx.db.insert('promptTemplates', {
      organizationId: args.organizationId,
      createdBy: user.userId,
      title,
      content: args.content,
      description: args.description,
      scope: args.scope,
      teamId: args.scope === 'team' ? args.teamId : undefined,
      category: args.category,
      tags: args.tags,
      usageCount: 0,
      sourceMessageId: args.sourceMessageId,
      version: 1,
      versionHistory: [
        {
          version: 1,
          content: args.content,
          publishedAt: now,
          publishedBy: user.userId,
        },
      ],
    });

    const prompt = await ctx.db.get(id);
    if (!prompt) {
      throw new ConvexError({
        code: 'not_found',
        message: 'Failed to create prompt template',
      });
    }

    await emitPromptAudit(
      ctx,
      rlsContext,
      'prompt_template.created',
      id,
      title,
      { scope: args.scope, version: 1 },
    );

    return prompt;
  },
});

/**
 * Updates prompt metadata and/or content. When `content` differs from the
 * currently saved content, a new version entry is prepended to versionHistory
 * (which always has the current version at index 0) and the version counter
 * increments. Each content change is an instant publish — no draft layer.
 */
export const updatePrompt = mutationWithRLS({
  args: {
    promptId: v.id('promptTemplates'),
    title: v.optional(v.string()),
    content: v.optional(v.string()),
    description: v.optional(v.string()),
    scope: v.optional(promptScopeValidator),
    teamId: v.optional(v.string()),
    category: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
  },
  returns: v.union(promptTemplateValidator, v.null()),
  handler: async (ctx, args) => {
    assertPromptSizes({
      content: args.content,
      title: args.title,
      description: args.description,
    });

    const user = await requireAuthenticatedUser(ctx);
    const existing = await ctx.db.get(args.promptId);
    if (!existing) return null;

    const rlsContext = await validateOrganizationAccess(
      ctx,
      existing.organizationId,
      undefined,
      user,
    );

    const isCreator = existing.createdBy === user.userId;
    if (!isCreator && !rlsContext.isAdmin) {
      throw new ConvexError({
        code: 'forbidden',
        message: 'Only the creator or an admin can edit this prompt',
      });
    }

    const updates: Record<string, unknown> = {};
    if (args.title !== undefined) updates.title = args.title;
    if (args.description !== undefined) updates.description = args.description;
    if (args.scope !== undefined) updates.scope = args.scope;
    if (args.teamId !== undefined) updates.teamId = args.teamId;
    if (args.category !== undefined) updates.category = args.category;
    if (args.tags !== undefined) updates.tags = args.tags;
    if (args.scope && args.scope !== 'team') {
      updates.teamId = undefined;
    }

    const nextContent = args.content;
    const contentChanged =
      nextContent !== undefined && nextContent !== existing.content;
    let newVersion: number | undefined;

    if (contentChanged && nextContent !== undefined) {
      const built = buildNextVersionEntry({
        existing,
        content: nextContent,
        publishedBy: user.userId,
      });
      newVersion = built.newVersion;
      updates.content = nextContent;
      updates.version = newVersion;
      updates.versionHistory = built.nextHistory;
    }

    if (Object.keys(updates).length > 0) {
      await ctx.db.patch(args.promptId, updates);
    }

    if (contentChanged && newVersion !== undefined) {
      await emitPromptAudit(
        ctx,
        rlsContext,
        'prompt_template.saved',
        args.promptId,
        existing.title,
        { version: newVersion, fromVersion: existing.version ?? 0 },
      );
    }

    return await ctx.db.get(args.promptId);
  },
});

export const deletePrompt = mutationWithRLS({
  args: {
    promptId: v.id('promptTemplates'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedUser(ctx);
    const existing = await ctx.db.get(args.promptId);
    if (!existing) return null;

    const rlsContext = await validateOrganizationAccess(
      ctx,
      existing.organizationId,
      undefined,
      user,
    );

    const isCreator = existing.createdBy === user.userId;
    if (!isCreator && !rlsContext.isAdmin) {
      throw new ConvexError({
        code: 'forbidden',
        message: 'Only the creator or an admin can delete this prompt',
      });
    }

    await emitPromptAudit(
      ctx,
      rlsContext,
      'prompt_template.deleted',
      args.promptId,
      existing.title,
      { scope: existing.scope, lastVersion: existing.version ?? 1 },
    );

    await ctx.db.delete(args.promptId);
    return null;
  },
});

export const incrementUsage = mutationWithRLS({
  args: {
    promptId: v.id('promptTemplates'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAuthenticatedUser(ctx);
    const existing = await ctx.db.get(args.promptId);
    if (!existing) return null;

    await ctx.db.patch(args.promptId, {
      usageCount: existing.usageCount + 1,
    });
    return null;
  },
});

/**
 * Restores a historical version by cloning its content into a new version.
 * Forward-only: the historical row stays in versionHistory; this prepends
 * v(current+1) with the target version's content.
 */
export const restoreFromVersion = mutationWithRLS({
  args: {
    promptId: v.id('promptTemplates'),
    targetVersion: v.number(),
  },
  returns: promptTemplateValidator,
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedUser(ctx);
    const existing = await ctx.db.get(args.promptId);
    if (!existing) {
      throw new ConvexError({
        code: 'not_found',
        message: 'Prompt not found',
      });
    }

    // Mirror getPrompt's personal-scope gate: an org admin who is not the
    // creator must not be able to mutate another user's personal prompt
    // history even though they pass the org-membership check.
    if (existing.scope === 'personal' && existing.createdBy !== user.userId) {
      throw new ConvexError({
        code: 'not_found',
        message: 'Prompt not found',
      });
    }

    const rlsContext = await validateOrganizationAccess(
      ctx,
      existing.organizationId,
      undefined,
      user,
    );

    const isCreator = existing.createdBy === user.userId;
    if (!isCreator && !rlsContext.isAdmin) {
      throw new ConvexError({
        code: 'forbidden',
        message: 'Only the creator or an admin can restore this prompt',
      });
    }

    const target = existing.versionHistory?.find(
      (h) => h.version === args.targetVersion,
    );
    if (!target) {
      throw new ConvexError({
        code: 'version_not_found',
        message: `Version v${args.targetVersion} not found`,
      });
    }

    assertPromptSizes({ content: target.content });

    const built = buildNextVersionEntry({
      existing,
      content: target.content,
      publishedBy: user.userId,
    });

    await ctx.db.patch(args.promptId, {
      content: target.content,
      version: built.newVersion,
      versionHistory: built.nextHistory,
    });

    await emitPromptAudit(
      ctx,
      rlsContext,
      'prompt_template.restored_from_version',
      args.promptId,
      existing.title,
      { newVersion: built.newVersion, sourceVersion: args.targetVersion },
    );

    const updated = await ctx.db.get(args.promptId);
    if (!updated) {
      throw new ConvexError({
        code: 'not_found',
        message: 'Failed to read prompt after restore',
      });
    }
    return updated;
  },
});
