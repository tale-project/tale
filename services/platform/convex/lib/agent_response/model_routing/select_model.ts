/**
 * Complexity-based model-tier routing (pure, zero-IO).
 *
 * Given a turn's difficulty + domain and the agent's candidate models, pick the
 * cheapest model strong enough for the turn. Ported in spirit from
 * `old_router/cascadeflow/routing/pre_router.py`:
 *
 *  - high-stakes domains (legal / medical / financial / factual) force the
 *    strongest tier — a wrong answer there is expensive;
 *  - otherwise the difficulty class maps to a target tier
 *    (easy → draft, medium → standard, hard → frontier);
 *  - a model whose `routingTags` include the turn's domain is preferred at the
 *    target tier (a coder model for code, etc.);
 *  - vision turns keep only vision-capable candidates.
 *
 * When a candidate has no explicit `tier`, one is inferred from its relative
 * `outputCentsPerMillion` among the candidates (cheapest third → draft, top
 * third → frontier). Falls back to the first candidate when nothing fits.
 */

import {
  DEFAULT_DOMAIN,
  HIGH_STAKES_DOMAINS,
  type Domain,
} from '../../../../lib/shared/constants/domains';
import type { DifficultyClass } from '../reasoning/types';
import {
  TIER_RANK,
  type ModelCandidate,
  type ModelSelection,
  type ModelTier,
} from './types';

const CLASS_TO_TIER: Record<DifficultyClass, ModelTier> = {
  easy: 'draft',
  medium: 'standard',
  hard: 'frontier',
};

/** Reasonable per-tier quality default when NO sibling carries a score. */
const TIER_DEFAULT_QUALITY: Record<ModelTier, number> = {
  draft: 0.3,
  standard: 0.6,
  frontier: 0.9,
};

interface ScoredNeighbour {
  pos: number;
  value: number;
}

/** Nearest scored neighbour scanning outward from `pos` in `step` direction. */
function nearestScored(
  known: readonly (number | null)[],
  pos: number,
  step: 1 | -1,
): ScoredNeighbour | null {
  for (let p = pos + step; p >= 0 && p < known.length; p += step) {
    const value = known[p];
    if (value != null) return { pos: p, value };
  }
  return null;
}

/**
 * Fill in missing per-candidate quality scores ("intelligence"). A model that
 * declares no `qualityScore` would otherwise sort as 0 and always lose; instead
 * we interpolate it from the agent's OTHER candidates that DO carry a score —
 * linearly along the (tier, cost)-sorted order between the nearest scored
 * neighbours — so an unscored model ranks sensibly relative to its siblings.
 * Falls back to a tier-based default only when not a single sibling is scored.
 */
function resolveQualityScores(
  candidates: ModelCandidate[],
  tiers: ModelTier[],
): number[] {
  // Order candidates weakest→strongest: by tier rank, then by ascending cost.
  const order = candidates
    .map((_, i) => i)
    .sort((a, b) => {
      const byTier = TIER_RANK[tiers[a]] - TIER_RANK[tiers[b]];
      if (byTier !== 0) return byTier;
      return (
        (candidates[a].outputCentsPerMillion ?? Infinity) -
        (candidates[b].outputCentsPerMillion ?? Infinity)
      );
    });

  const known = order.map((i) => {
    const q = candidates[i].qualityScore;
    return q != null && Number.isFinite(q) ? q : null;
  });

  const result = new Array<number>(candidates.length);
  order.forEach((candidateIndex, pos) => {
    const score = known[pos];
    if (score != null) {
      result[candidateIndex] = score;
      return;
    }
    const prev = nearestScored(known, pos, -1);
    const next = nearestScored(known, pos, 1);
    if (prev && next) {
      result[candidateIndex] =
        prev.value +
        ((pos - prev.pos) / (next.pos - prev.pos)) * (next.value - prev.value);
    } else if (prev) {
      result[candidateIndex] = prev.value;
    } else if (next) {
      result[candidateIndex] = next.value;
    } else {
      result[candidateIndex] = TIER_DEFAULT_QUALITY[tiers[candidateIndex]];
    }
  });
  return result;
}

