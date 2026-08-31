/**
 * `connector_credentials` — the wire contract for the backend calls the app makes into this
 * family: one entry per function name, carrying its argument and response
 * shapes. Materialized from the shapes the app consumed at the Convex
 * retirement, so the hook wrappers stay fully typed with no generated
 * `_generated/api` behind them; the adapter rows in `../connector_credentials.ts` are what
 * actually serve them.
 */

export interface ConnectorCredentialsContract {
  'connector_credentials/actions:createCredential': {
    kind: 'action';
    args: {
      config?: Record<string, string | number | boolean>;
      expiresAt?: number;
      endpointUrl?: string;
      isDefault?: boolean;
      scopes?: string[];
      token?: string;
      accessToken?: string;
      refreshToken?: string;
      password?: string;
      username?: string;
      smtpUsername?: string;
      smtpPassword?: string;
      organizationId: string;
      name: string;
      authMethod: 'oauth2' | 'api-key' | 'bearer' | 'basic';
      connectorSlug: string;
    };
    returns: { credentialId: string };
  };
  'connector_credentials/actions:updateCredential': {
    kind: 'action';
    args: {
      status?: 'active' | 'disabled';
      config?: Record<string, string | number | boolean>;
      name?: string;
      expiresAt?: number;
      endpointUrl?: string;
      isDefault?: boolean;
      scopes?: string[];
      token?: string;
      accessToken?: string;
      refreshToken?: string;
      password?: string;
      username?: string;
      smtpUsername?: string;
      smtpPassword?: string;
      organizationId: string;
      credentialId: string;
    };
    returns: null;
  };
  'connector_credentials/connector_catalog:listConnectors': {
    kind: 'action';
    args: { organizationId: string };
    returns: Array<{
      iconUrl?: string;
      description: string;
      slug: string;
      tags: string[];
      displayName: string;
      endpointMode: 'fixed' | 'per-credential';
      configFields: Array<{
        description?: string;
        default?: string | number | boolean;
        enum?: string[];
        required: boolean;
        type: 'string' | 'number' | 'boolean';
        key: string;
        label: string;
      }>;
      authMethods: Array<'oauth2' | 'api-key' | 'bearer' | 'basic'>;
      actionCount: number;
      /** OAuth2 connectors only: whether an app is available to consent
       * against, and where it comes from (org row beats deployment env). */
      oauthApp?: { configured: boolean; source: 'org' | 'env' | null };
    }>;
  };
  'connector_oauth_apps/queries:list': {
    kind: 'query';
    args: { organizationId: string };
    returns: Array<{
      slug: string;
      clientId: string;
      maskedPreview: string | null;
      tenantId: string | null;
      updatedAtMs: number;
    }>;
  };
  'connector_oauth_apps/actions:upsert': {
    kind: 'action';
    args: {
      organizationId: string;
      slug: string;
      clientId: string;
      clientSecret?: string;
      tenantId?: string;
    };
    returns: {
      slug: string;
      clientId: string;
      maskedPreview: string | null;
      tenantId: string | null;
      updatedAtMs: number;
    };
  };
  'connector_oauth_apps/mutations:remove': {
    kind: 'mutation';
    args: { organizationId: string; slug: string };
    returns: null;
  };
  /** Whether Enterprise SSO carries an Entra ID registration the Microsoft
   * 365 import app could reuse — client id / tenant / the Entra-side
   * checklist facts, never the secret. Admin-gated like the SSO reveal. */
  'connector_oauth_apps/queries:entraSsoSource': {
    kind: 'query';
    args: { organizationId: string };
    returns: {
      available: boolean;
      reason?: 'no_sso' | 'not_entra' | 'missing_credentials' | 'bad_issuer';
      clientId?: string;
      tenantId?: string;
      redirectUri?: string | null;
      scopes?: string[];
    };
  };
  /** Copy the Enterprise SSO Entra registration into the org's app for
   * `slug` (today: `onedrive` only) — the secret moves server-side only. */
  'connector_oauth_apps/actions:reuseSso': {
    kind: 'action';
    args: { organizationId: string; slug: string };
    returns: {
      slug: string;
      clientId: string;
      maskedPreview: string | null;
      tenantId: string | null;
      updatedAtMs: number;
    };
  };
  'connector_credentials/mutations:deleteCredential': {
    kind: 'mutation';
    args: { organizationId: string; credentialId: string };
    returns: null;
  };
  'connector_credentials/mutations:setDefaultCredential': {
    kind: 'mutation';
    args: { organizationId: string; credentialId: string };
    returns: null;
  };
  'connector_credentials/queries:listCredentials': {
    kind: 'query';
    args: { connectorSlug?: string; organizationId: string };
    returns: Array<{
      createdAt: number;
      updatedAt: number;
      statusDetail?: string;
      isDefault: boolean;
      status: 'active' | 'disabled' | 'needs-reauth';
      maskedPreview?: string;
      config?: Record<string, string | number | boolean>;
      endpointUrl?: string;
      id: string;
      connectorSlug: string;
      authMethod: 'oauth2' | 'api-key' | 'bearer' | 'basic';
      name: string;
    }>;
  };
}
