/**
 * `promptCategories` queries and mutations.
 *
 * The table itself is additive in this slice: prompts still carry the
 * legacy `category: string` field. The lazy migration that translates
 * legacy strings into `categoryId` rows lives with the prompt
 * create/update mutations (slice 2). This module only owns the lifecycle
 * of the category rows themselves.
 *
 * Access rules (see `category_access.ts`):
 *  - Personal: any member can create their own; only the creator
 *    manages (rename/delete) — admin status does NOT override.
 *  - Team / global: admins only, end to end.
 *
 * The "delete clears `categoryId` on linked prompts" fan-out is wired
 * defensively even though no prompt row references `categoryId` yet —
 * once slice 2 lands, delete will already do the right thing without a
 * follow-up edit here.
 */

import { ConvexError, v } from 'convex/values';

import { internal } from '../_generated/api';
import type { Doc } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { getUserTeamIds } from '../lib/get_user_teams';
import { requireAuthenticatedUser } from '../lib/rls/auth/require_authenticated_user';
import { mutationWithRLS } from '../lib/rls/helpers/mutation_with_rls';
import { queryWithRLS } from '../lib/rls/helpers/query_with_rls';
import { validateOrganizationAccess } from '../lib/rls/organization/validate_organization_access';
import type { RLSContext } from '../lib/rls/types';
import {
  canCreateCategoryInScope,
  canManageCategory,
  toCategoryAccessShape,
} from './category_access';
import { MAX_PROMPT_CATEGORY_LEN } from './constants';
import {
  listCategoriesResultValidator,
  promptCategoryValidator,
  promptScopeValidator,
} from './validators';

/**
 * Audit emitter for category lifecycle. Mirrors `emitPromptAudit` in
 * `mutations.ts` — routed through an internal mutation because the RLS
 * wrapper denies non-admin direct writes to `auditLogs`.
 */
async function emitCategoryAudit(
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
    resourceType: 'prompt_category',
    resourceId,
    resourceName,
    newState,
    status: 'success',
  });
}

function normalizeName(name: string): { name: string; nameLower: string } {
  const trimmed = name.trim();
  return { name: trimmed, nameLower: trimmed.toLowerCase() };
}

function assertNameValid(name: string): void {
  if (name.length === 0) {
    throw new ConvexError({
      code: 'invalid_argument',
      message: 'Category name cannot be empty',
    });
  }
  if (name.length > MAX_PROMPT_CATEGORY_LEN) {
    throw new ConvexError({
      code: 'too_large',
      message: `Category name exceeds ${MAX_PROMPT_CATEGORY_LEN} characters`,
    });
  }
}

/**
 * Find an existing category in the same "uniqueness bucket" as the
 * candidate — used both by `createCategory` (reject) and the future lazy-
 * migration code path (find-or-create). Buckets:
 *  - personal: same (org, scope, createdBy, nameLower)
 *  - team:     same (org, scope, teamId, nameLower)
 *  - global:   same (org, scope, nameLower)
 *
 * Uses the `by_organizationId_and_nameLower` index to scope the scan to
 * matching-name rows in the org; bucket filtering happens in memory on
 * what is expected to be a tiny result set (collisions only).
 */
export async function findCategoryInBucket(
  ctx: { db: MutationCtx['db'] },
  args: {
    organizationId: string;
    scope: 'global' | 'team' | 'personal';
    teamId?: string;
    createdBy: string;
    nameLower: string;
  },
): Promise<Doc<'promptCategories'> | null> {
  const candidates = await ctx.db
    .query('promptCategories')
    .withIndex('by_organizationId_and_nameLower', (q) =>
      q
        .eq('organizationId', args.organizationId)
        .eq('nameLower', args.nameLower),
    )
    .collect();

  for (const c of candidates) {
    if (c.scope !== args.scope) continue;
    if (args.scope === 'team' && c.teamId !== args.teamId) continue;
    if (args.scope === 'personal' && c.createdBy !== args.createdBy) continue;
    return c;
  }
  return null;
}