/**
 * Resolve every candidate's effective tier. Explicit `tier` wins; otherwise
 * infer from the cost distribution among candidates that have a price. With <3
 * priced candidates we can't form terciles, so unpriced/sparse sets default to
 * 'standard' (a safe middle that neither over- nor under-provisions).
 */
function resolveTiers(candidates: ModelCandidate[]): ModelTier[] {
  const priced = candidates
    .map((c, i) => ({ i, cost: c.outputCentsPerMillion }))
    .filter((x): x is { i: number; cost: number } => x.cost != null)
    .sort((a, b) => a.cost - b.cost);

  const inferred = new Map<number, ModelTier>();
  if (priced.length >= 3) {
    const third = priced.length / 3;
    priced.forEach((p, rank) => {
      inferred.set(
        p.i,
        rank < third ? 'draft' : rank < 2 * third ? 'standard' : 'frontier',
      );
    });
  }

  return candidates.map((c, i) => c.tier ?? inferred.get(i) ?? 'standard');
}

export interface SelectModelInput {
  candidates: ModelCandidate[];
  difficultyClass: DifficultyClass;
  domain: Domain;
  /** When true, only vision-capable candidates are eligible. */
  requiresVision?: boolean;
}

export function selectModelTier(input: SelectModelInput): ModelSelection {
  const { difficultyClass, domain, requiresVision } = input;

  // Vision turns: drop non-vision candidates (unless that would empty the set).
  let candidates = input.candidates;
  if (requiresVision) {
    const visionCapable = candidates.filter((c) => c.supportsVision);
    if (visionCapable.length > 0) candidates = visionCapable;
  }

  if (candidates.length === 0) {
    return {
      ref: input.candidates[0]?.ref ?? '',
      tier: 'standard',
      reason: 'fallback',
    };
  }
  if (candidates.length === 1) {
    const tiers = resolveTiers(candidates);
    return {
      ref: candidates[0].ref,
      tier: tiers[0],
      reason: 'single-candidate',
    };
  }

  const tiers = resolveTiers(candidates);
  // Intelligence scores, with any missing ones interpolated from the siblings
  // in this agent's model list that do declare one.
  const qualities = resolveQualityScores(candidates, tiers);
  const highStakes = HIGH_STAKES_DOMAINS.includes(domain);
  const targetTier: ModelTier = highStakes
    ? 'frontier'
    : CLASS_TO_TIER[difficultyClass];
  const targetRank = TIER_RANK[targetTier];

  // Score candidates: must be at/above target tier (a stronger model is fine,
  // a weaker one only if nothing stronger exists). Among eligible, prefer a
  // domain (routingTags) match, then the LOWEST tier that still clears the
  // target (cheapest sufficient), then highest qualityScore, then lower cost.
  const indexed = candidates.map((c, i) => ({
    c,
    tier: tiers[i],
    rank: TIER_RANK[tiers[i]],
    quality: qualities[i],
    domainMatch:
      (c.routingTags ?? []).includes(domain) && domain !== DEFAULT_DOMAIN,
  }));

  const atOrAbove = indexed.filter((x) => x.rank >= targetRank);
  const pool = atOrAbove.length > 0 ? atOrAbove : indexed;

  // Within the sufficient tier: an EASY turn optimizes for cost (which tracks
  // speed — over-provisioning a trivial turn buys latency, not quality; the
  // quality-first order used to hand "hello" to the priciest sibling that the
  // cost terciles happened to label draft/standard). Medium/hard turns keep
  // quality first — there the stronger answer is worth the wait.
  const preferCheap = !highStakes && difficultyClass === 'easy';
  pool.sort((a, b) => {
    if (a.domainMatch !== b.domainMatch) return a.domainMatch ? -1 : 1;
    if (a.rank !== b.rank) return a.rank - b.rank; // cheapest sufficient tier
    const costA = a.c.outputCentsPerMillion ?? Infinity;
    const costB = b.c.outputCentsPerMillion ?? Infinity;
    if (preferCheap && costA !== costB) return costA - costB;
    if (a.quality !== b.quality) return b.quality - a.quality;
    return costA - costB;
  });

  const winner = pool[0];
  const reason: ModelSelection['reason'] = winner.domainMatch
    ? 'domain-match'
    : highStakes
      ? 'high-stakes'
      : 'complexity-tier';
  return { ref: winner.c.ref, tier: winner.tier, reason };
}
