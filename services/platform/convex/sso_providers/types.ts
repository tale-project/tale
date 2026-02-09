export type {
  SsoProviderCapabilities,
  SsoTokens,
  SsoUserInfo,
  SsoGroup,
  PlatformRole,
  RoleMappingRule,
} from '@/lib/shared/schemas/sso_providers';

import type {
  SsoProviderCapabilities,
  SsoTokens,
  SsoUserInfo,
  SsoGroup,
  PlatformRole,
  RoleMappingRule,
} from '@/lib/shared/schemas/sso_providers';

export interface SsoProviderConfig {
  providerId: string;
  issuer: string;
  clientId: string;
  clientSecret: string;
  scopes: string[];
}

export interface AuthorizeUrlParams {
  redirectUri: string;
  state: string;
  loginHint?: string;
  additionalScopes?: string[];
}

export interface TokenExchangeParams {
  code: string;
  redirectUri: string;
}

export interface SsoProviderAdapter {
  readonly providerId: string;
  readonly displayName: string;
  readonly capabilities: SsoProviderCapabilities;

  buildAuthorizeUrl(config: SsoProviderConfig, params: AuthorizeUrlParams): URL;
  exchangeCodeForTokens(
    config: SsoProviderConfig,
    params: TokenExchangeParams,
  ): Promise<SsoTokens>;
  getUserInfo(accessToken: string): Promise<SsoUserInfo>;

  getGroups?(accessToken: string): Promise<SsoGroup[]>;
  getAppRoles?(accessToken: string): Promise<string[]>;

  validateConfig(
    config: Omit<SsoProviderConfig, 'clientSecret'> & { clientSecret?: string },
  ): Promise<{ valid: boolean; error?: string }>;

  mapToRole?(
    rules: RoleMappingRule[],
    defaultRole: PlatformRole,
    userInfo: SsoUserInfo,
  ): PlatformRole;
}
