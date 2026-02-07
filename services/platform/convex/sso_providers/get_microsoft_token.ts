import { GenericQueryCtx } from 'convex/server';
import { DataModel } from '../_generated/dataModel';
import { authComponent } from '../auth';
import { components } from '../_generated/api';

type MicrosoftTokenResult = {
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: number | null;
  isExpired: boolean;
} | null;

export async function getMicrosoftToken(
  ctx: GenericQueryCtx<DataModel>,
): Promise<MicrosoftTokenResult> {
  const authUser = await authComponent.getAuthUser(ctx);
  if (!authUser) {
    return null;
  }

  const userId = String(authUser._id);
  const accountRes = await ctx.runQuery(components.betterAuth.adapter.findMany, {
    model: 'account',
    paginationOpts: { cursor: null, numItems: 1 },
    where: [
      { field: 'userId', value: userId, operator: 'eq' },
      { field: 'providerId', value: 'microsoft', operator: 'eq' },
    ],
  });

  const account = accountRes?.page?.[0];

  if (!account) {
    return null;
  }

  const accessToken = typeof account.accessToken === 'string' ? account.accessToken : null;
  const refreshToken = typeof account.refreshToken === 'string' ? account.refreshToken : null;
  const expiresAt = typeof account.accessTokenExpiresAt === 'number' ? account.accessTokenExpiresAt : null;
  const isExpired = expiresAt ? Date.now() > expiresAt : true;

  return {
    accessToken,
    refreshToken,
    expiresAt,
    isExpired,
  };
}
