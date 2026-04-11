/**
 * Resolve user context (role + team memberships) needed for budget enforcement.
 *
 * Centralizes the lookup logic so that all checkBudget() call sites
 * use consistent user-scoped team IDs and org role.
 */

import type { GenericQueryCtx } from 'convex/server';

import { components } from '../_generated/api';
import type { DataModel } from '../_generated/dataModel';
import { getUserTeamIds } from '../lib/get_user_teams';

interface BudgetContext {
  userTeamIds: string[];
  userRole: string | undefined;
}

interface BetterAuthMember {
  role?: string;
}

interface BetterAuthFindManyResult {
  page: BetterAuthMember[];
}

/**
 * Resolve the user's team memberships and org role for budget checks.
 *
 * @param ctx - Convex query context (works in both query and mutation contexts)
 * @param organizationId - The organization to look up the member role in
 * @param userId - The user whose context to resolve
 */
export async function resolveBudgetContext(
  ctx: GenericQueryCtx<DataModel>,
  organizationId: string,
  userId: string,
): Promise<BudgetContext> {
  const [userTeamIds, memberResult] = await Promise.all([
    getUserTeamIds(ctx, userId),
    ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: 'member',
      paginationOpts: { cursor: null, numItems: 1 },
      where: [
        { field: 'organizationId', value: organizationId, operator: 'eq' },
        { field: 'userId', value: userId, operator: 'eq' },
      ],
    }),
  ]);

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Better Auth adapter returns untyped records; shape is guaranteed by the member model
  const typedResult = memberResult as unknown as BetterAuthFindManyResult;
  const userRole = typedResult?.page?.[0]?.role ?? undefined;

  return { userTeamIds, userRole };
}
