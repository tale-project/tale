/**
 * `provider_credentials` — the wire contract for the backend calls the app makes into this
 * family: one entry per function name, carrying its argument and response
 * shapes. Materialized from the shapes the app consumed at the Convex
 * retirement, so the hook wrappers stay fully typed with no generated
 * `_generated/api` behind them; the adapter rows in `../provider_credentials.ts` are what
 * actually serve them.
 */

export interface ProviderCredentialsContract {
  'provider_credentials/actions:createCredential': {
    kind: 'action';
    args: {
      endpointUrl?: string;
      envName?: string;
      modelAllowlist?: string[];
      secret?: string;
      broker?: unknown;
      organizationId: string;
      name: string;
      providerSlug: string;
      authMethod:
        | 'api-key'
        | 'env'
        | 'subscription-key'
        | 'subscription-broker';
    };
    returns: { credentialId: string };
  };
  'provider_credentials/actions:updateCredential': {
    kind: 'action';
    args: {
      status?: 'active' | 'disabled';
      name?: string;
      endpointUrl?: string;
      isDefault?: boolean;
      envName?: string;
      modelAllowlist?: null | string[];
      secret?: string;
      broker?: unknown;
      organizationId: string;
      credentialId: string;
    };
    returns: null;
  };
  'provider_credentials/mutations:deleteCredential': {
    kind: 'mutation';
    args: { organizationId: string; credentialId: string };
    returns: null;
  };
  'provider_credentials/mutations:setDefaultCredential': {
    kind: 'mutation';
    args: { organizationId: string; credentialId: string };
    returns: null;
  };
  'provider_credentials/queries:listCredentials': {
    kind: 'query';
    args: { organizationId: string };
    returns: Array<{
      isDefault: boolean;
      status: 'active' | 'disabled';
      createdAt: number;
      updatedAt: number;
      modelAllowlist?: string[];
      maskedPreview?: string;
      endpointUrl?: string;
      envName?: string;
      id: string;
      providerSlug: string;
      authMethod:
        | 'api-key'
        | 'env'
        | 'subscription-key'
        | 'subscription-broker';
      name: string;
    }>;
  };
}