/**
 * Categories the caller can see, bucketed by scope. Drives the picker.
 *
 * Visibility:
 *  - personal: rows the caller created.
 *  - team:     rows for teams the caller is a member of.
 *  - global:   all rows in the org.
 *
 * The picker on the form filters further by the form's current scope
 * (and selected teamId for team-scope prompts) — we return all three
 * buckets at once so toggling scope doesn't trigger a new round-trip.
 */
export const listCategories = queryWithRLS({
  args: {
    organizationId: v.string(),
  },
  returns: listCategoriesResultValidator,
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedUser(ctx);
    // Org membership gate — non-members get an empty result rather than
    // an error so the picker degrades gracefully when the user is in the
    // middle of an org switch.
    await validateOrganizationAccess(ctx, args.organizationId, undefined, user);

    const userTeamIds = await getUserTeamIds(ctx, user.userId);
    const userTeamSet = new Set(userTeamIds);

    const personal: Doc<'promptCategories'>[] = [];
    const team: Doc<'promptCategories'>[] = [];
    const global: Doc<'promptCategories'>[] = [];

    for await (const row of ctx.db
      .query('promptCategories')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )) {
      if (row.scope === 'global') {
        global.push(row);
      } else if (row.scope === 'team') {
        if (row.teamId && userTeamSet.has(row.teamId)) team.push(row);
      } else if (row.scope === 'personal') {
        if (row.createdBy === user.userId) personal.push(row);
      }
    }

    const byName = (a: Doc<'promptCategories'>, b: Doc<'promptCategories'>) =>
      a.nameLower.localeCompare(b.nameLower);
    personal.sort(byName);
    team.sort(byName);
    global.sort(byName);

    return { personal, team, global };
  },
});

/**
 * Create a category at the requested scope. Personal: any member.
 * Team / global: admins only. Duplicate-name (case-insensitive) in the
 * same uniqueness bucket is rejected.
 *
 * Team-scope creates do NOT also assert that the actor is a member of
 * the team — admins manage team categories whether they belong to the
 * team or not. (The prompt-side write invariant still keeps non-members
 * from attaching to prompts they can't read.)
 */
export const createCategory = mutationWithRLS({
  args: {
    organizationId: v.string(),
    scope: promptScopeValidator,
    teamId: v.optional(v.string()),
    name: v.string(),
  },
  returns: promptCategoryValidator,
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedUser(ctx);
    const rlsContext = await validateOrganizationAccess(
      ctx,
      args.organizationId,
      undefined,
      user,
    );

    if (
      !canCreateCategoryInScope({
        scope: args.scope,
        isOrgAdmin: rlsContext.isAdmin,
      })
    ) {
      throw new ConvexError({
        code: 'forbidden',
        message: `Only admins can create ${args.scope} categories`,
      });
    }

    if (args.scope === 'team' && !args.teamId) {
      throw new ConvexError({
        code: 'invalid_argument',
        message: 'Team-scope categories must specify a teamId',
      });
    }
    // Ignore caller-supplied teamId for non-team scopes so a stray value
    // can't leak into a personal/global row and confuse the dedup check.
    const teamId = args.scope === 'team' ? args.teamId : undefined;

    const { name, nameLower } = normalizeName(args.name);
    assertNameValid(name);

    const duplicate = await findCategoryInBucket(ctx, {
      organizationId: args.organizationId,
      scope: args.scope,
      teamId,
      createdBy: user.userId,
      nameLower,
    });
    if (duplicate) {
      throw new ConvexError({
        code: 'duplicate_category',
        message: `A ${args.scope} category named "${duplicate.name}" already exists`,
      });
    }

    const id = await ctx.db.insert('promptCategories', {
      organizationId: args.organizationId,
      scope: args.scope,
      teamId,
      createdBy: user.userId,
      name,
      nameLower,
    });

    const row = await ctx.db.get(id);
    if (!row) {
      throw new ConvexError({
        code: 'internal_error',
        message: 'Failed to read category after insert',
      });
    }

    await emitCategoryAudit(
      ctx,
      rlsContext,
      'prompt_category.created',
      id,
      name,
      { scope: args.scope, teamId },
    );

    return row;
  },
});

