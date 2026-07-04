/**
 * Action-side glue for complexity-based model routing.
 *
 * Fetches the org's lightweight model catalog, builds `ModelCandidate`s for an
 * agent's `supportedModels` (operator metadata layered over the built-in
 * registry), scores the turn, and returns the agent's model refs REORDERED so
 * the tier-appropriate model is primary. The existing fallback loop in
 * `internal_actions.ts` then tries them in that order, so a bad pick still
 * fails over to the rest — this only changes which model is tried FIRST.
 *
 * Fails safe: any error (no catalog, unknown refs) returns the original order.
 */

import { parseModelRef } from '../../../../lib/shared/utils/model-ref';
import { internal } from '../../../_generated/api';
import type { ActionCtx } from '../../../_generated/server';
import { resolveModelMetadata } from '../model_metadata';
import { scoreDifficulty } from '../reasoning/signals';
import { classFromIntensity } from '../reasoning/types';
import { detectDomain } from './domain';
import { selectModelTier } from './select_model';
import type { ModelCandidate, ModelTier } from './types';

interface CatalogEntry {
  id: string;
  tags: string[];
  outputCentsPerMillion?: number;
  tier?: ModelTier;
  qualityScore?: number;
  routingTags?: string[];
}

/**
 * Build `ModelCandidate`s for a set of model refs from the org's lightweight
 * catalog (operator metadata layered over the built-in registry). Returns an
 * empty array when the catalog is empty — callers fail safe to config order.
 * Shared by the per-turn reorder below and the spawn-time job tier pick.
 */
export async function buildModelCandidates(
  ctx: ActionCtx,
  organizationId: string,
  refs: string[],
): Promise<ModelCandidate[]> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- action returns the declared shape
  const catalog = (await ctx.runAction(
    internal.providers.file_actions.getModelRoutingCatalog,
    { organizationId },
  )) as CatalogEntry[];
  if (catalog.length === 0) return [];

  const byId = new Map(catalog.map((c) => [c.id, c]));
  return refs.map((ref) => {
    const { modelId } = parseModelRef(ref);
    const entry = byId.get(modelId);
    const meta = resolveModelMetadata({
      tier: entry?.tier,
      qualityScore: entry?.qualityScore,
      // routingTags from the catalog are validated as the domain enum at
      // config-load time; the metadata resolver re-types them.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- enum-validated upstream
      routingTags: entry?.routingTags as ModelCandidate['routingTags'],
    });
    return {
      ref,
      tier: meta.tier,
      qualityScore: meta.qualityScore,
      routingTags: meta.routingTags,
      outputCentsPerMillion: entry?.outputCentsPerMillion,
      // Vision capability comes straight from the `'vision'` tag — there is
      // no separate `supportsVision` field on the config any more.
      supportsVision: entry?.tags.includes('vision') ?? false,
    };
  });
}

/**
 * Reorder `supportedModels` so the model best suited to this turn is first.
 * Returns the input unchanged when routing can't improve (≤1 model, no catalog,
 * or an error).
 */
export async function routeModelOrder(
  ctx: ActionCtx,
  opts: {
    organizationId: string;
    supportedModels: string[];
    promptText: string;
    requiresVision?: boolean;
  },
): Promise<string[]> {
  const refs = opts.supportedModels;
  if (refs.length <= 1) return refs;

  try {
    const candidates = await buildModelCandidates(
      ctx,
      opts.organizationId,
      refs,
    );
    if (candidates.length === 0) return refs;

    const difficulty = scoreDifficulty({
      kind: 'chat',
      promptText: opts.promptText,
    });
    const difficultyClass = classFromIntensity(difficulty.intensity);
    const { domain } = detectDomain(opts.promptText);

    const selection = selectModelTier({
      candidates,
      difficultyClass,
      domain,
      requiresVision: opts.requiresVision,
    });

    if (!selection.ref || selection.ref === refs[0]) return refs;
    // Put the winner first; keep the rest in their original order as fallbacks.
    return [selection.ref, ...refs.filter((r) => r !== selection.ref)];
  } catch (err) {
    console.warn(
      '[routeModelOrder] model routing failed; using config order:',
      err instanceof Error ? err.message : err,
    );
    return refs;
  }
}
