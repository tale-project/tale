import { GenericQueryCtx } from 'convex/server';

import { DataModel } from '../_generated/dataModel';

type IsSsoConfiguredResult = {
  enabled: boolean;
  providerType?: string;
};

export async function isSsoConfigured(
  ctx: GenericQueryCtx<DataModel>,
): Promise<IsSsoConfiguredResult> {
  const provider = await ctx.db.query('ssoProviders').first();

  if (!provider) {
    return { enabled: false };
  }

  return {
    enabled: true,
    providerType: provider.providerId,
  };
}
