/**
 * Pure-function access rules for `promptCategories`.
 *
 * Kept ctx-free so the rules can be unit-tested in isolation and reused
 * verbatim by the picker on the client. Three rules:
 *
 *  - `canCreateCategoryInScope`: who is allowed to create a category at
 *    each scope.
 *  - `canManageCategory`: who is allowed to rename/delete an existing
 *    category. Personal stays personal even when the creator is an admin —
 *    only the creator manages a personal-scope row.
 *  - `assertCategoryScopeMatchesPromptScope`: the write-side invariant that
 *    keeps a prompt's category readable by every viewer of the prompt. A
 *    prompt at scope X can only reference a category whose scope is at
 *    least as permissive as X (and, where relevant, owned by/visible to
 *    the caller). This is what lets every reader resolve the category name
 *    without per-viewer hiding.
 */

import { ConvexError } from 'convex/values';

import type { Doc } from '../_generated/dataModel';

export type PromptScope = 'global' | 'team' | 'personal';

/**
 * Subset of a `promptCategories` row needed by the rule checks. Stays
 * structural so client callers can pass their own typed shape without
 * importing Convex's `Doc<>` helper.
 */
export interface CategoryAccessShape {
  scope: PromptScope;
  teamId?: string;
  createdBy: string;
}

/**
 * Who can create a category at `scope`. Team and global are admin-only,
 * matching the prompt-scope creation rules. Personal is open to any member
 * (they're creating it for themselves).
 */
export function canCreateCategoryInScope(args: {
  scope: PromptScope;
  isOrgAdmin: boolean;
}): boolean {
  if (args.scope === 'personal') return true;
  return args.isOrgAdmin;
}

/**
 * Who can rename or delete an existing category.
 *
 * Personal categories are creator-only — they remain personal even when
 * the creator happens to be an admin. Team and global categories are
 * managed by org admins regardless of which admin created the row.
 */
export function canManageCategory(args: {
  category: CategoryAccessShape;
  userId: string;
  isOrgAdmin: boolean;
}): boolean {
  const { category, userId, isOrgAdmin } = args;
  if (category.scope === 'personal') return category.createdBy === userId;
  return isOrgAdmin;
}

/**
 * Write-side invariant: a prompt at `promptScope` can only carry a
 * category whose scope is readable by every viewer of the prompt.
 *
 * | Prompt scope | Allowed category scopes                                  |
 * |--------------|----------------------------------------------------------|
 * | global       | global only                                              |
 * | team         | global, OR team-scope category matching the prompt team  |
 * | personal     | global, your-own-personal, OR a team you are a member of |
 *
 * Throws `ConvexError({ code: 'forbidden', ... })` on violation so callers
 * surface the error without leaking which combination was attempted.
 */
export function assertCategoryScopeMatchesPromptScope(args: {
  promptScope: PromptScope;
  /** Required iff `promptScope === 'team'`. */
  promptTeamId?: string;
  category: CategoryAccessShape;
  userId: string;
  userTeamIds: readonly string[];
}): void {
  const { promptScope, promptTeamId, category, userId, userTeamIds } = args;

  // Global categories are universally readable — always allowed.
  if (category.scope === 'global') return;

  if (promptScope === 'global') {
    throw new ConvexError({
      code: 'forbidden',
      message: 'Global prompts can only carry global categories',
    });
  }

  if (promptScope === 'team') {
    if (
      category.scope === 'team' &&
      category.teamId !== undefined &&
      category.teamId === promptTeamId
    ) {
      return;
    }
    throw new ConvexError({
      code: 'forbidden',
      message:
        "Team prompts can only carry global categories or the team's own categories",
    });
  }

  // promptScope === 'personal'
  if (category.scope === 'personal' && category.createdBy === userId) return;
  if (
    category.scope === 'team' &&
    category.teamId !== undefined &&
    userTeamIds.includes(category.teamId)
  ) {
    return;
  }
  throw new ConvexError({
    code: 'forbidden',
    message:
      'Personal prompts can only carry your own personal, your-team, or global categories',
  });
}

/**
 * Narrowing helper for callers that hand us a full `Doc<'promptCategories'>`.
 * Keeps call sites readable when we already loaded the row from the db.
 */
export function toCategoryAccessShape(
  doc: Doc<'promptCategories'>,
): CategoryAccessShape {
  return {
    scope: doc.scope,
    teamId: doc.teamId,
    createdBy: doc.createdBy,
  };
}
