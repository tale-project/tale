import { getString, isRecord } from '../../../../lib/utils/type-utils';
import type {
  SsoProviderAdapter,
  SsoProviderConfig,
  AuthorizeUrlParams,
  TokenExchangeParams,
  SsoTokens,
  SsoUserInfo,
  SsoGroup,
  SsoProviderCapabilities,
  SsoAuthContext,
} from '../types';
import { OIDC_FETCH_TIMEOUT_MS } from '../oidc_discovery';
import {
  MICROSOFT_LOGIN_BASE,
  MICROSOFT_GRAPH_BASE,
  EntraIssuerError,
  extractTenantId,
} from './constants';

// Every call to Microsoft fails fast on a stalled socket, like the generic
// OIDC/OAuth2 adapters: the callback's 10-minute state window must never be
// eaten by a hung token exchange or a Graph page.
const fetchTimeout = (): AbortSignal => AbortSignal.timeout(OIDC_FETCH_TIMEOUT_MS);

const capabilities: SsoProviderCapabilities = {
  // PKCE stays off for Entra until verified against confidential-client
  // tenant policies; the generic OIDC adapter carries it (#1506).
  supportsPkce: false,
};

function buildAuthorizeUrl(
  config: SsoProviderConfig,
  params: AuthorizeUrlParams,
): URL {
  const tenantId = extractTenantId(config.issuer);
  const authUrl = new URL(
    `${MICROSOFT_LOGIN_BASE}/${tenantId}/oauth2/v2.0/authorize`,
  );

  const scopes = [...config.scopes];
  // getUserInfo always reads the signed-in user from Microsoft Graph `/me`,
  // which needs the User.Read delegated permission. Ensure it is requested even
  // when the configured scopes omit it (a scope set that lists only
  // GroupMember.Read.All would otherwise 403 the userinfo call).
  if (!scopes.some((s) => /(^|\/)user\.read$/i.test(s))) {
    scopes.push('https://graph.microsoft.com/User.Read');
  }
  if (params.additionalScopes) {
    for (const scope of params.additionalScopes) {
      if (!scopes.includes(scope)) {
        scopes.push(scope);
      }
    }
  }

  authUrl.searchParams.set('client_id', config.clientId);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('redirect_uri', params.redirectUri);
  authUrl.searchParams.set('scope', scopes.join(' '));
  authUrl.searchParams.set('state', params.state);
  authUrl.searchParams.set('response_mode', 'query');

  if (params.prompt) {
    authUrl.searchParams.set('prompt', params.prompt);
  }

  if (params.loginHint) {
    authUrl.searchParams.set('login_hint', params.loginHint);
  }

  if (params.domainHint) {
    authUrl.searchParams.set('domain_hint', params.domainHint);
  }

  if (params.claims) {
    authUrl.searchParams.set('claims', params.claims);
  }

  return authUrl;
}

