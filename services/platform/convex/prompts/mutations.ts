import { ConvexError, v } from 'convex/values';

import { internal } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { loadActiveHolds } from '../governance/legal_hold';
import { getUserTeamIds } from '../lib/get_user_teams';
import { checkUserRateLimit } from '../lib/rate_limiter/helpers';
import { requireAuthenticatedUser } from '../lib/rls/auth/require_authenticated_user';
import { mutationWithRLS } from '../lib/rls/helpers/mutation_with_rls';
import { validateOrganizationAccess } from '../lib/rls/organization/validate_organization_access';
import type { RLSContext } from '../lib/rls/types';
import { findCategoryInBucket } from './categories';
import {
  assertCategoryScopeMatchesPromptScope,
  canCreateCategoryInScope,
  toCategoryAccessShape,
} from './category_access';
import { isActivePrompt } from './queries';
import { assertPromptSizes, normalizePromptFields } from './size_guards';
import { promptScopeValidator, promptTemplateValidator } from './validators';
import {
  buildInitialVersionEntry,
  buildNextVersionEntry,
  metadataDiffers,
  resolveRestoreTarget,
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
 * onto a team the actor doesn't belong to. Widened to `QueryCtx | MutationCtx`
 * so the action's pre-flight internalQuery can reuse it before the LLM call.
 */
async function assertTeamMembership(
  ctx: QueryCtx | MutationCtx,
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

/**
 * Resolve the effective `categoryId` for a prompt write, honoring the
 * dual-field transition and the write-side scope invariant. Returns
 * `undefined` when the caller cleared the category (or never set one).
 *
 * Three input shapes, in order of precedence:
 *
 *  1. `callerCategoryId` — explicit id from a modern client. Validated:
 *     must belong to the same org, and its scope must satisfy
 *     `assertCategoryScopeMatchesPromptScope` for the target prompt
 *     scope/team. Returns the id verbatim.
 *
 *  2. `callerCategoryString` (legacy) — find-or-create within the bucket
 *     determined by the prompt's scope:
 *       personal → (personal, owner = caller)
 *       team     → (team,     teamId = prompt's team)
 *       global   → (global,   no owner)
 *     If a matching row exists, reuse it. Otherwise the caller must be
 *     allowed to create at that scope (admins for team/global; anyone for
 *     personal) — if not, throw `forbidden`. This is the lazy-migration
 *     path used when an old client still sends `category: string`.
 *
 *  3. `inheritedCategoryId` — keep what the existing row already had.
 *     Re-validated against the (possibly new) prompt scope so that a
 *     scope flip can clear an incompatible id. We clear instead of
 *     reject because the form already clears client-side; surfacing a
 *     `forbidden` here would block an otherwise-valid save.
 *
 *  4. `inheritedCategoryString` — same lazy migration as (2) but kicked
 *     off because the existing row still carries a legacy string. Any
 *     write that touches metadata stamps an id so the string can be
 *     swept later.
 *
 * `clearedOnScopeMismatch` is true when a previously-set id was dropped
 * because it didn't survive the new scope. The caller surfaces this in
 * the audit row so we can grep for silent clears in production logs.
 */
async function resolveCategoryIdForWrite(
  ctx: MutationCtx,
  args: {
    organizationId: string;
    userId: string;
    isOrgAdmin: boolean;
    userTeamIds: readonly string[];
    promptScope: 'global' | 'team' | 'personal';
    promptTeamId?: string;
    callerCategoryId?: Id<'promptCategories'>;
    callerCategoryString?: string;
    inheritedCategoryId?: Id<'promptCategories'>;
    inheritedCategoryString?: string;
  },
): Promise<{
  categoryId: Id<'promptCategories'> | undefined;
  clearedOnScopeMismatch: boolean;
}> {
  // 1. Explicit id wins.
  if (args.callerCategoryId !== undefined) {
    const cat = await ctx.db.get(args.callerCategoryId);
    if (!cat || cat.organizationId !== args.organizationId) {
      throw new ConvexError({
        code: 'not_found',
        message: 'Category not found',
      });
    }
    assertCategoryScopeMatchesPromptScope({
      promptScope: args.promptScope,
      promptTeamId: args.promptTeamId,
      category: toCategoryAccessShape(cat),
      userId: args.userId,
      userTeamIds: args.userTeamIds,
    });
    return { categoryId: cat._id, clearedOnScopeMismatch: false };
  }

  // 2. Caller-supplied legacy string → find-or-create.
  const callerName = args.callerCategoryString?.trim();
  if (callerName) {
    const id = await findOrCreateCategoryFromString(ctx, {
      organizationId: args.organizationId,
      userId: args.userId,
      isOrgAdmin: args.isOrgAdmin,
      promptScope: args.promptScope,
      promptTeamId: args.promptTeamId,
      name: callerName,
    });
    return { categoryId: id, clearedOnScopeMismatch: false };
  }

  // The caller explicitly cleared via empty string. Surface as "no
  // category" rather than inheriting — matches the legacy semantics
  // where setting `category: ''` removed the value.
  if (args.callerCategoryString !== undefined && callerName === '') {
    return { categoryId: undefined, clearedOnScopeMismatch: false };
  }

  // 3. Inherited id — re-validate against current scope.
  if (args.inheritedCategoryId !== undefined) {
    const cat = await ctx.db.get(args.inheritedCategoryId);
    if (cat && cat.organizationId === args.organizationId) {
      try {
        assertCategoryScopeMatchesPromptScope({
          promptScope: args.promptScope,
          promptTeamId: args.promptTeamId,
          category: toCategoryAccessShape(cat),
          userId: args.userId,
          userTeamIds: args.userTeamIds,
        });
        return { categoryId: cat._id, clearedOnScopeMismatch: false };
      } catch {
        // Scope flip invalidated the existing category. Clear silently —
        // the form already clears client-side; this is the server-side
        // safety net for older clients or direct API consumers.
        return { categoryId: undefined, clearedOnScopeMismatch: true };
      }
    }
    // Dangling id (row deleted) — treat as cleared.
    return { categoryId: undefined, clearedOnScopeMismatch: false };
  }

  // 4. Inherited legacy string — opportunistic lazy migration.
  const inheritedName = args.inheritedCategoryString?.trim();
  if (inheritedName) {
    try {
      const id = await findOrCreateCategoryFromString(ctx, {
        organizationId: args.organizationId,
        userId: args.userId,
        isOrgAdmin: args.isOrgAdmin,
        promptScope: args.promptScope,
        promptTeamId: args.promptTeamId,
        name: inheritedName,
      });
      return { categoryId: id, clearedOnScopeMismatch: false };
    } catch {
      // The inherited string can't be materialized in the new scope
      // (e.g. scope flipped to global but the actor isn't an admin who
      // can create a global category). Drop it silently — the user can
      // re-set explicitly if they want it back.
      return { categoryId: undefined, clearedOnScopeMismatch: true };
    }
  }

  return { categoryId: undefined, clearedOnScopeMismatch: false };
}

/**
 * Bucket-aware find-or-create used by both the caller-supplied-string
 * path and the inherited-string lazy migration. Bucket choice mirrors
 * the prompt-write invariant: a string on a `team`-scope prompt becomes
 * a team-scope category, etc. The personal bucket is owned by the
 * acting user — this is intentional: it means a non-admin can lazy-
 * migrate their own legacy strings without surfacing a `forbidden`.
 */
async function findOrCreateCategoryFromString(
  ctx: MutationCtx,
  args: {
    organizationId: string;
    userId: string;
    isOrgAdmin: boolean;
    promptScope: 'global' | 'team' | 'personal';
    promptTeamId?: string;
    name: string;
  },
): Promise<Id<'promptCategories'>> {
  const scope = args.promptScope;
  const teamId = scope === 'team' ? args.promptTeamId : undefined;
  if (scope === 'team' && !teamId) {
    throw new ConvexError({
      code: 'forbidden',
      message: 'Team-scoped prompts must specify a team',
    });
  }
  const nameLower = args.name.toLowerCase();

  // Bucket lookup. For team/global the bucket has a single owner
  // dimension (teamId / null); for personal the bucket also keys on
  // createdBy = caller.
  const existing = await findCategoryInBucket(ctx, {
    organizationId: args.organizationId,
    scope,
    teamId,
    createdBy: args.userId,
    nameLower,
  });
  if (existing) return existing._id;

  // Not found — create. Gated by the same rule as direct creation.
  if (!canCreateCategoryInScope({ scope, isOrgAdmin: args.isOrgAdmin })) {
    throw new ConvexError({
      code: 'forbidden',
      message: `Only admins can create ${scope} categories`,
    });
  }

  return await ctx.db.insert('promptCategories', {
    organizationId: args.organizationId,
    scope,
    teamId,
    createdBy: args.userId,
    name: args.name,
    nameLower,
  });
}

/** Narrow a prompt row into the shape `metadataDiffers` consumes. */
function promptMetadataView(
  prompt: Doc<'promptTemplates'>,
): Pick<
  Doc<'promptTemplates'>,
  | 'title'
  | 'description'
  | 'category'
  | 'categoryId'
  | 'tags'
  | 'scope'
  | 'teamId'
> {
  return {
    title: prompt.title,
    description: prompt.description,
    category: prompt.category,
    categoryId: prompt.categoryId,
    tags: prompt.tags,
    scope: prompt.scope,
    teamId: prompt.teamId,
  };
}

export const createPrompt = mutationWithRLS({
  args: {
    organizationId: v.string(),
    title: v.optional(v.string()),
    content: v.string(),
    description: v.optional(v.string()),
    scope: promptScopeValidator,
    teamId: v.optional(v.string()),
    /** Legacy free-form string. Lazy-migrated to a `promptCategories` row. */
    category: v.optional(v.string()),
    /** Preferred. References an existing `promptCategories` row. */
    categoryId: v.optional(v.id('promptCategories')),
    tags: v.optional(v.array(v.string())),
    sourceMessageId: v.optional(v.string()),
  },
  returns: promptTemplateValidator,
  handler: async (ctx, args) => {
    // Auth first, then size validation. Earlier ordering let unauthenticated
    // callers probe the size-cap constants by reading `ConvexError.data` and
    // wasted a TextEncoder pass on rejected requests.
    const user = await requireAuthenticatedUser(ctx);
    const rlsContext = await validateOrganizationAccess(
      ctx,
      args.organizationId,
      undefined,
      user,
    );

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

    await checkUserRateLimit(ctx, 'prompt:create', user.userId);

    if (args.scope === 'team') {
      if (!args.teamId) {
        throw new ConvexError({
          code: 'forbidden',
          message: 'Team-scoped prompts must specify a team',
        });
      }
      await assertTeamMembership(ctx, user.userId, args.teamId);
    }

    if (args.scope === 'global' && !rlsContext.isAdmin) {
      throw new ConvexError({
        code: 'forbidden',
        message: 'Only admins can create global prompts',
      });
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

    // Resolve the categoryId once before the row insert so the version
    // snapshot and the row agree. Both args.categoryId (modern client)
    // and args.category (legacy string) flow through the resolver.
    const userTeamIds = await getUserTeamIds(ctx, user.userId);
    const resolved = await resolveCategoryIdForWrite(ctx, {
      organizationId: args.organizationId,
      userId: user.userId,
      isOrgAdmin: rlsContext.isAdmin,
      userTeamIds,
      promptScope: args.scope,
      promptTeamId: teamId,
      callerCategoryId: args.categoryId,
      callerCategoryString: normalized.category,
    });

    const metadata: PromptVersionMetadata = {
      title,
      description: normalized.description,
      // Once an id is stamped, clear the legacy string so the row's
      // canonical representation is unambiguous. The string remains in
      // the row only on rows that never went through this write path.
      category: resolved.categoryId ? undefined : normalized.category,
      categoryId: resolved.categoryId,
      tags: normalized.tags,
      scope: args.scope,
      teamId,
    };

    const id = await ctx.db.insert('promptTemplates', {
      organizationId: args.organizationId,
      createdBy: user.userId,
      title,
      content,
      description: normalized.description,
      scope: args.scope,
      teamId,
      category: metadata.category,
      categoryId: metadata.categoryId,
      tags: normalized.tags,
      usageCount: 0,
      sourceMessageId: args.sourceMessageId,
      lifecycleStatus: 'active',
      // statusChangedAt is set only on lifecycle transitions (e.g.,
      // soft-delete). Stamping it at creation pollutes any "time since
      // status changed" calculation that doesn't pre-check `lifecycleStatus`.
      version: 1,
      versionHistory: [
        buildInitialVersionEntry({
          content,
          publishedBy: user.userId,
          publishedAt: now,
          metadata,
        }),
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
    /** Legacy free-form string. Lazy-migrated to a `promptCategories` row. */
    category: v.optional(v.string()),
    /** Preferred. References an existing `promptCategories` row. */
    categoryId: v.optional(v.id('promptCategories')),
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
    if (!isActivePrompt(existing)) return null;

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

    // OCC is required for any versioned row. Without this gate, a client that
    // omits `expectedVersion` reduces to last-write-wins with no signal.
    // Legacy rows (`version` undefined) are exempt — they predate versioning.
    if (existing.version !== undefined && args.expectedVersion === undefined) {
      throw new ConvexError({
        code: 'missing_expected_version',
        message:
          'expectedVersion is required when updating a versioned prompt.',
        data: { currentVersion: existing.version },
      });
    }
    if (
      args.expectedVersion !== undefined &&
      (existing.version ?? 1) !== args.expectedVersion
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

    await checkUserRateLimit(ctx, 'prompt:update', user.userId);

    // Resolve target metadata: caller-supplied fields override existing.
    const targetScope = args.scope ?? existing.scope;
    const targetTeamId =
      targetScope === 'team'
        ? args.teamId !== undefined
          ? args.teamId
          : existing.teamId
        : undefined;
    if (targetScope === 'team') {
      if (!targetTeamId) {
        throw new ConvexError({
          code: 'forbidden',
          message: 'Team-scoped prompts must specify a team',
        });
      }
      await assertTeamMembership(ctx, user.userId, targetTeamId);
    }

    // Promoting a prompt TO global scope is admin-only. A non-admin
    // creator can still edit (or downgrade) an already-global row they
    // own — the creator-or-admin gate above governs that. We only block
    // the scope-flip into global by a non-admin.
    if (
      targetScope === 'global' &&
      existing.scope !== 'global' &&
      !rlsContext.isAdmin
    ) {
      throw new ConvexError({
        code: 'forbidden',
        message: 'Only admins can promote a prompt to global scope',
      });
    }

    const targetTitle =
      normalized.title !== undefined ? normalized.title : existing.title;
    const targetDescription =
      normalized.description !== undefined
        ? normalized.description
        : existing.description;
    const targetTags =
      normalized.tags !== undefined ? normalized.tags : existing.tags;
    const targetContent =
      normalized.content !== undefined ? normalized.content : existing.content;

    // Resolve the categoryId for this write. Honors (in order): an
    // explicit `args.categoryId` from a modern client; a legacy
    // `args.category` string (lazy migration); the row's existing id
    // re-validated against the new scope; the row's legacy string
    // (opportunistic migration). Silent clear on scope mismatch matches
    // the form's client-side behavior so a stale id from an old client
    // doesn't fail an otherwise-valid save.
    const userTeamIds = await getUserTeamIds(ctx, user.userId);
    const resolved = await resolveCategoryIdForWrite(ctx, {
      organizationId: existing.organizationId,
      userId: user.userId,
      isOrgAdmin: rlsContext.isAdmin,
      userTeamIds,
      promptScope: targetScope,
      promptTeamId: targetTeamId,
      callerCategoryId: args.categoryId,
      callerCategoryString: normalized.category,
      inheritedCategoryId: existing.categoryId,
      inheritedCategoryString: existing.category,
    });
    const targetCategoryId = resolved.categoryId;

    const nextMetadata: PromptVersionMetadata = {
      title: targetTitle,
      description: targetDescription,
      // Once an id is stamped, clear the legacy string so the row's
      // canonical representation is unambiguous.
      category: targetCategoryId
        ? undefined
        : (normalized.category ?? undefined),
      categoryId: targetCategoryId,
      tags: targetTags,
      scope: targetScope,
      teamId: targetTeamId,
    };

    const contentChanged = targetContent !== existing.content;
    const metaChanged = metadataDiffers(
      promptMetadataView(existing),
      nextMetadata,
    );
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
      category: nextMetadata.category,
      categoryId: targetCategoryId,
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
        // Surface silent category clears so they're greppable in audit
        // logs without sending a user-visible error.
        categoryClearedOnScopeMismatch: resolved.clearedOnScopeMismatch,
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
    if (!isActivePrompt(existing)) return null;

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

    // Legal-hold gate. Hard-delete is final, so soft-delete of a held prompt
    // would still spoliate evidence — same contract as `deleteChatThread`.
    const holds = await loadActiveHolds(ctx, existing.organizationId);
    const ownerHeld = holds.userMembershipIds.has(existing.createdBy);
    if (holds.orgHeld || ownerHeld) {
      throw new ConvexError({
        code: 'legal_hold',
        message: holds.orgHeld
          ? 'Org is under an active legal hold — delete is blocked.'
          : 'Prompt creator is on a custodian legal hold — delete is blocked.',
        promptId: args.promptId,
        orgHeld: holds.orgHeld,
        userCustodianHeld: ownerHeld,
      });
    }

    await checkUserRateLimit(ctx, 'prompt:delete', user.userId);

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

    await checkUserRateLimit(ctx, 'prompt:incrementUsage', user.userId);

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
    if (!existing || !isActivePrompt(existing)) {
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

    // OCC is required for any versioned row. Legacy rows (`version` undefined)
    // are exempt — they predate versioning.
    if (existing.version !== undefined && args.expectedVersion === undefined) {
      throw new ConvexError({
        code: 'missing_expected_version',
        message:
          'expectedVersion is required when restoring a versioned prompt.',
        data: { currentVersion: existing.version },
      });
    }
    if (
      args.expectedVersion !== undefined &&
      (existing.version ?? 1) !== args.expectedVersion
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

    await checkUserRateLimit(ctx, 'prompt:restore', user.userId);

    const target = resolveRestoreTarget(existing, args.targetVersion);
    if (!target) {
      throw new ConvexError({
        code: 'version_not_found',
        message: `Version v${args.targetVersion} not found`,
      });
    }

    // Defense in depth: legacy entries with no metadata fall back to existing
    // row values so the restore can never erase metadata.
    const restoredScope = target.scope ?? existing.scope;
    const restoredTeamId =
      restoredScope === 'team' ? (target.teamId ?? existing.teamId) : undefined;
    // Team membership re-check before any category resolution — a
    // forbidden team beats fanout into category lookups.
    if (restoredScope === 'team') {
      if (!restoredTeamId) {
        throw new ConvexError({
          code: 'forbidden',
          message: 'Team-scoped prompts must specify a team',
        });
      }
      await assertTeamMembership(ctx, user.userId, restoredTeamId);
    }

    // Restoring to a global snapshot from a non-global current scope is
    // a re-promotion to global — admin-only, matching createPrompt /
    // updatePrompt. If the row is already global, the creator-or-admin
    // gate is sufficient.
    if (
      restoredScope === 'global' &&
      existing.scope !== 'global' &&
      !rlsContext.isAdmin
    ) {
      throw new ConvexError({
        code: 'forbidden',
        message: 'Only admins can restore a prompt to global scope',
      });
    }

    // Resolve the categoryId for the restored state. The snapshot may
    // carry an id, a legacy string, both, or neither. Treat the
    // snapshot values as *inherited* (not caller-supplied) so a
    // category that was later deleted or whose scope no longer matches
    // silently clears instead of throwing. Falls back to the row's
    // current id/string when the snapshot has neither.
    const userTeamIdsForRestore = await getUserTeamIds(ctx, user.userId);
    const restoredCategory = await resolveCategoryIdForWrite(ctx, {
      organizationId: existing.organizationId,
      userId: user.userId,
      isOrgAdmin: rlsContext.isAdmin,
      userTeamIds: userTeamIdsForRestore,
      promptScope: restoredScope,
      promptTeamId: restoredTeamId,
      callerCategoryId: undefined,
      callerCategoryString: undefined,
      inheritedCategoryId: target.categoryId ?? existing.categoryId,
      inheritedCategoryString: target.categoryId
        ? undefined
        : (target.category ?? existing.category),
    });

    const targetMetadata: PromptVersionMetadata = {
      title: target.title ?? existing.title,
      description: target.description ?? existing.description,
      category: restoredCategory.categoryId
        ? undefined
        : (target.category ?? existing.category),
      categoryId: restoredCategory.categoryId,
      tags: target.tags ?? existing.tags,
      scope: restoredScope,
      teamId: restoredTeamId,
    };

    // Same-state guard: if both content AND metadata already match the
    // current row, restore is a no-op (avoids burning a FIFO slot).
    if (
      target.content === existing.content &&
      !metadataDiffers(promptMetadataView(existing), targetMetadata)
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
      categoryId: targetMetadata.categoryId,
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
