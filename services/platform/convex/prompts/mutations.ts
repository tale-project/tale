import { ConvexError, v } from 'convex/values';

import { internal } from '../_generated/api';
import type { MutationCtx } from '../_generated/server';
import { getUserTeamIds } from '../lib/get_user_teams';
import { checkOrganizationRateLimit } from '../lib/rate_limiter/helpers';
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

/**
 * Asserts the actor is a member of `teamId`. Throws `forbidden` otherwise.
 * Used by createPrompt/updatePrompt to prevent planting a team-scoped prompt
 * onto a team the actor doesn't belong to.
 */
async function assertTeamMembership(
  ctx: MutationCtx,
  userId: string,
  teamId: string,
): Promise<void> {
  const userTeamIds = await getUserTeamIds(ctx, userId);
  if (!userTeamIds.includes(teamId)) {
    throw new ConvexError({
      code: 'forbidden',
      message: 'You are not a member of this team',
    });
  }
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
    const content = args.content.trim();
    assertPromptSizes({
      content,
      title: args.title,
      description: args.description,
      category: args.category,
      tags: args.tags,
    });

    const user = await requireAuthenticatedUser(ctx);
    const rlsContext = await validateOrganizationAccess(
      ctx,
      args.organizationId,
      undefined,
      user,
    );

    // Org-scoped rate limit: each row can be ~218 KiB at full history depth,
    // so storage abuse is the real concern, not request volume.
    await checkOrganizationRateLimit(ctx, 'prompt:create', args.organizationId);

    if (args.scope === 'team' && args.teamId) {
      await assertTeamMembership(ctx, user.userId, args.teamId);
    }

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
      content,
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
          content,
          publishedAt: now,
          publishedBy: user.userId,
        },
      ],
    });

    const prompt = await ctx.db.get(id);
    if (!prompt) {
      throw new ConvexError({
        code: 'internal_error',
        message: 'Failed to read prompt after insert',
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
 *
 * Access-control-relevant metadata changes (scope, teamId) emit a distinct
 * `metadata_updated` audit event when no content change accompanies them.
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
    /**
     * Optimistic-concurrency token. When set, the mutation throws
     * `version_conflict` if the stored version differs — i.e. another writer
     * saved a newer version while this client was editing. Clients should
     * surface the conflict and let the user reload before resubmitting.
     */
    expectedVersion: v.optional(v.number()),
  },
  returns: v.union(promptTemplateValidator, v.null()),
  handler: async (ctx, args) => {
    const nextContent = args.content?.trim();
    assertPromptSizes({
      content: nextContent,
      title: args.title,
      description: args.description,
      category: args.category,
      tags: args.tags,
    });

    const user = await requireAuthenticatedUser(ctx);
    const existing = await ctx.db.get(args.promptId);
    if (!existing) return null;

    // Personal-scope creator gate runs BEFORE the OCC check so a non-creator
    // probing with a wrong expectedVersion can't learn the current version
    // through the version_conflict error data — the row should look "not
    // found" to anyone but its owner.
    if (existing.scope === 'personal' && existing.createdBy !== user.userId) {
      return null;
    }

    if (
      args.expectedVersion !== undefined &&
      existing.version !== args.expectedVersion
    ) {
      throw new ConvexError({
        code: 'version_conflict',
        message: `Prompt has been updated to v${existing.version ?? '?'}; reload to see the latest.`,
        data: {
          expectedVersion: args.expectedVersion,
          currentVersion: existing.version,
        },
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
        message: 'Only the creator or an admin can edit this prompt',
      });
    }

    // teamId membership check applies whether `scope` is being changed to
    // 'team' or `teamId` is being reassigned within an already-team prompt.
    const targetScope = args.scope ?? existing.scope;
    const targetTeamId =
      args.teamId !== undefined ? args.teamId : existing.teamId;
    if (targetScope === 'team' && targetTeamId) {
      await assertTeamMembership(ctx, user.userId, targetTeamId);
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

    const contentChanged =
      nextContent !== undefined && nextContent !== existing.content;
    let newVersion: number | undefined;
    let droppedVersions: number[] = [];

    if (contentChanged && nextContent !== undefined) {
      const built = buildNextVersionEntry({
        existing,
        content: nextContent,
        publishedBy: user.userId,
      });
      newVersion = built.newVersion;
      droppedVersions = built.droppedVersions;
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
      if (droppedVersions.length > 0) {
        await emitPromptAudit(
          ctx,
          rlsContext,
          'prompt_template.history_truncated',
          args.promptId,
          existing.title,
          { droppedVersions },
        );
      }
    } else if (
      !contentChanged &&
      ((args.scope !== undefined && args.scope !== existing.scope) ||
        (args.teamId !== undefined && args.teamId !== existing.teamId))
    ) {
      await emitPromptAudit(
        ctx,
        rlsContext,
        'prompt_template.metadata_updated',
        args.promptId,
        existing.title,
        {
          scope: { from: existing.scope, to: targetScope },
          teamId: { from: existing.teamId, to: targetTeamId },
        },
      );
    }

    return await ctx.db.get(args.promptId);
  },
});

/**
 * Hard-deletes the prompt and its inlined version history. Final — there is
 * no admin recovery path. The `prompt_template.deleted` audit row persists
 * independently in `auditLogs`, capturing actor, title at time of deletion,
 * scope, and last version for forensics.
 */
export const deletePrompt = mutationWithRLS({
  args: {
    promptId: v.id('promptTemplates'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedUser(ctx);
    const existing = await ctx.db.get(args.promptId);
    if (!existing) return null;

    if (existing.scope === 'personal' && existing.createdBy !== user.userId) {
      return null;
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
        message: 'Only the creator or an admin can delete this prompt',
      });
    }

    await ctx.db.delete(args.promptId);

    await emitPromptAudit(
      ctx,
      rlsContext,
      'prompt_template.deleted',
      args.promptId,
      existing.title,
      { scope: existing.scope, lastVersion: existing.version ?? 1 },
    );
    return null;
  },
});