async function exchangeCodeForTokens(
  config: SsoProviderConfig,
  params: TokenExchangeParams,
): Promise<SsoTokens> {
  const tenantId = extractTenantId(config.issuer);
  const tokenUrl = `${MICROSOFT_LOGIN_BASE}/${tenantId}/oauth2/v2.0/token`;

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code: params.code,
      redirect_uri: params.redirectUri,
      grant_type: 'authorization_code',
    }),
    signal: fetchTimeout(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token exchange failed: ${errorText}`);
  }

  const data = await response.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_in
      ? Date.now() + data.expires_in * 1000
      : undefined,
    idToken: data.id_token,
    scope: typeof data.scope === 'string' ? data.scope : undefined,
  };
}

function extractStringArray(values: unknown[]): string[] {
  const result: string[] = [];
  for (const v of values) {
    if (typeof v === 'string') {
      result.push(v);
    }
  }
  return result;
}

function parseIdTokenAuthContext(idToken: string): SsoAuthContext | undefined {
  try {
    const parts = idToken.split('.');
    if (parts.length !== 3 || !parts[1]) {
      return undefined;
    }
    const payload = JSON.parse(atob(parts[1]));
    const acrs = typeof payload.acrs === 'string' ? payload.acrs : undefined;
    const amr = Array.isArray(payload.amr)
      ? extractStringArray(payload.amr)
      : undefined;
    const mfaCompleted = amr ? amr.includes('mfa') : undefined;

    if (!acrs && !amr) {
      return undefined;
    }

    return { authContextClassRef: acrs, authMethodsRef: amr, mfaCompleted };
  } catch {
    return undefined;
  }
}

async function getUserInfo(
  _config: SsoProviderConfig,
  accessToken: string,
): Promise<SsoUserInfo> {
  const userInfoUrl = `${MICROSOFT_GRAPH_BASE}/me?$select=id,displayName,givenName,mail,userPrincipalName,jobTitle`;

  const response = await fetch(userInfoUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: fetchTimeout(),
  });

  if (!response.ok) {
    throw new Error(`Failed to get user info: ${response.status}`);
  }

  const data = await response.json();

  return {
    externalId: data.id,
    email: data.mail || data.userPrincipalName,
    name: data.displayName || data.givenName || '',
    // Graph returns every `$select`ed field even when empty, so a user with no
    // job title comes back as `jobTitle: null` (not an omitted key). Our
    // `SsoUserInfo.jobTitle` is a non-nullable optional string and the
    // downstream `handleSsoLogin` validator (`v.optional(v.string())`) rejects
    // `null` — normalise null/"" to `undefined` here at the boundary so a
    // title-less user can still sign in.
    jobTitle: data.jobTitle || undefined,
  };
}

/**
 * Graph pages `/me/memberOf` and `/me/appRoleAssignments` at 100 entries; a
 * page-1-only read silently truncates for enterprise users, and truncated
 * groups are WORSE than a failed fetch — `syncTeamsFromGroupNames` revokes
 * every membership IT granted that is missing from the list, so page-2+
 * synced teams would be REMOVED on each login. The cap bounds a
 * runaway/looping feed; exceeding it throws,
 * which lands in the callers' existing failed-fetch path (team sync skipped,
 * memberships preserved) instead of a silent partial list.
 */
const GRAPH_MAX_PAGES = 50;

async function fetchAllGraphPages(
  firstUrl: string,
  accessToken: string,
  resource: string,
): Promise<unknown[]> {
  const graphOrigin = new URL(MICROSOFT_GRAPH_BASE).origin;
  const values: unknown[] = [];
  let url: string | undefined = firstUrl;
  for (let page = 1; url !== undefined; page += 1) {
    if (page > GRAPH_MAX_PAGES) {
      throw new Error(
        `Graph pagination cap exceeded fetching ${resource} (more than ${GRAPH_MAX_PAGES} pages)`,
      );
    }
    const response: Response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: fetchTimeout(),
    });
    if (!response.ok) {
      throw new Error(`Graph API error: ${response.status}`);
    }
    const data: unknown = await response.json();
    if (isRecord(data) && Array.isArray(data.value)) {
      values.push(...data.value);
    }
    const nextLink = isRecord(data) ? data['@odata.nextLink'] : undefined;
    url =
      typeof nextLink === 'string' && nextLink !== '' ? nextLink : undefined;
    // The bearer token goes wherever we follow — only ever back to Graph.
    if (url !== undefined && new URL(url).origin !== graphOrigin) {
      throw new Error(
        `Graph pagination left ${graphOrigin} fetching ${resource} — refusing to follow`,
      );
    }
  }
  return values;
}

async function getGroups(
  _config: SsoProviderConfig,
  accessToken: string,
): Promise<SsoGroup[]> {
  const values = await fetchAllGraphPages(
    `${MICROSOFT_GRAPH_BASE}/me/memberOf?$select=id,displayName`,
    accessToken,
    'group memberships',
  );
  const groups: SsoGroup[] = [];
  for (const member of values) {
    if (!isRecord(member)) continue;
    if (member['@odata.type'] !== '#microsoft.graph.group') continue;
    const id = getString(member, 'id');
    const name = getString(member, 'displayName');
    if (id !== undefined && name !== undefined) {
      groups.push({ id, name });
    }
  }
  return groups;
}

async function getAppRoles(
  _config: SsoProviderConfig,
  accessToken: string,
): Promise<string[]> {
  try {
    const values = await fetchAllGraphPages(
      `${MICROSOFT_GRAPH_BASE}/me/appRoleAssignments?$select=appRoleId`,
      accessToken,
      'app role assignments',
    );
    const roles: string[] = [];
    for (const assignment of values) {
      if (!isRecord(assignment)) continue;
      const appRoleId = getString(assignment, 'appRoleId');
      if (appRoleId !== undefined && appRoleId !== '') {
        roles.push(appRoleId);
      }
    }
    return roles;
  } catch (error) {
    // Same contract as before: app roles are advisory for role mapping, a
    // failed fetch degrades to "no roles" (default role), never a dead login.
    console.error('[Entra ID] Failed to fetch app roles:', error);
    return [];
  }
}

async function validateConfig(
  config: Omit<SsoProviderConfig, 'clientSecret'> & { clientSecret?: string },
): Promise<{ valid: boolean; error?: string }> {
  // Reject a bare-GUID-degraded / v1 / non-Entra issuer BEFORE any network call
  // — otherwise "Test connection" would probe `common` and pass, then real
  // sign-in fails against the single-tenant app with an opaque AADSTS error.
  try {
    extractTenantId(config.issuer);
  } catch (error) {
    if (error instanceof EntraIssuerError) {
      return { valid: false, error: error.message };
    }
    throw error;
  }

  const discoveryUrl = config.issuer.endsWith('/')
    ? `${config.issuer}.well-known/openid-configuration`
    : `${config.issuer}/.well-known/openid-configuration`;

  try {
    const discoveryResponse = await fetch(discoveryUrl, {
      signal: fetchTimeout(),
    });
    if (!discoveryResponse.ok) {
      return {
        valid: false,
        error: `Invalid Issuer URL (HTTP ${discoveryResponse.status})`,
      };
    }

    const discoveryDoc = await discoveryResponse.json();
    if (!discoveryDoc.token_endpoint || !discoveryDoc.authorization_endpoint) {
      return { valid: false, error: 'Invalid OpenID configuration' };
    }

    if (config.clientSecret) {
      const tokenResponse = await fetch(discoveryDoc.token_endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: config.clientId,
          client_secret: config.clientSecret,
          scope: 'https://graph.microsoft.com/.default',
        }),
        signal: fetchTimeout(),
      });

      if (!tokenResponse.ok) {
        const errorBody = await tokenResponse.json().catch(() => ({}));
        const errorDesc = errorBody.error_description || errorBody.error;

        if (errorDesc?.includes('AADSTS700016')) {
          return {
            valid: false,
            error:
              'Invalid Client ID — the Application (client) ID was not found in this tenant.',
          };
        }
        if (errorDesc?.includes('AADSTS7000215')) {
          return {
            valid: false,
            error:
              'Invalid Client Secret — check the secret Value (not the Secret ID).',
          };
        }
        if (errorDesc?.includes('AADSTS700024')) {
          return {
            valid: false,
            error: 'Client Secret expired — create a new one in Entra.',
          };
        }
        if (errorDesc?.includes('AADSTS50011')) {
          return {
            valid: false,
            error:
              'Redirect URI mismatch — register the exact Redirect URL shown above in the app registration.',
          };
        }

        return { valid: false, error: `Authentication failed: ${errorDesc}` };
      }
    }

    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : 'Network error',
    };
  }
}

export const entraIdAdapter: SsoProviderAdapter = {
  providerId: 'entra-id',
  displayName: 'Microsoft Entra ID',
  capabilities,
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  getUserInfo,
  getGroups,
  getAppRoles,
  validateConfig,
};

export { parseIdTokenAuthContext };
