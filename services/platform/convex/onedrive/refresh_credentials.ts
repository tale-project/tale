/**
 * Resolve the OAuth client credentials to refresh a Microsoft Graph token
 * against, based on which login wrote the account row.
 *
 * - `entra-id` rows (Enterprise SSO) were issued by the ORG's own Entra app
 *   registration — refresh must use that connection's client id/secret and
 *   tenant (from its issuer), or Microsoft rejects the refresh token as
 *   belonging to a different client.
 * - Legacy `microsoft` rows (the pre-SSO Better Auth social login) were issued
 *   by the deployment-level app in `AUTH_MICROSOFT_ENTRA_ID_*` env vars.
 *
 * The env credentials stay as the fallback either way, so deployments where
 * the SSO connection and the env app are the same registration keep working
 * even when the connection resolution comes up empty (e.g. several orgs have
 * SSO enabled and the account can't be pinned to one — see the `'ambiguous'`
 * branch of `resolveSignInConfig`).
 */

import { isRecord, getString } from '../../lib/utils/type-utils';
import { internal, components } from '../_generated/api';
import type { ActionCtx } from '../_generated/server';
import {
  EntraIssuerError,
  extractTenantId,
} from '../enterprise_sso/entra_id/constants';

export interface MicrosoftRefreshCredentials {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

function envCredentials(): MicrosoftRefreshCredentials | null {
  const tenantId = process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID;
  const clientId = process.env.AUTH_MICROSOFT_ENTRA_ID_ID;
  const clientSecret = process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET;
  if (!tenantId || !clientId || !clientSecret) return null;
  return { tenantId, clientId, clientSecret };
}

async function accountProviderId(
  ctx: ActionCtx,
  accountId: string,
): Promise<string | undefined> {
  const result = await ctx.runQuery(components.betterAuth.adapter.findMany, {
    model: 'account',
    where: [{ field: 'accountId', value: accountId, operator: 'eq' }],
    paginationOpts: { cursor: null, numItems: 1 },
  });
  const row: unknown = result?.page?.[0];
  return isRecord(row) ? getString(row, 'providerId') : undefined;
}

async function ssoConnectionCredentials(
  ctx: ActionCtx,
): Promise<MicrosoftRefreshCredentials | null> {
  const config = await ctx.runQuery(
    internal.enterprise_sso.internal_queries.resolveSignInConfig,
    {},
  );
  if (!config || config === 'ambiguous' || config.providerId !== 'entra-id') {
    return null;
  }

  let tenantId: string;
  try {
    tenantId = extractTenantId(config.issuer);
  } catch (error) {
    if (error instanceof EntraIssuerError) {
      console.warn(
        'resolveMicrosoftRefreshCredentials: SSO connection has an invalid issuer:',
        error.message,
      );
      return null;
    }
    throw error;
  }

  const secrets = await ctx.runAction(
    internal.enterprise_sso.config.file_actions.getConnectionSecrets,
    { organizationId: config.organizationId },
  );
  if (!secrets.clientId || !secrets.clientSecret) return null;

  return {
    tenantId,
    clientId: secrets.clientId,
    clientSecret: secrets.clientSecret,
  };
}

export async function resolveMicrosoftRefreshCredentials(
  ctx: ActionCtx,
  accountId: string,
): Promise<MicrosoftRefreshCredentials | null> {
  const providerId = await accountProviderId(ctx, accountId);

  if (providerId === 'entra-id') {
    try {
      const fromConnection = await ssoConnectionCredentials(ctx);
      if (fromConnection) return fromConnection;
    } catch (error) {
      console.warn(
        'resolveMicrosoftRefreshCredentials: Failed to read SSO connection credentials, falling back to env:',
        error instanceof Error ? error.message : error,
      );
    }
  }

  return envCredentials();
}
