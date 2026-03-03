import type { GenericQueryCtx } from 'convex/server';

import type { DataModel } from '../_generated/dataModel';

import { components } from '../_generated/api';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';

type MicrosoftTokenResult = {
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: number | null;
  isExpired: boolean;
} | null;

export async function getMicrosoftToken(
  ctx: GenericQueryCtx<DataModel>,
): Promise<MicrosoftTokenResult> {
  const authUser = await getAuthUserIdentity(ctx);
  if (!authUser) {
    return null;
  }

  const accountRes = await ctx.runQuery(
    components.betterAuth.adapter.findMany,
    {
      model: 'account',
      paginationOpts: { cursor: null, numItems: 1 },
      where: [
        { field: 'userId', value: authUser.userId, operator: 'eq' },
        { field: 'providerId', value: 'microsoft', operator: 'eq' },
      ],
    },
  );

  const account = accountRes?.page?.[0];

  if (!account) {
    return null;
  }

  const accessToken =
    typeof account.accessToken === 'string' ? account.accessToken : null;
  const refreshToken =
    typeof account.refreshToken === 'string' ? account.refreshToken : null;
  const expiresAt =
    typeof account.accessTokenExpiresAt === 'number'
      ? account.accessTokenExpiresAt
      : null;
  const isExpired = expiresAt ? Date.now() > expiresAt : true;

  return {
    accessToken,
    refreshToken,
    expiresAt,
    isExpired,
  };
}
