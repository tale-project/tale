/**
 * `provider_credentials` — the wire contract for the backend calls the app makes into this
 * family: one entry per function name, carrying its argument and response
 * shapes. Materialized from the shapes the app consumed at the Convex
 * retirement, so the hook wrappers stay fully typed with no generated
 * `_generated/api` behind them; the adapter rows in `../provider_credentials.ts` are what
 * actually serve them.
 */

import type { ProviderDefinition } from '@tale/shared/schemas/providers';

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
  /**
   * The edit dialog's Save for a credential of an organization-defined
   * provider: the credential's fields and the provider's definition, as one
   * write — each part against the hash the dialog read it at, and a refusal
   * of either writing neither.
   */
  'provider_credentials/actions:updateCredentialWithDefinition': {
    kind: 'action';
    args: {
      name?: string;
      endpointUrl?: string;
      modelAllowlist?: null | string[];
      organizationId: string;
      credentialId: string;
      /** The credential's `hash` when the dialog read it. */
      expectedHash: string;
      /** The provider's definition as the dialog now builds it, and the
       * hash of the version its facts were read from. */
      definition: { config: ProviderDefinition; expectedHash: string };
    };
    returns: null;
  };
  'provider_credentials/mutations:deleteCredential': {
    kind: 'mutation';
    args: {
      organizationId: string;
      credentialId: string;
      /** Retire the organization-defined provider too when this was its
       * last credential. */
      retireUnusedCustomProvider?: boolean;
    };
    returns: null;
  };
  'provider_credentials/mutations:setDefaultCredential': {
    kind: 'mutation';
    args: { organizationId: string; credentialId: string };
    returns: null;
  };
  'provider_credentials/queries:getCredentialDependents': {
    kind: 'query';
    args: { organizationId: string; credentialId: string };
    /** What resolves its key through the credential (`embedding`). */
    returns: { usedBy: string[] };
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
      /** The row's native version: an edit that names it is refused once
       * the row has changed since. */
      hash: string;
    }>;
  };
}
