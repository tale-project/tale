import type { ModelInfoCapabilities } from '@/app/features/shared/models/model-info-popover';

/**
 * Stand-ins for the provider/model catalog reads the model-policy editors
 * used to get from the AI-provider settings feature. That backend (provider
 * configs + model catalog) is offline while it is rebuilt; the governance
 * policies themselves (default-model rules, model access) still live in org
 * config and keep rendering. Until the catalog returns, the pickers offer no
 * provider/model options and capability metadata is absent — saved values
 * still display verbatim.
 */

/**
 * Loose provider record matching what the retired catalog action returned
 * (`v.any()` on the wire) — the editors narrow every field themselves.
 */
export interface CatalogProviderRecord {
  name: string;
  displayName?: string;
  models?: unknown;
  [key: string]: unknown;
}

const EMPTY_PROVIDERS: CatalogProviderRecord[] = [];
const EMPTY_CAPABILITIES = new Map<string, ModelInfoCapabilities>();

export function useListProviders(_organizationId: string): {
  providers: CatalogProviderRecord[];
  isLoading: boolean;
} {
  return { providers: EMPTY_PROVIDERS, isLoading: false };
}

export function useModelCapabilities(
  _organizationId: string,
  _modelIds: string[],
): Map<string, ModelInfoCapabilities> {
  return EMPTY_CAPABILITIES;
}
