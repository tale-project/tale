import { ConvexError, v } from 'convex/values';

import { internal } from '../_generated/api';
import type { MutationCtx } from '../_generated/server';
import { getUserTeamIds } from '../lib/get_user_teams';
import { checkOrganizationRateLimit } from '../lib/rate_limiter/helpers';
import { requireAuthenticatedUser } from '../lib/rls/auth/require_authenticated_user';
import { mutationWithRLS } from '../lib/rls/helpers/mutation_with_rls';
import { validateOrganizationAccess } from '../lib/rls/organization/validate_organization_access';
import type { RLSContext } from '../lib/rls/types';
import { assertPromptSizes, normalizePromptFields } from './size_guards';
import { promptScopeValidator, promptTemplateValidator } from './validators';
import {
  buildNextVersionEntry,
  metadataDiffers,
  type PromptVersionMetadata,
} from './version_history';

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
    // Trim every field before measuring AND before persisting. Whitespace
    // padding cannot bypass the caps. `assertPromptSizes` also rejects
    // whitespace-only content as `empty_content`.
    const normalized = normalizePromptFields({
      title: args.title,
      content: args.content,
      description: args.description,
      category: args.category,
      tags: args.tags,
    });
    assertPromptSizes(normalized);

    // assertPromptSizes guarantees content non-empty when provided.
    const content = normalized.content ?? '';

    const user = await requireAuthenticatedUser(ctx);
    const rlsContext = await validateOrganizationAccess(
      ctx,
      args.organizationId,
      undefined,
      user,
    );

    await checkOrganizationRateLimit(ctx, 'prompt:create', args.organizationId);

    if (args.scope === 'team' && args.teamId) {
      await assertTeamMembership(ctx, user.userId, args.teamId);
    }

    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const randomId = Array.from(
      { length: 5 },
      () => chars[Math.floor(Math.random() * chars.length)],
    ).join('');
    const title =
      normalized.title && normalized.title.length > 0
        ? normalized.title
        : `PROMPT-${randomId}`;
    const teamId = args.scope === 'team' ? args.teamId : undefined;
    const now = Date.now();

    const id = await ctx.db.insert('promptTemplates', {
      organizationId: args.organizationId,
      createdBy: user.userId,
      title,
      content,
      description: normalized.description,
      scope: args.scope,
      teamId,
      category: normalized.category,
      tags: normalized.tags,
      usageCount: 0,
      sourceMessageId: args.sourceMessageId,
      version: 1,
      versionHistory: [
        {
          version: 1,
          content,
          publishedAt: now,
          publishedBy: user.userId,
          title,
          description: normalized.description,
          category: normalized.category,
          tags: normalized.tags,
          scope: args.scope,
          teamId,
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
 * Updates prompt metadata and/or content. Any change — content OR metadata
 * — bumps the version and writes a new entry to versionHistory (which always
 * has the current version at index 0). Each save is an instant publish —
 * no draft layer.
 *
 * Returns `null` when the prompt was deleted, the caller is not the personal-
 * scope creator, or the caller is in another org. The client maps `null` to
 * a `notFound` toast so silent no-ops don't drop user edits.
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
    const normalized = normalizePromptFields({
      title: args.title,
      content: args.content,
      description: args.description,
      category: args.category,
      tags: args.tags,
    });
    assertPromptSizes(normalized);

    const user = await requireAuthenticatedUser(ctx);
    const existing = await ctx.db.get(args.promptId);
    if (!existing) return null;

    // Personal-scope creator gate runs first — a non-creator should see
    // the row as "not found" rather than learning anything about it.
    if (existing.scope === 'personal' && existing.createdBy !== user.userId) {
      return null;
    }

    // Org boundary before OCC so a cross-org probe with a stale
    // `expectedVersion` can't read the current version through the
    // version_conflict error data.
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

    await checkOrganizationRateLimit(
      ctx,
      'prompt:update',
      existing.organizationId,
    );

    // Resolve target metadata: caller-supplied fields override existing.
    const targetScope = args.scope ?? existing.scope;
    const targetTeamId =
      targetScope === 'team'
        ? args.teamId !== undefined
          ? args.teamId
          : existing.teamId
        : undefined;
    if (targetScope === 'team' && targetTeamId) {
      await assertTeamMembership(ctx, user.userId, targetTeamId);
    }

    const targetTitle =
      normalized.title !== undefined ? normalized.title : existing.title;
    const targetDescription =
      normalized.description !== undefined
        ? normalized.description
        : existing.description;
    const targetCategory =
      normalized.category !== undefined
        ? normalized.category
        : existing.category;
    const targetTags =
      normalized.tags !== undefined ? normalized.tags : existing.tags;
    const targetContent =
      normalized.content !== undefined ? normalized.content : existing.content;

    const nextMetadata: PromptVersionMetadata = {
      title: targetTitle,
      description: targetDescription,
      category: targetCategory,
      tags: targetTags,
      scope: targetScope,
      teamId: targetTeamId,
    };

    const contentChanged = targetContent !== existing.content;
    const metaChanged = metadataDiffers(existing, nextMetadata);
    if (!contentChanged && !metaChanged) {
      // No-op edit — nothing to bump, no audit event.
      return existing;
    }

    const built = buildNextVersionEntry({
      existing,
      content: targetContent,
      publishedBy: user.userId,
      metadata: nextMetadata,
    });

    await ctx.db.patch(args.promptId, {
      title: targetTitle,
      content: targetContent,
      description: targetDescription,
      category: targetCategory,
      tags: targetTags,
      scope: targetScope,
      teamId: targetTeamId,
      version: built.newVersion,
      versionHistory: built.nextHistory,
    });

    await emitPromptAudit(
      ctx,
      rlsContext,
      'prompt_template.saved',
      args.promptId,
      targetTitle,
      {
        version: built.newVersion,
        fromVersion: existing.version ?? 0,
        contentChanged,
        metadataChanged: metaChanged,
        scopeChanged: existing.scope !== targetScope,
      },
    );
    if (built.droppedVersions.length > 0) {
      await emitPromptAudit(
        ctx,
        rlsContext,
        'prompt_template.history_truncated',
        args.promptId,
        targetTitle,
        { droppedVersions: built.droppedVersions },
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
 * Restores a historical version by copying its full state — content AND
 * metadata — into a new version. Forward-only: the historical entry stays
 * in versionHistory; this prepends v(current+1) with the target version's
 * snapshot. A no-op when target state already equals current state
 * (returns existing without creating a duplicate version entry).
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

    // Org boundary before OCC so cross-org probes can't read the version.
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

    await checkOrganizationRateLimit(
      ctx,
      'prompt:restore',
      existing.organizationId,
    );

    const target = existing.versionHistory?.find(
      (h) => h.version === args.targetVersion,
    );
    if (!target) {
      throw new ConvexError({
        code: 'version_not_found',
        message: `Version v${args.targetVersion} not found`,
      });
    }

    // Defense in depth: legacy entries with no metadata fall back to existing
    // row values so the restore can never erase metadata.
    const targetMetadata: PromptVersionMetadata = {
      title: target.title ?? existing.title,
      description: target.description ?? existing.description,
      category: target.category ?? existing.category,
      tags: target.tags ?? existing.tags,
      scope: target.scope ?? existing.scope,
      teamId:
        (target.scope ?? existing.scope) === 'team'
          ? (target.teamId ?? existing.teamId)
          : undefined,
    };

    // Same-state guard: if both content AND metadata already match the
    // current row, restore is a no-op (avoids burning a FIFO slot).
    if (
      target.content === existing.content &&
      !metadataDiffers(existing, targetMetadata)
    ) {
      return existing;
    }

    assertPromptSizes({
      content: target.content,
      title: targetMetadata.title,
      description: targetMetadata.description,
      category: targetMetadata.category,
      tags: targetMetadata.tags,
    });

    // Team membership re-check: even on restore, the actor must be a member
    // of the target team. If the snapshot's team is no longer accessible,
    // surface forbidden.
    if (targetMetadata.scope === 'team' && targetMetadata.teamId) {
      await assertTeamMembership(ctx, user.userId, targetMetadata.teamId);
    }

    const built = buildNextVersionEntry({
      existing,
      content: target.content,
      publishedBy: user.userId,
      metadata: targetMetadata,
    });

    await ctx.db.patch(args.promptId, {
      title: targetMetadata.title,
      content: target.content,
      description: targetMetadata.description,
      category: targetMetadata.category,
      tags: targetMetadata.tags,
      scope: targetMetadata.scope,
      teamId: targetMetadata.teamId,
      version: built.newVersion,
      versionHistory: built.nextHistory,
    });

    await emitPromptAudit(
      ctx,
      rlsContext,
      'prompt_template.restored_from_version',
      args.promptId,
      targetMetadata.title,
      { newVersion: built.newVersion, sourceVersion: args.targetVersion },
    );
    if (built.droppedVersions.length > 0) {
      await emitPromptAudit(
        ctx,
        rlsContext,
        'prompt_template.history_truncated',
        args.promptId,
        targetMetadata.title,
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
