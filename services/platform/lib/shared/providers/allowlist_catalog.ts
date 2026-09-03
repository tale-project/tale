/**
 * The availability set of a provider that ships NO catalog (`catalog.source:
 * none` — Azure deployment names, a subscription-routed marketplace like
 * Nous Portal): the credential's model allowlist IS the set, exactly as the
 * provider files and the docs state ("the allowlist stops being a filter and
 * becomes the availability set"). Each allowlisted id becomes one catalog
 * entry carrying NEUTRAL capability facts — nothing here knows what an Azure
 * deployment can do, and no fact is invented that a lane would then rely on:
 *
 *  - `chat`-tagged, tools assumed available (a deployment that refuses tools
 *    fails loudly on the wire, never silently);
 *  - `supportsVision: false` — unknown must read as "cannot", so the agent
 *    lanes arm their vision polyfill and the chat lane surfaces images as
 *    text instead of sending bytes a deployment may reject;
 *  - no `pricing` — an unknown price books as 0 (an honest under-count) rather
 *    than a fabricated rate;
 *  - `contextWindow` is an ASSUMED floor: the chat lane sizes the reply
 *    ceiling and the history slice from it, so it has to be a number every
 *    modern deployment clears rather than a per-model truth Tale cannot know.
 *
 * Pure — shared by the composer walk, the serving walks, and the title lane
 * through `getServableCatalog`, so the synthesized set can never differ
 * between what the picker offers and what a turn resolves.
 */

import type {
  ModelCatalogEntry,
  ProviderDefinition,
} from '../schemas/providers';

/** The context window assumed for a deployment Tale cannot describe. */
export const ALLOWLIST_CATALOG_CONTEXT_WINDOW = 128_000;

/** One allowlisted id as a neutral catalog entry. */
export function allowlistCatalogEntry(
  id: string,
  provider: string,
): ModelCatalogEntry {
  return {
    id,
    provider,
    tags: ['chat'],
    supportsTools: true,
    supportsVision: false,
    contextWindow: ALLOWLIST_CATALOG_CONTEXT_WINDOW,
  };
}

/**
 * The synthesized catalog for a `catalog: none` provider: the allowlist's ids
 * (trimmed, de-duplicated, blanks dropped — the field is free text an
 * operator types) in allowlist order. An absent or empty allowlist is an
 * EMPTY set — such a credential makes no model available, which is what the
 * docs tell the operator and what the wire would confirm.
 */
export function synthesizeAllowlistCatalog(
  provider: Pick<ProviderDefinition, 'name'>,
  allowlist: readonly string[] | undefined,
): ModelCatalogEntry[] {
  if (allowlist === undefined) return [];
  const seen = new Set<string>();
  const entries: ModelCatalogEntry[] = [];
  for (const raw of allowlist) {
    const id = raw.trim();
    if (id === '' || seen.has(id)) continue;
    seen.add(id);
    entries.push(allowlistCatalogEntry(id, provider.name));
  }
  return entries;
}
