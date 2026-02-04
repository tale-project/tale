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

  const userId = (authUser as { id?: string; _id?: string }).id ?? authUser._id;
  const accountRes = await ctx.runQuery(components.betterAuth.adapter.findMany, {
    model: 'account',
    paginationOpts: { cursor: null, numItems: 1 },
    where: [
      { field: 'userId', value: userId, operator: 'eq' },
      { field: 'providerId', value: 'microsoft', operator: 'eq' },
    ],
  });

  const account = accountRes?.page?.[0] as {
    accessToken?: string;
    refreshToken?: string;
    accessTokenExpiresAt?: number;
  } | undefined;

  if (!account) {
    return null;
  }

  const expiresAt = account.accessTokenExpiresAt ?? null;
  const isExpired = expiresAt ? Date.now() > expiresAt : true;

  return {
    accessToken: account.accessToken ?? null,
    refreshToken: account.refreshToken ?? null,
    expiresAt,
    isExpired,
  };
}