export const incrementUsage = mutationWithRLS({
  args: {
    promptId: v.id('promptTemplates'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedUser(ctx);
    const existing = await ctx.db.get(args.promptId);
    if (!existing) return null;

    // Personal prompts are owner-only — silently ignore counter bumps from
    // anyone else (matches updatePrompt / restoreFromVersion / deletePrompt
    // gating, so a probing org member can't tell the row exists either).
    if (existing.scope === 'personal' && existing.createdBy !== user.userId) {
      return null;
    }

    await ctx.db.patch(args.promptId, {
      usageCount: existing.usageCount + 1,
    });
    return null;
  },
});

/**
 * Restores a historical version by cloning its content into a new version.
 * Forward-only: the historical row stays in versionHistory; this prepends
 * v(current+1) with the target version's content. A no-op when target
 * content equals the current content (returns existing without creating
 * a duplicate version entry).
 */
export const restoreFromVersion = mutationWithRLS({
  args: {
    promptId: v.id('promptTemplates'),
    targetVersion: v.number(),
    /**
     * Optimistic-concurrency token. Mirrors `updatePrompt.expectedVersion`:
     * if set and the stored version differs, throws `version_conflict`.
     * Prevents a "restore v5 → v9" click from silently stacking on top of a
     * concurrent v9 written between dialog open and confirm.
     */
    expectedVersion: v.optional(v.number()),
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

    if (existing.scope === 'personal' && existing.createdBy !== user.userId) {
      throw new ConvexError({
        code: 'not_found',
        message: 'Prompt not found',
      });
    }

    if (
      args.expectedVersion !== undefined &&
      existing.version !== args.expectedVersion
    ) {
      throw new ConvexError({
        code: 'version_conflict',
        message: `Prompt has been updated to v${existing.version ?? '?'}; reload history before restoring.`,
        data: {
          expectedVersion: args.expectedVersion,
          currentVersion: existing.version,
        },
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

    // Same-content guard: restoring a version whose content equals the
    // current content would create a duplicate v(n+1) entry, wasting a
    // FIFO slot. Return the existing row unchanged.
    if (target.content === existing.content) {
      return existing;
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
    if (built.droppedVersions.length > 0) {
      await emitPromptAudit(
        ctx,
        rlsContext,
        'prompt_template.history_truncated',
        args.promptId,
        existing.title,
        { droppedVersions: built.droppedVersions },
      );
    }

    const updated = await ctx.db.get(args.promptId);
    if (!updated) {
      throw new ConvexError({
        code: 'internal_error',
        message: 'Failed to read prompt after restore',
      });
    }
    return updated;
  },
});
