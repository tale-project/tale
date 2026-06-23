import { entraIdAdapter } from './entra_id/adapter';
import { genericOidcAdapter } from './generic_oidc/adapter';
import { oauth2Adapter } from './oauth2/adapter';
import type { SsoProviderAdapter } from './types';

const adapters: Record<string, SsoProviderAdapter> = {
  'entra-id': entraIdAdapter,
  'generic-oidc': genericOidcAdapter,
  oauth2: oauth2Adapter,
};

export function getAdapter(providerId: string): SsoProviderAdapter | null {
  return adapters[providerId] ?? null;
}

export function getSupportedProviders(): Array<{ id: string; name: string }> {
  return Object.values(adapters).map((adapter) => ({
    id: adapter.providerId,
    name: adapter.displayName,
  }));
}
