/**
 * Cloud-import OAuth2 start + callback for Knowledge Documents.
 *
 * Same security properties as connector OAuth (opaque hashed state, PKCE,
 * fixed redirect_uri, server-side token exchange). Differs in purpose and
 * storage: grant is per (org, user, provider) for import/sync, gated on
 * knowledgeWrite — not an org connector credential.
 */

import { defineAbilityFor } from '../../lib/permissions/ability';
import { internal } from '../_generated/api';
import type { ActionCtx } from '../_generated/server';
import {
  EntraIssuerError,
  extractTenantId,
} from '../enterprise_sso/entra_id/constants';
import { generatePkcePair } from '../enterprise_sso/pkce';
import { buildAuthorizeUrl } from '../http_connectors/authorize_url';
import {
  renderConnectorErrorPage,
  type ConnectorErrorKind,
} from '../http_connectors/error_page';
import {
  hashStateToken,
  isPlausibleStateToken,
  mintStateToken,
} from '../http_connectors/oauth_state';
import { resolveSessionUser } from '../http_connectors/session';
import { exchangeAuthorizationCode } from '../http_connectors/token_exchange';
import {
  cloudImportMicrosoftTenantMissingEnvNames,
  cloudImportOauthMissingEnvNames,
  microsoftCloudImportOauthUrls,
  resolveCloudImportOauthApp,
  resolveCloudImportOauthRedirectUri,
  resolveDocumentsUrl,
  resolveMicrosoftCloudImportTenantId,
} from './deployment_config';
import {
  getCloudImportProviderEndpoints,
  isCloudImportProvider,
  type CloudImportProviderEndpoints,
} from './providers';
import type { CloudImportProvider } from './schema';

const DISABLED_ROLE = 'disabled';

async function resolveMicrosoftTenantForOrg(
  ctx: ActionCtx,
  organizationId: string,
): Promise<string | null> {
  const fromEnv = resolveMicrosoftCloudImportTenantId();
  if (fromEnv) return fromEnv;

  const config = await ctx.runQuery(
    internal.enterprise_sso.internal_queries.resolveSignInConfig,
    { organizationId },
  );
  if (
    !config ||
    config === 'ambiguous' ||
    config.providerId !== 'entra-id' ||
    !config.issuer
  ) {
    return null;
  }
  try {
    return extractTenantId(config.issuer);
  } catch (error) {
    if (error instanceof EntraIssuerError) {
      console.warn(
        `[cloud-import:oauth2] org ${organizationId} Entra issuer is not usable as tenant: ${error.message}`,
      );
      return null;
    }
    throw error;
  }
}

async function resolveProviderEndpoints(
  ctx: ActionCtx,
  provider: CloudImportProvider,
  organizationId: string,
): Promise<
  | { ok: true; endpoints: CloudImportProviderEndpoints }
  | { ok: false; reason: 'not_configured' }
> {
  if (provider === 'onedrive') {
    const tenantId = await resolveMicrosoftTenantForOrg(ctx, organizationId);
    if (!tenantId) {
      console.error(
        `[cloud-import:oauth2] no Microsoft tenant for org ${organizationId}: set ${cloudImportMicrosoftTenantMissingEnvNames()}`,
      );
      return { ok: false, reason: 'not_configured' };
    }
    return {
      ok: true,
      endpoints: getCloudImportProviderEndpoints(
        provider,
        microsoftCloudImportOauthUrls(tenantId),
      ),
    };
  }
  return {
    ok: true,
    endpoints: getCloudImportProviderEndpoints(provider),
  };
}

function plainText(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      Vary: 'Cookie',
    },
  });
}

function errorPage(
  kind: ConnectorErrorKind,
  organizationId?: string,
): Response {
  const back =
    organizationId !== undefined ? resolveDocumentsUrl(organizationId) : null;
  return renderConnectorErrorPage(kind, back);
}

function successRedirect(organizationId: string, provider: string): Response {
  const base = resolveDocumentsUrl(organizationId);
  if (!base) {
    return plainText('Authorization saved. Return to Documents.', 200);
  }
  const url = new URL(base);
  url.searchParams.set('cloudImport', provider);
  url.searchParams.set('cloudImportStatus', 'connected');
  return Response.redirect(url.toString(), 302);
}

