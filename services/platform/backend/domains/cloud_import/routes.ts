import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import {
  cloudImportMicrosoftTenantMissingEnvNames,
  cloudImportOauthMissingEnvNames,
  microsoftCloudImportOauthUrls,
  resolveCloudImportOauthApp,
  resolveCloudImportOauthRedirectUri,
  resolveDocumentsUrl,
  resolveMicrosoftCloudImportTenantId,
} from '../../../convex/cloud_import/deployment_config.ts';
import {
  getCloudImportProviderEndpoints,
  type CloudImportProviderEndpoints,
} from '../../../convex/cloud_import/providers.ts';
import {
  EntraIssuerError,
  extractTenantId,
} from '../../../convex/enterprise_sso/entra_id/constants.ts';
import { generatePkcePair } from '../../../convex/enterprise_sso/pkce.ts';
import { buildAuthorizeUrl } from '../../../convex/http_connectors/authorize_url.ts';
import {
  renderConnectorErrorPage,
  type ConnectorErrorKind,
} from '../../../convex/http_connectors/error_page.ts';
import {
  hashStateToken,
  isPlausibleStateToken,
  mintStateToken,
} from '../../../convex/http_connectors/oauth_state.ts';
import { exchangeAuthorizationCode } from '../../../convex/http_connectors/token_exchange.ts';
import { defineAbilityFor } from '../../../lib/permissions/ability.ts';
import { getString, isRecord } from '../../../lib/utils/type-utils.ts';
import type { Auth } from '../../auth/auth.ts';
import { findOrganizationMember } from '../../auth/membership.ts';
import { requireOrgMember, type OrgEnv } from '../../auth/org.ts';
import { requireSession, type SessionBundle } from '../../auth/session.ts';
import { resolveSignInConfig } from '../sso/config.ts';
import {
  consumePendingCloudAuthorization,
  createPendingCloudAuthorization,
  isCloudImportProvider,
  listCloudAuthorizations,
  revokeCloudAuthorization,
  storeCloudAuthorization,
  type CloudImportProvider,
} from './service.ts';

/**
 * Cloud-import OAuth2 (the 0.4 `/api/cloud-import/oauth2/{start,callback}`
 * paths — vendor app registrations carry the callback, so the wire path is
 * identity) + the grants surface. Same security properties as connector
 * OAuth: opaque hashed state, PKCE, fixed redirect_uri, server-side token
 * exchange; the grant is per (org, user, provider), gated on
 * knowledgeWrite.
 */

const DISABLED_ROLE = 'disabled';

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

