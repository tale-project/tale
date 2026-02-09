import { GenericActionCtx } from 'convex/server';

import { internal } from '../_generated/api';
import { DataModel } from '../_generated/dataModel';
import { decryptString } from '../lib/crypto/decrypt_string';
import { extractTenantId } from './entra_id/constants';

type GetSsoCredentialsForEmailResult = {
  clientId: string;
  clientSecret: string;
  tenantId: string;
} | null;

export async function getSsoCredentialsForEmail(
  ctx: GenericActionCtx<DataModel>,
  args: { organizationId: string },
): Promise<GetSsoCredentialsForEmailResult> {
  const authUser = await ctx.runQuery(
    internal.sso_providers.internal_queries.getAuthUser,
    {},
  );

  if (!authUser) {
    return null;
  }

  const callerRole = await ctx.runQuery(
    internal.sso_providers.internal_queries.getCallerRole,
    {
      organizationId: args.organizationId,
      userId: authUser._id,
    },
  );

  if (callerRole !== 'admin' && callerRole !== 'developer') {
    return null;
  }

  const provider = await ctx.runQuery(
    internal.sso_providers.internal_queries.getByOrganization,
    { organizationId: args.organizationId },
  );

  if (!provider) {
    return null;
  }

  const clientId = await decryptString(provider.clientIdEncrypted);
  const clientSecret = await decryptString(provider.clientSecretEncrypted);

  const ssoConfig = await ctx.runQuery(
    internal.sso_providers.internal_queries.getSsoConfig,
    {},
  );

  const tenantId = ssoConfig?.issuer ? extractTenantId(ssoConfig.issuer) : '';

  return {
    clientId,
    clientSecret,
    tenantId: tenantId === 'common' ? '' : tenantId,
  };
}
