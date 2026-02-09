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
} from '../types';

import {
  MICROSOFT_LOGIN_BASE,
  MICROSOFT_GRAPH_BASE,
  ONEDRIVE_SCOPES,
  extractTenantId,
} from './constants';
import { mapEntraRoleToPlatformRole } from './role_mapping';

const capabilities: SsoProviderCapabilities = {
  supportsGroupSync: true,
  supportsRoleMapping: true,
  supportsOneDriveAccess: true,
  supportsGoogleDriveAccess: false,
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

  if (params.loginHint) {
    authUrl.searchParams.set('login_hint', params.loginHint);
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
  };
}

async function getUserInfo(accessToken: string): Promise<SsoUserInfo> {
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
    jobTitle: data.jobTitle,
  };
}

async function getGroups(accessToken: string): Promise<SsoGroup[]> {
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

async function getAppRoles(accessToken: string): Promise<string[]> {
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
          return { valid: false, error: 'Invalid Client ID' };
        }
        if (errorDesc?.includes('AADSTS7000215')) {
          return { valid: false, error: 'Invalid Client Secret' };
        }
        if (errorDesc?.includes('AADSTS700024')) {
          return { valid: false, error: 'Client Secret expired' };
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

export { ONEDRIVE_SCOPES };