async function fetchMicrosoftAccountLabel(
  accessToken: string,
): Promise<string | undefined> {
  try {
    const response = await fetch(
      'https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName,displayName',
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!response.ok) return undefined;
    const data: unknown = await response.json();
    if (typeof data !== 'object' || data === null) return undefined;
    const record = data as Record<string, unknown>;
    for (const key of ['mail', 'userPrincipalName', 'displayName'] as const) {
      const value = record[key];
      if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}

async function fetchGoogleAccountLabel(
  accessToken: string,
): Promise<string | undefined> {
  try {
    const response = await fetch(
      'https://www.googleapis.com/oauth2/v2/userinfo',
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!response.ok) return undefined;
    const data: unknown = await response.json();
    if (typeof data !== 'object' || data === null) return undefined;
    const record = data as Record<string, unknown>;
    for (const key of ['email', 'name'] as const) {
      const value = record[key];
      if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}

async function fetchAccountLabel(
  provider: CloudImportProvider,
  accessToken: string,
): Promise<string | undefined> {
  if (provider === 'onedrive') {
    return fetchMicrosoftAccountLabel(accessToken);
  }
  return fetchGoogleAccountLabel(accessToken);
}

/**
 * GET /api/cloud-import/oauth2/start?provider=onedrive|google-drive&organizationId=<id>
 */
export async function cloudImportOauth2StartHandler(
  ctx: ActionCtx,
  req: Request,
): Promise<Response> {
  const url = new URL(req.url);
  const providerRaw = url.searchParams.get('provider') ?? '';
  const organizationId = url.searchParams.get('organizationId') ?? '';

  if (!isCloudImportProvider(providerRaw) || organizationId.length === 0) {
    return errorPage('unsupported_connector');
  }
  const provider = providerRaw;

  const redirectUri = resolveCloudImportOauthRedirectUri();
  if (!redirectUri) {
    console.error(
      '[cloud-import:oauth2] SITE_URL is unset — refusing OAuth redirect URI derivation',
    );
    return errorPage('not_configured');
  }

  const user = await resolveSessionUser(ctx, req);
  if (!user) {
    return plainText('Sign in to authorize cloud import.', 401);
  }

  const role = await ctx.runQuery(
    internal.members.internal_queries.getMemberRole,
    { userId: user.userId, organizationId },
  );
  if (role === null || role === DISABLED_ROLE) {
    return plainText('You do not have access to this organization.', 403);
  }
  if (defineAbilityFor(role).cannot('write', 'knowledgeWrite')) {
    return plainText(
      'Your role cannot import documents for this organization.',
      403,
    );
  }

  const app = resolveCloudImportOauthApp(provider);
  if (!app) {
    console.error(
      `[cloud-import:oauth2] no OAuth app for "${provider}": set ${cloudImportOauthMissingEnvNames(provider)}`,
    );
    return errorPage('not_configured', organizationId);
  }

  const resolved = await resolveProviderEndpoints(
    ctx,
    provider,
    organizationId,
  );
  if (!resolved.ok) {
    return errorPage('not_configured', organizationId);
  }

  const pkce = await generatePkcePair();
  const state = mintStateToken();
  await ctx.runMutation(
    internal.cloud_import.oauth_state_mutations.createPendingAuthorization,
    {
      stateHash: await hashStateToken(state),
      organizationId,
      userId: user.userId,
      provider,
      codeVerifier: pkce.verifier,
      redirectUri,
    },
  );

  let authorizeUrl: string;
  try {
    authorizeUrl = buildAuthorizeUrl({
      authorizeUrl: resolved.endpoints.authorizeUrl,
      scopes: [...resolved.endpoints.scopes],
      clientId: app.clientId,
      redirectUri,
      state,
      codeChallenge: pkce.challenge,
    });
  } catch (error) {
    console.error(
      `[cloud-import:oauth2] failed to build authorize URL for "${provider}" (${
        error instanceof Error ? error.name : 'unknown'
      })`,
    );
    return errorPage('not_configured', organizationId);
  }

  return Response.redirect(authorizeUrl, 302);
}

/**
 * GET /api/cloud-import/oauth2/callback
 */
export async function cloudImportOauth2CallbackHandler(
  ctx: ActionCtx,
  req: Request,
): Promise<Response> {
  const url = new URL(req.url);
  const state = url.searchParams.get('state') ?? '';
  const code = url.searchParams.get('code');
  const vendorError = url.searchParams.get('error');

  if (!isPlausibleStateToken(state)) {
    console.warn('[cloud-import:oauth2] refused a callback with unknown state');
    return errorPage('invalid_state');
  }

  const pending = await ctx.runMutation(
    internal.cloud_import.oauth_state_mutations.consumePendingAuthorization,
    { stateHash: await hashStateToken(state) },
  );
  if (!pending.ok) {
    console.warn(
      `[cloud-import:oauth2] refused a callback with ${pending.reason} state`,
    );
    return errorPage('invalid_state');
  }

  const { organizationId, userId, provider, codeVerifier, redirectUri } =
    pending;

  if (vendorError || !code) {
    return errorPage('vendor_declined', organizationId);
  }

  const app = resolveCloudImportOauthApp(provider);
  if (!app) {
    return errorPage('not_configured', organizationId);
  }

  const resolved = await resolveProviderEndpoints(
    ctx,
    provider,
    organizationId,
  );
  if (!resolved.ok) {
    return errorPage('not_configured', organizationId);
  }

  const exchange = await exchangeAuthorizationCode({
    tokenUrl: resolved.endpoints.tokenUrl,
    clientId: app.clientId,
    clientSecret: app.clientSecret,
    code,
    redirectUri,
    codeVerifier,
  });
  if (!exchange.ok) {
    console.error(
      `[cloud-import:oauth2] token exchange for "${provider}" failed: ${exchange.reason}` +
        (exchange.code ? ` (${exchange.code})` : ''),
    );
    return errorPage(
      exchange.reason === 'vendor_rejected'
        ? 'vendor_declined'
        : 'vendor_unreachable',
      organizationId,
    );
  }

  try {
    const accountLabel = await fetchAccountLabel(
      provider,
      exchange.tokens.accessToken,
    );
    await ctx.runAction(internal.cloud_import.actions.storeAuthorization, {
      organizationId,
      userId,
      provider,
      accessToken: exchange.tokens.accessToken,
      refreshToken: exchange.tokens.refreshToken,
      expiresAt: exchange.tokens.expiresAt,
      scopes: exchange.tokens.scopes,
      ...(accountLabel !== undefined && { accountLabel }),
    });
  } catch (error) {
    console.error(
      `[cloud-import:oauth2] storing "${provider}" authorization for org ${organizationId} failed (${
        error instanceof Error ? error.name : 'unknown'
      })`,
    );
    return errorPage('storage_failed', organizationId);
  }

  return successRedirect(organizationId, provider);
}
