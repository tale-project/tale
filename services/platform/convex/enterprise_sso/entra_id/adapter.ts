import type {
  SsoProviderAdapter,
  SsoProviderConfig,
  AuthorizeUrlParams,
  TokenExchangeParams,
  SsoTokens,
  SsoUserInfo,
  SsoGroup,
  SsoProviderCapabilities,
  PlatformRole,
  RoleMappingRule,
  SsoAuthContext,
} from '../types';
import {
  MICROSOFT_LOGIN_BASE,
  MICROSOFT_GRAPH_BASE,
  EntraIssuerError,
  extractTenantId,
} from './constants';
import { mapEntraRoleToPlatformRole } from './role_mapping';

const capabilities: SsoProviderCapabilities = {
  supportsGroupSync: true,
  supportsRoleMapping: true,
  // File import is Knowledge cloud-import OAuth, not SSO.
  supportsOneDriveAccess: false,
  supportsGoogleDriveAccess: false,
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

async function getGroups(
  _config: SsoProviderConfig,
  accessToken: string,
): Promise<SsoGroup[]> {
  const response = await fetch(
    `${MICROSOFT_GRAPH_BASE}/me/memberOf?$select=id,displayName`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );

  if (!response.ok) {
    throw new Error(`Graph API error: ${response.status}`);
  }

  const data = await response.json();
  return (data.value || [])
    .filter(
      (member: { '@odata.type'?: string }) =>
        member['@odata.type'] === '#microsoft.graph.group',
    )
    .map((group: { id: string; displayName: string }) => ({
      id: group.id,
      name: group.displayName,
    }));
}

async function getAppRoles(
  _config: SsoProviderConfig,
  accessToken: string,
): Promise<string[]> {
  const response = await fetch(
    `${MICROSOFT_GRAPH_BASE}/me/appRoleAssignments?$select=appRoleId`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );

  if (!response.ok) {
    console.error(
      '[Entra ID] Failed to fetch app roles:',
      response.status,
      await response.text(),
    );
    return [];
  }

  const data = await response.json();
  return (data.value || [])
    .map((r: { appRoleId?: string }) => r.appRoleId || '')
    .filter(Boolean);
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
    const discoveryResponse = await fetch(discoveryUrl);
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

function mapToRole(
  rules: RoleMappingRule[],
  defaultRole: PlatformRole,
  userInfo: SsoUserInfo,
): PlatformRole {
  return mapEntraRoleToPlatformRole(rules, defaultRole, userInfo);
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
  mapToRole,
};

export { parseIdTokenAuthContext };
