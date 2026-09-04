/**
 * Which embedding models an organization could adopt, derived from the
 * catalogs its credentials already unlock.
 *
 * Only entries that carry BOTH the `embedding` tag and the curated
 * `embedding` facts qualify: the dimensions are the one parameter an
 * operator cannot safely guess (a wrong width poisons a corpus invisibly),
 * so a listing without them is a model we can name but not recommend. The
 * facts live in the shipped static catalogs — live listings publish no
 * vector width.
 *
 * Pure data mapping; the caller resolves the catalogs.
 */

import type {
  ModelCatalogEntry,
  ProviderEmbeddingSupport,
} from '../schemas/providers';

export interface EmbeddingRecommendation {
  readonly providerSlug: string;
  readonly model: string;
  readonly dimensions: number;
  /** Curated as the first pick for its provider. */
  readonly recommended: boolean;
}

export function pickEmbeddingRecommendations(
  catalogs: ReadonlyArray<{
    readonly providerSlug: string;
    readonly entries: readonly ModelCatalogEntry[];
  }>,
): EmbeddingRecommendation[] {
  const seen = new Set<string>();
  const recommendations: EmbeddingRecommendation[] = [];
  for (const catalog of catalogs) {
    for (const entry of catalog.entries) {
      if (!entry.tags.includes('embedding')) continue;
      if (entry.embedding === undefined) continue;
      const key = `${catalog.providerSlug} ${entry.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      recommendations.push({
        providerSlug: catalog.providerSlug,
        model: entry.id,
        dimensions: entry.embedding.dimensions,
        recommended: entry.embedding.recommended === true,
      });
    }
  }
  // Curated picks first; then a stable, readable order.
  return recommendations.sort(
    (a, b) =>
      Number(b.recommended) - Number(a.recommended) ||
      a.providerSlug.localeCompare(b.providerSlug) ||
      a.model.localeCompare(b.model),
  );
}

/**
 * What the form should say when a provider offers no recommendation.
 *
 * "No recommendation" used to mean two different things with one empty
 * state: a provider that cannot embed at all, and one that can but ships no
 * curated vector width here (every live catalog, since listings publish no
 * width and a guessed one poisons a corpus invisibly). An operator could not
 * tell which, and the fields stayed free either way — so choosing a
 * chat-only provider failed later, at index time, as a runtime error.
 *
 * The provider connector now declares it, so the two are separable:
 *  - `unsupported` → say so, and refuse the choice at the point of choosing.
 *  - `unknown`     → invite the model and dimensions by hand.
 *  - `supported`   → recommend.
 */
export interface ProviderEmbeddingOption {
  readonly providerSlug: string;
  readonly support: ProviderEmbeddingSupport;
  /** Recommendations for this provider; empty unless `supported`. */
  readonly recommendations: readonly EmbeddingRecommendation[];
}

/**
 * Group the recommendations by provider and pair each with its declared
 * support, so a caller never has to read "no entries" as an answer.
 *
 * A provider declaring `supported` with no curated entry is reported as
 * `unknown`: the declaration says it can embed, but this deployment still has
 * no width to offer, and that is the state the operator has to act on.
 */
export function providerEmbeddingOptions(
  providers: ReadonlyArray<{
    readonly slug: string;
    readonly embedding?: ProviderEmbeddingSupport;
  }>,
  recommendations: readonly EmbeddingRecommendation[],
): ProviderEmbeddingOption[] {
  return providers
    .map((provider) => {
      const own = recommendations.filter(
        (entry) => entry.providerSlug === provider.slug,
      );
      const declared = provider.embedding ?? 'unknown';
      const support =
        declared === 'supported' && own.length === 0 ? 'unknown' : declared;
      return {
        providerSlug: provider.slug,
        support,
        recommendations: support === 'supported' ? own : [],
      };
    })
    .sort((a, b) => a.providerSlug.localeCompare(b.providerSlug));
}
