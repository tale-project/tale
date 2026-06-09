/**
 * Resolved routing metadata for a model.
 *
 * The single accessor complexity-based model routing and the speculative
 * cascade (`./model_routing/`) call to learn a model's strength tier, quality
 * ordering, and domain preferences. These come straight from the operator's
 * provider JSON (or the OpenRouter catalog cache layered under it by
 * `providers/file_actions.ts`); there is no longer a built-in family registry.
 *
 * Pure and synchronous — no IO. Cost is intentionally NOT resolved here; it
 * comes from the provider catalog (`ResolvedModelData.*CentsPerMillion`) and
 * routing infers a tier from it when neither operator config declares one.
 * Vision capability is read from the model's `'vision'` tag at the call site,
 * not threaded through here.
 */

import type { Domain } from '../../../lib/shared/constants/domains';
import type { ModelTier } from '../../../lib/shared/schemas/providers';

/** Operator-declared fields (from provider JSON / `ResolvedModelData`). */
export interface ModelMetadataInput {
  tier?: ModelTier;
  qualityScore?: number;
  routingTags?: Domain[];
}

export interface ResolvedModelMetadata {
  /** Strength class, if the operator declares one (else undefined ⇒ routing
   *  infers from cost). */
  tier?: ModelTier;
  qualityScore?: number;
  routingTags: Domain[];
}

export function resolveModelMetadata(
  input: ModelMetadataInput,
): ResolvedModelMetadata {
  return {
    tier: input.tier,
    qualityScore: input.qualityScore,
    routingTags: input.routingTags ?? [],
  };
}
