/**
 * Update Microsoft OAuth tokens - Business logic
 */

import type { MutationCtx } from '../../../_generated/server';
import { components } from '../../../_generated/api';

export interface UpdateTokensArgs {
  accountId: string;
  accessToken: string;
  accessTokenExpiresAt: number | null;
  refreshToken?: string;
  refreshTokenExpiresAt?: number | null;
}

/**
 * Update Microsoft account tokens in Better Auth storage
 * 
 * This is the shared business logic for updating OAuth tokens.
 * Used by both internal and public mutations.
 */
export async function updateMicrosoftTokens(
  ctx: MutationCtx,
  args: UpdateTokensArgs,
): Promise<void> {
  try {
    // First, find the account to verify it exists
    const accounts = await ctx.runQuery(
      components.betterAuth.adapter.findMany,
      {
        model: 'account',
        where: [
          { field: 'accountId', value: args.accountId, operator: 'eq' },
        ],
        paginationOpts: {
          cursor: null,
          numItems: 1,
        },
      },
    );

    if (!accounts || accounts.length === 0) {
      throw new Error('Microsoft account not found');
    }

    // Update the account using Better Auth component's updateMany function
    await ctx.runMutation(components.betterAuth.adapter.updateMany, {
      input: {
        model: 'account' as const,
        where: [
          { field: 'accountId', value: args.accountId, operator: 'eq' },
        ],
        update: {
          accessToken: args.accessToken,
          accessTokenExpiresAt: args.accessTokenExpiresAt,
          ...(args.refreshToken && { refreshToken: args.refreshToken }),
          ...(args.refreshTokenExpiresAt && {
            refreshTokenExpiresAt: args.refreshTokenExpiresAt,
          }),
          updatedAt: Date.now(),
        },
      },
      paginationOpts: {
        cursor: null,
        numItems: 1,
      },
    });
  } catch (error) {
    console.error(
      'updateMicrosoftTokens: Error updating tokens:',
      error,
    );
    throw new Error('Failed to update Microsoft account tokens');
  }
}