/**
 * Rename a category. Manageability follows scope:
 *  - personal: creator only (admin status does NOT override).
 *  - team / global: admins only.
 *
 * The new name must be unique in the same uniqueness bucket.
 */
export const renameCategory = mutationWithRLS({
  args: {
    categoryId: v.id('promptCategories'),
    name: v.string(),
  },
  returns: promptCategoryValidator,
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedUser(ctx);
    const existing = await ctx.db.get(args.categoryId);
    if (!existing) {
      throw new ConvexError({
        code: 'not_found',
        message: 'Category not found',
      });
    }
    const rlsContext = await validateOrganizationAccess(
      ctx,
      existing.organizationId,
      undefined,
      user,
    );

    if (
      !canManageCategory({
        category: toCategoryAccessShape(existing),
        userId: user.userId,
        isOrgAdmin: rlsContext.isAdmin,
      })
    ) {
      throw new ConvexError({
        code: 'forbidden',
        message: 'You cannot manage this category',
      });
    }

    const { name, nameLower } = normalizeName(args.name);
    assertNameValid(name);

    if (nameLower !== existing.nameLower) {
      const duplicate = await findCategoryInBucket(ctx, {
        organizationId: existing.organizationId,
        scope: existing.scope,
        teamId: existing.teamId,
        createdBy: existing.createdBy,
        nameLower,
      });
      if (duplicate && duplicate._id !== existing._id) {
        throw new ConvexError({
          code: 'duplicate_category',
          message: `A ${existing.scope} category named "${duplicate.name}" already exists`,
        });
      }
    }

    await ctx.db.patch(args.categoryId, { name, nameLower });

    const updated = await ctx.db.get(args.categoryId);
    if (!updated) {
      throw new ConvexError({
        code: 'internal_error',
        message: 'Failed to read category after rename',
      });
    }

    await emitCategoryAudit(
      ctx,
      rlsContext,
      'prompt_category.renamed',
      args.categoryId,
      name,
      { previousName: existing.name },
    );

    return updated;
  },
});

/**
 * Delete a category. Sets `categoryId` to undefined on every linked prompt
 * in the same transaction so the fan-out is atomic with the row removal.
 * Version-history snapshots keep their (now-dangling) id — slice 2's
 * display path tolerates this and falls back to the snapshot's legacy
 * `category` string or a "(deleted)" label.
 *
 * No dedicated `by_organizationId_and_categoryId` index yet; we scan via
 * the existing org index. Deletes are rare; if scan cost becomes an issue
 * after slice 2 wires up `categoryId`, add the index without changing
 * this code.
 */
export const deleteCategory = mutationWithRLS({
  args: {
    categoryId: v.id('promptCategories'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedUser(ctx);
    const existing = await ctx.db.get(args.categoryId);
    if (!existing) {
      throw new ConvexError({
        code: 'not_found',
        message: 'Category not found',
      });
    }
    const rlsContext = await validateOrganizationAccess(
      ctx,
      existing.organizationId,
      undefined,
      user,
    );

    if (
      !canManageCategory({
        category: toCategoryAccessShape(existing),
        userId: user.userId,
        isOrgAdmin: rlsContext.isAdmin,
      })
    ) {
      throw new ConvexError({
        code: 'forbidden',
        message: 'You cannot manage this category',
      });
    }

    // Fan-out: clear `categoryId` on every prompt row that referenced this
    // category. Slice 2 stamps `categoryId`; until then this loop is a
    // no-op fast path because the field is never set, but wiring it now
    // means the contract is in place from day one.
    let clearedCount = 0;
    for await (const prompt of ctx.db
      .query('promptTemplates')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', existing.organizationId),
      )) {
      if (prompt.categoryId === args.categoryId) {
        await ctx.db.patch(prompt._id, { categoryId: undefined });
        clearedCount++;
      }
    }

    await ctx.db.delete(args.categoryId);

    await emitCategoryAudit(
      ctx,
      rlsContext,
      'prompt_category.deleted',
      args.categoryId,
      existing.name,
      { scope: existing.scope, teamId: existing.teamId, clearedCount },
    );

    return null;
  },
});
