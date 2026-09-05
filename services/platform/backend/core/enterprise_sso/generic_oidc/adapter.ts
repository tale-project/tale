import { isRecord } from '../../../../lib/utils/type-utils';
import {
  claimValueToStrings,
  requireEmailClaim,
  resolveClaimPath,
} from '../claims';
import { discoverOidc, OIDC_FETCH_TIMEOUT_MS } from '../oidc_discovery';
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

async function buildAuthorizeUrl(
  config: SsoProviderConfig,
  params: AuthorizeUrlParams,
): Promise<URL> {
  const { authorizationEndpoint } = await discoverOidc(config.issuer);
  const authUrl = new URL(authorizationEndpoint);

  const scopes = [...config.scopes];
  // Standard OIDC needs the `openid` scope; add it if the operator omitted it.
  if (!scopes.includes('openid')) scopes.unshift('openid');
  for (const scope of params.additionalScopes ?? []) {
    if (!scopes.includes(scope)) scopes.push(scope);
  }

  authUrl.searchParams.set('client_id', config.clientId);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('redirect_uri', params.redirectUri);
  authUrl.searchParams.set('scope', scopes.join(' '));
  authUrl.searchParams.set('state', params.state);
  if (params.prompt) authUrl.searchParams.set('prompt', params.prompt);
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
  const { tokenEndpoint } = await discoverOidc(config.issuer);

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: params.redirectUri,
    client_id: config.clientId,
    client_secret: config.clientSecret,
  });
  if (params.codeVerifier) {
    body.set('code_verifier', params.codeVerifier);
  }

  const response = await fetch(tokenEndpoint, {
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

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}

function mappedClaimString(data: unknown, path: string): string | undefined {
  const [first] = claimValueToStrings(resolveClaimPath(data, path));
  return first;
}

/**
 * Fetch the standard OIDC userinfo claims and map them to our shape. The
 * `groups` claim (when the IdP is configured to emit it) is carried on
 * `groups` so group-based role mapping works at login. Operator-configured
 * `claimMappings` (dot-paths) take precedence over the standard claims, and
 * the full userinfo payload rides on `rawClaims` for claim-based role rules.
 */
async function getUserInfo(
  config: SsoProviderConfig,
  accessToken: string,
): Promise<SsoUserInfo> {
  const { userinfoEndpoint } = await discoverOidc(config.issuer);
  if (!userinfoEndpoint) {
    throw new Error(
      'This OIDC provider does not advertise a userinfo_endpoint, which Tale requires to resolve the signed-in user',
    );
  }

  const response = await fetch(userinfoEndpoint, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(OIDC_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Failed to get user info: ${response.status}`);
  }

  const data = await response.json();
  const mappings = config.claimMappings;

  const mappedName = mappings?.name
    ? mappedClaimString(data, mappings.name)
    : undefined;
  const name =
    mappedName ??
    (typeof data.name === 'string' && data.name
      ? data.name
      : [data.given_name, data.family_name].filter(Boolean).join(' ') ||
        (typeof data.preferred_username === 'string'
          ? data.preferred_username
          : ''));

  const mappedEmail = mappings?.email
    ? mappedClaimString(data, mappings.email)
    : undefined;
  const email = requireEmailClaim(
    mappedEmail ?? data.email ?? data.preferred_username,
    'OIDC userinfo',
  );

  const groups = mappings?.groups
    ? claimValueToStrings(resolveClaimPath(data, mappings.groups))
    : toStringArray(data.groups);

  // `sub` is the stable subject identifier and the only claim guaranteed by
  // the spec. A missing one would otherwise become the string "undefined" and
  // collide every such user onto one account — fail fast instead.
  const subValue: unknown = data.sub;
  const externalId =
    typeof subValue === 'string'
      ? subValue
      : typeof subValue === 'number'
        ? String(subValue)
        : '';
  if (!externalId) {
    throw new Error(
      'OIDC userinfo response is missing the required "sub" claim',
    );
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
  try {
    const endpoints = await discoverOidc(config.issuer);
    if (!endpoints.userinfoEndpoint) {
      return {
        valid: false,
        error:
          'The issuer is reachable but advertises no userinfo_endpoint, which Tale requires.',
      };
    }
    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : 'OIDC discovery failed',
    };
  }
}

export const genericOidcAdapter: SsoProviderAdapter = {
  providerId: 'generic-oidc',
  displayName: 'Generic OIDC',
  capabilities,
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  getUserInfo,
  getGroups,
  validateConfig,
};
