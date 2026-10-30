/**
 * The availability set of a provider that ships NO catalog (`catalog.source:
 * none` — Azure deployment names, a subscription-routed marketplace like
 * Nous Portal, an organization's own gateway): the credential's model
 * allowlist IS the set, exactly as the provider files and the docs state
 * ("the allowlist stops being a filter and becomes the availability set").
 * Each allowlisted id becomes one catalog entry carrying the facts the
 * provider DECLARES for it (`catalog.models`, written by the organization
 * that runs the endpoint), and NEUTRAL facts for whatever it leaves out —
 * nothing here knows what an Azure deployment can do, and no fact is
 * invented that a lane would then rely on:
 *
 *  - `chat`-tagged, tools assumed available (a deployment that refuses tools
 *    fails loudly on the wire, never silently);
 *  - `supportsVision: false` unless declared — unknown must read as
 *    "cannot", so the agent lanes arm their vision polyfill and the chat
 *    lane surfaces images as text instead of sending bytes a deployment may
 *    reject; a declared `true` also tags the entry `vision`, as a listing's
 *    image input does;
 *  - no `pricing` — an unknown price books as 0 (an honest under-count) rather
 *    than a fabricated rate;
 *  - `contextWindow` is the declared window, else an ASSUMED floor: the chat
 *    lane sizes the reply ceiling and the history slice from it, and a
 *    managed Claude Code session compacts inside it, so the floor has to be a
 *    number every modern deployment clears rather than a per-model truth
 *    Tale cannot know.
 *
 * A declaration only describes: an id no allowlist names stays unavailable.
 *
 * Pure — shared by the composer walk, the serving walks, and the title lane
 * through `getServableCatalog`, so the synthesized set can never differ
 * between what the picker offers and what a turn resolves.
 */

import type {
  DeclaredModel,
  ModelCatalogEntry,
  ProviderDefinition,
} from '@tale/shared/schemas/providers';

/** The context window assumed for a deployment Tale cannot describe. */
export const ALLOWLIST_CATALOG_CONTEXT_WINDOW = 128_000;

/** One allowlisted id as a catalog entry: what the provider declares for
 * it, neutral facts for the rest. */
function allowlistCatalogEntry(
  id: string,
  provider: string,
  declared: DeclaredModel | undefined,
): ModelCatalogEntry {
  const supportsVision = declared?.supportsVision ?? false;
  return {
    id,
    provider,
    tags: supportsVision ? ['chat', 'vision'] : ['chat'],
    supportsTools: true,
    supportsVision,
    contextWindow: declared?.contextWindow ?? ALLOWLIST_CATALOG_CONTEXT_WINDOW,
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
  provider: Pick<ProviderDefinition, 'name' | 'catalog'>,
  allowlist: readonly string[] | undefined,
): ModelCatalogEntry[] {
  if (allowlist === undefined) return [];
  const declared = new Map(
    (provider.catalog.source === 'none'
      ? (provider.catalog.models ?? [])
      : []
    ).map((model) => [model.id, model]),
  );
  const seen = new Set<string>();
  const entries: ModelCatalogEntry[] = [];
  for (const raw of allowlist) {
    const id = raw.trim();
    if (id === '' || seen.has(id)) continue;
    seen.add(id);
    entries.push(allowlistCatalogEntry(id, provider.name, declared.get(id)));
  }
  return entries;
}