async function fetchAccountLabel(
  provider: CloudImportProvider,
  accessToken: string,
): Promise<string | undefined> {
  const target =
    provider === 'onedrive'
      ? {
          url: 'https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName,displayName',
          keys: ['mail', 'userPrincipalName', 'displayName'] as const,
        }
      : {
          url: 'https://www.googleapis.com/oauth2/v2/userinfo',
          keys: ['email', 'name'] as const,
        };
  try {
    const response = await fetch(target.url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return undefined;
    const data: unknown = await response.json();
    if (!isRecord(data)) return undefined;
    for (const key of target.keys) {
      const value = getString(data, key);
      if (value !== undefined && value.trim().length > 0) {
        return value.trim();
      }
    }
    return undefined;
  } catch (error) {
    console.debug('[cloud-import:oauth2] account label fetch failed', error);
    return undefined;
  }
}

async function resolveMicrosoftTenantForOrg(
  sql: Sql,
  organizationId: string,
): Promise<string | null> {
  const fromEnv = resolveMicrosoftCloudImportTenantId();
  if (fromEnv) return fromEnv;
  const config = await resolveSignInConfig(sql, organizationId);
  if (
    !config ||
    config === 'ambiguous' ||
    config.providerId !== 'entra-id' ||
    typeof config.issuer !== 'string'
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
  sql: Sql,
  provider: CloudImportProvider,
  organizationId: string,
): Promise<
  | { ok: true; endpoints: CloudImportProviderEndpoints }
  | { ok: false; reason: 'not_configured' }
> {
  if (provider === 'onedrive') {
    const tenantId = await resolveMicrosoftTenantForOrg(sql, organizationId);
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
  return { ok: true, endpoints: getCloudImportProviderEndpoints(provider) };
}

/** The unauthenticated-path pair (session read inside, the 0.4 shape). */
export function createCloudImportOauthRoutes(deps: {
  sql: Sql;
  auth: Auth;
}): Hono {
  const app = new Hono();

  app.get('/start', async (c) => {
    const providerRaw = c.req.query('provider') ?? '';
    const organizationId = c.req.query('organizationId') ?? '';
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

    const session: SessionBundle | null = await deps.auth.api.getSession({
      headers: c.req.raw.headers,
    });
    if (!session) {
      return plainText('Sign in to authorize cloud import.', 401);
    }
    const member = await findOrganizationMember(
      deps.sql,
      organizationId,
      session.user.id,
    );
    if (!member || member.role === DISABLED_ROLE) {
      return plainText('You do not have access to this organization.', 403);
    }
    if (defineAbilityFor(member.role).cannot('write', 'knowledgeWrite')) {
      return plainText(
        'Your role cannot import documents for this organization.',
        403,
      );
    }

    const oauthApp = resolveCloudImportOauthApp(provider);
    if (!oauthApp) {
      console.error(
        `[cloud-import:oauth2] no OAuth app for "${provider}": set ${cloudImportOauthMissingEnvNames(provider)}`,
      );
      return errorPage('not_configured', organizationId);
    }
    const resolved = await resolveProviderEndpoints(
      deps.sql,
      provider,
      organizationId,
    );
    if (!resolved.ok) {
      return errorPage('not_configured', organizationId);
    }

    const pkce = await generatePkcePair();
    const state = mintStateToken();
    await createPendingCloudAuthorization(deps.sql, {
      stateHash: await hashStateToken(state),
      organizationId,
      userId: session.user.id,
      provider,
      codeVerifier: pkce.verifier,
      redirectUri,
    });

    let authorizeUrl: string;
    try {
      authorizeUrl = buildAuthorizeUrl({
        authorizeUrl: resolved.endpoints.authorizeUrl,
        scopes: [...resolved.endpoints.scopes],
        clientId: oauthApp.clientId,
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
    return c.redirect(authorizeUrl, 302);
  });

  app.get('/callback', async (c) => {
    const state = c.req.query('state') ?? '';
    const code = c.req.query('code');
    const vendorError = c.req.query('error');

    if (!isPlausibleStateToken(state)) {
      console.warn(
        '[cloud-import:oauth2] refused a callback with unknown state',
      );
      return errorPage('invalid_state');
    }
    const pending = await consumePendingCloudAuthorization(
      deps.sql,
      await hashStateToken(state),
    );
    if (!pending.ok) {
      console.warn(
        `[cloud-import:oauth2] refused a callback with ${pending.reason} state`,
      );
      return errorPage('invalid_state');
    }
    const { organizationId, userId, provider, codeVerifier, redirectUri } =
      pending;

    if (vendorError !== undefined || code === undefined) {
      return errorPage('vendor_declined', organizationId);
    }
    const oauthApp = resolveCloudImportOauthApp(provider);
    if (!oauthApp) {
      return errorPage('not_configured', organizationId);
    }
    const resolved = await resolveProviderEndpoints(
      deps.sql,
      provider,
      organizationId,
    );
    if (!resolved.ok) {
      return errorPage('not_configured', organizationId);
    }

    const exchange = await exchangeAuthorizationCode({
      tokenUrl: resolved.endpoints.tokenUrl,
      clientId: oauthApp.clientId,
      clientSecret: oauthApp.clientSecret,
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
      await storeCloudAuthorization(deps.sql, {
        organizationId,
        userId,
        provider,
        accessToken: exchange.tokens.accessToken,
        ...(exchange.tokens.refreshToken !== undefined
          ? { refreshToken: exchange.tokens.refreshToken }
          : {}),
        ...(exchange.tokens.expiresAt !== undefined
          ? { expiresAt: exchange.tokens.expiresAt }
          : {}),
        scopes: exchange.tokens.scopes ?? [],
        ...(accountLabel !== undefined ? { accountLabel } : {}),
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
  });

  return app;
}

/** The session-gated grants surface (`/api/app/cloud-import`). */
export function createCloudImportRoutes(deps: {
  sql: Sql;
  auth: Auth;
}): Hono<OrgEnv> {
  const app = new Hono<OrgEnv>();
  app.use(requireSession(deps.auth), requireOrgMember(deps.sql));

  const caller = (c: Context<OrgEnv>) => ({
    organizationId: c.get('orgId'),
    userId: c.get('sessionBundle').user.id,
  });

  app.get('/authorizations', async (c) => {
    return c.json({
      authorizations: await listCloudAuthorizations(deps.sql, caller(c)),
    });
  });

  app.post('/authorizations/:provider/revoke', async (c) => {
    const provider = z
      .enum(['onedrive', 'google-drive'])
      .safeParse(c.req.param('provider'));
    if (!provider.success) return c.json({ error: 'unknown provider' }, 404);
    const revoked = await revokeCloudAuthorization(deps.sql, {
      ...caller(c),
      provider: provider.data,
    });
    return c.json({ ok: true, revoked });
  });

  return app;
}
