import type { SsoProviderAdapter } from './types';

import { entraIdAdapter } from './entra_id/adapter';

const adapters: Record<string, SsoProviderAdapter> = {
  'entra-id': entraIdAdapter,
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
