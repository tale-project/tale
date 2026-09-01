/**
 * Backend types for the unified Enterprise SSO module. Wire-shared shapes are
 * re-exported from `lib/shared/schemas/enterprise_sso`; the adapter contract
 * (OIDC/OAuth2 sign-in front-half) lives here. SAML uses its own metadata/ACS
 * path and converges with OIDC/OAuth2 at the provisioning layer.
 */

export type {
  PlatformRole,
  RoleMappingRule,
  RoleMappingSource,
  SsoProtocol,
  SsoProviderId,
  SsoUserInfo,
  SsoGroup,
  SsoTokens,
  SsoProviderCapabilities,
  SsoAuthContext,
  AttributeMapping,
} from '../../../lib/shared/schemas/enterprise_sso';

import type {
  PlatformRole,
  RoleMappingRule,
  SsoGroup,
  SsoProviderCapabilities,
  SsoTokens,
  SsoUserInfo,
} from '../../../lib/shared/schemas/enterprise_sso';

/** Resolved (decrypted) sign-in config handed to an OIDC/OAuth2 adapter. */
export interface SsoProviderConfig {
  providerId: string;
  issuer: string;
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  userinfoEndpoint?: string;
  clientId: string;
  clientSecret: string;
  scopes: string[];
  claimMappings?: { email?: string; name?: string; groups?: string };
}

export type SsoPromptMode = 'none' | 'login' | 'consent' | 'select_account';

export interface AuthorizeUrlParams {
  redirectUri: string;
  state: string;
  loginHint?: string;
  additionalScopes?: string[];
  prompt?: SsoPromptMode;
  domainHint?: string;
  claims?: string;
  codeChallenge?: string;
}

export interface TokenExchangeParams {
  code: string;
  redirectUri: string;
  codeVerifier?: string;
}

export interface SsoProviderAdapter {
  readonly providerId: string;
  readonly displayName: string;
  readonly capabilities: SsoProviderCapabilities;

  buildAuthorizeUrl(
    config: SsoProviderConfig,
    params: AuthorizeUrlParams,
  ): URL | Promise<URL>;
  exchangeCodeForTokens(
    config: SsoProviderConfig,
    params: TokenExchangeParams,
  ): Promise<SsoTokens>;
  getUserInfo(
    config: SsoProviderConfig,
    accessToken: string,
  ): Promise<SsoUserInfo>;

  getGroups?(
    config: SsoProviderConfig,
    accessToken: string,
  ): Promise<SsoGroup[]>;
  getAppRoles?(
    config: SsoProviderConfig,
    accessToken: string,
  ): Promise<string[]>;

  validateConfig(
    config: Omit<SsoProviderConfig, 'clientSecret'> & { clientSecret?: string },
  ): Promise<{ valid: boolean; error?: string }>;

  mapToRole?(
    rules: RoleMappingRule[],
    defaultRole: PlatformRole,
    userInfo: SsoUserInfo,
  ): PlatformRole;
}
