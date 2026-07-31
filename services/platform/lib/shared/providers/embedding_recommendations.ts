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

import type { ModelCatalogEntry } from '../schemas/providers';

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
