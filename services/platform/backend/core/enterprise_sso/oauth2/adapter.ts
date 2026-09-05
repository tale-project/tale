/**
 * Plain OAuth2 adapter (no OIDC discovery): endpoints are configured
 * explicitly. Userinfo claims map through the same dot-path `claimMappings` as
 * generic OIDC. Used for providers that expose OAuth2 + a userinfo endpoint but
 * not a `.well-known` discovery document.
 */

import { isRecord } from '../../../../lib/utils/type-utils';
import {
  claimValueToStrings,
  requireEmailClaim,
  resolveClaimPath,
} from '../claims';
import { OIDC_FETCH_TIMEOUT_MS } from '../oidc_discovery';
import type {
  AuthorizeUrlParams,
  SsoGroup,
  SsoProviderAdapter,
  SsoProviderCapabilities,
  SsoProviderConfig,
  SsoTokens,
  SsoUserInfo,
  TokenExchangeParams,
} from '../types';

const capabilities: SsoProviderCapabilities = {
  supportsPkce: true,
};

function requireEndpoint(value: string | undefined, label: string): string {
  if (!value) {
    throw new Error(`OAuth2 ${label} endpoint is not configured`);
  }
  return value;
}

function buildAuthorizeUrl(
  config: SsoProviderConfig,
  params: AuthorizeUrlParams,
): URL {
  const authUrl = new URL(
    requireEndpoint(config.authorizationEndpoint, 'authorization'),
  );
  const scopes = [...config.scopes];
  for (const scope of params.additionalScopes ?? []) {
    if (!scopes.includes(scope)) scopes.push(scope);
  }
  authUrl.searchParams.set('client_id', config.clientId);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('redirect_uri', params.redirectUri);
  authUrl.searchParams.set('scope', scopes.join(' '));
  authUrl.searchParams.set('state', params.state);
  if (params.loginHint)
    authUrl.searchParams.set('login_hint', params.loginHint);
  if (params.codeChallenge) {
    authUrl.searchParams.set('code_challenge', params.codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
  }
  return authUrl;
}

async function exchangeCodeForTokens(
  config: SsoProviderConfig,
  params: TokenExchangeParams,
): Promise<SsoTokens> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: params.redirectUri,
    client_id: config.clientId,
    client_secret: config.clientSecret,
  });
  if (params.codeVerifier) body.set('code_verifier', params.codeVerifier);

  const response = await fetch(requireEndpoint(config.tokenEndpoint, 'token'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(OIDC_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Token exchange failed: ${await response.text()}`);
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

function mappedClaimString(data: unknown, path: string): string | undefined {
  const [first] = claimValueToStrings(resolveClaimPath(data, path));
  return first;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}

async function getUserInfo(
  config: SsoProviderConfig,
  accessToken: string,
): Promise<SsoUserInfo> {
  const response = await fetch(
    requireEndpoint(config.userinfoEndpoint, 'userinfo'),
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(OIDC_FETCH_TIMEOUT_MS),
    },
  );
  if (!response.ok) {
    throw new Error(`Failed to get user info: ${response.status}`);
  }
  const data = await response.json();
  const mappings = config.claimMappings;

  const name =
    (mappings?.name ? mappedClaimString(data, mappings.name) : undefined) ??
    (typeof data.name === 'string' ? data.name : '') ??
    '';
  const email = requireEmailClaim(
    (mappings?.email ? mappedClaimString(data, mappings.email) : undefined) ??
      data.email ??
      data.preferred_username,
    'OAuth2 userinfo',
  );
  const groups = mappings?.groups
    ? claimValueToStrings(resolveClaimPath(data, mappings.groups))
    : toStringArray(data.groups);

  const subValue: unknown = data.sub ?? data.id;
  const externalId =
    typeof subValue === 'string'
      ? subValue
      : typeof subValue === 'number'
        ? String(subValue)
        : '';
  if (!externalId) {
    throw new Error('OAuth2 userinfo response is missing a stable id (sub/id)');
  }
  return {
    externalId,
    email,
    name,
    groups,
    rawClaims: isRecord(data) ? data : undefined,
  };
}

async function getGroups(
  config: SsoProviderConfig,
  accessToken: string,
): Promise<SsoGroup[]> {
  const userInfo = await getUserInfo(config, accessToken);
  return (userInfo.groups ?? []).map((g) => ({ id: g, name: g }));
}

async function validateConfig(
  config: Omit<SsoProviderConfig, 'clientSecret'> & { clientSecret?: string },
): Promise<{ valid: boolean; error?: string }> {
  if (
    !config.authorizationEndpoint ||
    !config.tokenEndpoint ||
    !config.userinfoEndpoint
  ) {
    return {
      valid: false,
      error:
        'OAuth2 requires authorization, token, and userinfo endpoints to be set.',
    };
  }
  return { valid: true };
}

export const oauth2Adapter: SsoProviderAdapter = {
  providerId: 'oauth2',
  displayName: 'OAuth2',
  capabilities,
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  getUserInfo,
  getGroups,
  validateConfig,
};
