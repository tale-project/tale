'use node';

/**
 * The models ONE credential can serve on a provider — the single read every
 * serving lane and the composer's picker go through, so "what the picker
 * offers" and "what a turn resolves" are the same set by construction:
 *
 *  - a provider with a catalog (static, OpenRouter, models endpoint) serves
 *    its catalog — the caller applies the credential's allowlist as a FILTER,
 *    exactly as before;
 *  - a `catalog: none` provider (Azure deployment names, a subscription
 *    marketplace) has nothing to filter: the credential's allowlist IS its
 *    availability set, synthesized into neutral entries. Without this every
 *    lane gated on an empty catalog and such a provider — configured exactly
 *    as documented — could never serve anything.
 */

import { synthesizeAllowlistCatalog } from '../../../../lib/shared/providers/allowlist_catalog';
import type {
  ModelCatalogEntry,
  ProviderDefinition,
} from '../../../../lib/shared/schemas/providers';
import { getProviderCatalog, type CatalogFetchOptions } from './catalog_fetch';

export async function getServableCatalog(
  provider: ProviderDefinition,
  allowlist: readonly string[] | undefined,
  options: CatalogFetchOptions = {},
): Promise<readonly ModelCatalogEntry[]> {
  if (provider.catalog.source === 'none') {
    return synthesizeAllowlistCatalog(provider, allowlist);
  }
  return getProviderCatalog(provider, options);
}
