export type {
  SsoProviderCapabilities,
  SsoTokens,
  SsoUserInfo,
  SsoGroup,
  PlatformRole,
  RoleMappingRule,
  SsoAuthContext,
} from '../../lib/shared/schemas/sso_providers';

import type {
  SsoProviderCapabilities,
  SsoTokens,
  SsoUserInfo,
  SsoGroup,
  PlatformRole,
  RoleMappingRule,
} from '../../lib/shared/schemas/sso_providers';

export interface SsoProviderConfig {
  providerId: string;
  issuer: string;
  clientId: string;
  clientSecret: string;
  scopes: string[];
  /**
   * Operator-configured claim names (dot-paths into the userinfo response)
   * overriding the standard OIDC claims. Derived from
   * `providerFeatures.genericOidc`; ignored by provider-specific adapters.
   */
  claimMappings?: {
    email?: string;
    name?: string;
    groups?: string;
  };
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
  /** PKCE S256 challenge; set only for adapters with `supportsPkce`. */
  codeChallenge?: string;
}

export interface TokenExchangeParams {
  code: string;
  redirectUri: string;
  /** PKCE verifier matching the `codeChallenge` sent at authorize time. */
  codeVerifier?: string;
}

export interface SsoProviderAdapter {
  readonly providerId: string;
  readonly displayName: string;
  readonly capabilities: SsoProviderCapabilities;

  // May be async: a discovery-driven adapter (generic OIDC) resolves the
  // authorization endpoint from the issuer's well-known document. Callers
  // must `await` the result.
  buildAuthorizeUrl(
    config: SsoProviderConfig,
    params: AuthorizeUrlParams,
  ): URL | Promise<URL>;
  exchangeCodeForTokens(
    config: SsoProviderConfig,
    params: TokenExchangeParams,
  ): Promise<SsoTokens>;
  // `config` is passed so a discovery-driven adapter can resolve the userinfo
  // endpoint; provider-specific adapters (Entra) may ignore it.
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
