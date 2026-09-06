/**
 * `enterprise_sso` — the wire contract for the backend calls the app makes into this
 * family: one entry per function name, carrying its argument and response
 * shapes. Materialized from the shapes the app consumed at the Convex
 * retirement, so the hook wrappers stay fully typed with no generated
 * `_generated/api` behind them; the adapter rows in `../enterprise_sso.ts` are what
 * actually serve them.
 */

export interface EnterpriseSsoContract {
  'enterprise_sso/config/actions:disableSso': {
    kind: 'action';
    args: { organizationId: string };
    returns: null;
  };
  'enterprise_sso/config/actions:parseIdpMetadata': {
    kind: 'action';
    args: { url?: string; xml?: string; organizationId: string };
    returns: { idpEntityId: string; idpSsoUrl: string; idpCertificate: string };
  };
  'enterprise_sso/config/actions:remove': {
    kind: 'action';
    args: { organizationId: string };
    returns: null;
  };
  'enterprise_sso/config/actions:revealOidcClientId': {
    kind: 'action';
    args: { organizationId: string };
    returns: null | string;
  };
  'enterprise_sso/config/actions:setProvisioning': {
    kind: 'action';
    args: {
      organizationId: string;
      autoProvisionRole: boolean;
      defaultRole: 'member' | 'admin' | 'disabled' | 'editor' | 'developer';
      roleMappingRules: Array<{
        claim?: string;
        source: 'jobTitle' | 'appRole' | 'group' | 'claim';
        pattern: string;
        targetRole: 'member' | 'admin' | 'disabled' | 'editor' | 'developer';
      }>;
      autoProvisionTeam: boolean;
      excludeGroups: string[];
    };
    returns: null;
  };
  'enterprise_sso/config/actions:testConnection': {
    kind: 'action';
    args: {
      authorizationEndpoint?: string;
      tokenEndpoint?: string;
      userinfoEndpoint?: string;
      organizationId: string;
      scopes: string[];
      providerId: 'oauth2' | 'entra-id' | 'generic-oidc';
      clientId: string;
      /** The secret as typed; omitted, the backend probes with the stored one. */
      clientSecret?: string;
      issuer: string;
    };
    returns: { valid: boolean; error?: string };
  };
  'enterprise_sso/config/actions:upsertOidc': {
    kind: 'action';
    args: {
      pkce?: boolean;
      domain?: string;
      clientSecret?: string;
      authorizationEndpoint?: string;
      tokenEndpoint?: string;
      userinfoEndpoint?: string;
      domainHint?: string;
      claimMappings?: { name?: string; email?: string; groups?: string };
      enableOneDriveAccess?: boolean;
      organizationId: string;
      scopes: string[];
      displayName: string;
      providerId: 'oauth2' | 'entra-id' | 'generic-oidc';
      clientId: string;
      issuer: string;
      autoProvisionRole: boolean;
      defaultRole: 'member' | 'admin' | 'disabled' | 'editor' | 'developer';
      roleMappingRules: Array<{
        claim?: string;
        source: 'jobTitle' | 'appRole' | 'group' | 'claim';
        pattern: string;
        targetRole: 'member' | 'admin' | 'disabled' | 'editor' | 'developer';
      }>;
      autoProvisionTeam: boolean;
      excludeGroups: string[];
    };
    returns: null;
  };
  'enterprise_sso/config/actions:upsertSaml': {
    kind: 'action';
    args: {
      domain?: string;
      spCertificate?: string;
      wantAssertionsSigned?: boolean;
      wantAssertionsEncrypted?: boolean;
      attributeMappings?: { name?: string; email?: string; groups?: string };
      spPrivateKey?: string;
      organizationId: string;
      displayName: string;
      idpEntityId: string;
      idpSsoUrl: string;
      idpCertificate: string;
      autoProvisionRole: boolean;
      defaultRole: 'member' | 'admin' | 'disabled' | 'editor' | 'developer';
      roleMappingRules: Array<{
        claim?: string;
        source: 'jobTitle' | 'appRole' | 'group' | 'claim';
        pattern: string;
        targetRole: 'member' | 'admin' | 'disabled' | 'editor' | 'developer';
      }>;
      autoProvisionTeam: boolean;
      excludeGroups: string[];
    };
    returns: null;
  };
  'enterprise_sso/config/queries:get': {
    kind: 'query';
    args: { organizationId: string };
    returns: {
      configured: boolean;
      enabled: boolean;
      protocol: null | 'oauth2' | 'saml' | 'oidc';
      displayName: null | string;
      domain: null | string;
      oidc: null | {
        providerId: 'oauth2' | 'entra-id' | 'generic-oidc';
        issuer: string;
        scopes: string[];
        authorizationEndpoint?: string;
        tokenEndpoint?: string;
        userinfoEndpoint?: string;
        pkce?: boolean;
        domainHint?: string;
        claimMappings?: { email?: string; name?: string; groups?: string };
        enableOneDriveAccess?: boolean;
      };
      saml: null | {
        idpEntityId: string;
        idpSsoUrl: string;
        idpCertificate: string;
        hasSpKeypair: boolean;
        wantAssertionsSigned?: boolean;
        wantAssertionsEncrypted?: boolean;
        spCertificate?: string;
        attributeMappings?: { email?: string; name?: string; groups?: string };
      };
      provisioning: {
        autoProvisionRole: boolean;
        defaultRole: 'member' | 'admin' | 'disabled' | 'editor' | 'developer';
        roleMappingRules: Array<{
          source: 'jobTitle' | 'appRole' | 'group' | 'claim';
          pattern: string;
          targetRole: 'member' | 'admin' | 'disabled' | 'editor' | 'developer';
          claim?: string;
        }>;
        autoProvisionTeam: boolean;
        excludeGroups: string[];
      };
      scim: {
        enabled: boolean;
        tokenPrefix: null | string;
        tokenGeneratedAt: null | number;
        lastUsedAt: null | number;
        baseUrl: null | string;
      };
      samlSpMetadataUrl: null | string;
      samlAcsUrl: null | string;
      oidcCallbackUrl: null | string;
      /** The same endpoints on each additional site domain (empty when the
       * deployment serves one domain). */
      additionalCallbackUrls?: string[];
      additionalSamlAcsUrls?: string[];
      deployment?: {
        siteUrlSet: boolean;
        basePathSet: boolean;
        authSecretSet: boolean;
      };
      otherOrgsEnabled?: boolean;
    };
  };
}
