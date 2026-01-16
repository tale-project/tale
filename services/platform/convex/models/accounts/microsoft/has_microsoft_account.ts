/**
 * Check if user has Microsoft account - Business logic
 */

import type { QueryCtx } from '../../../_generated/server';
import { components } from '../../../_generated/api';
import { authComponent } from '../../../auth';

/**
 * Check if current user has a Microsoft account connected
 */
async function hasMicrosoftAccount(ctx: QueryCtx): Promise<boolean> {
  const authUser = await authComponent.getAuthUser(ctx);
  if (!authUser) return false;

  try {
    const result = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: 'account',
      where: [
        { field: 'userId', value: String(authUser._id), operator: 'eq' },
        { field: 'providerId', value: 'microsoft', operator: 'eq' },
      ],
      paginationOpts: {
        cursor: null,
        numItems: 1,
      },
    });

    return (
      result &&
      Array.isArray(result) &&
      result.length > 0 &&
      result[0].accessToken !== null
    );
  } catch {
    return false;
  }
}
