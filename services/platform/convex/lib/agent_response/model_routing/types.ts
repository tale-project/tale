import type { Domain } from '../../../../lib/shared/constants/domains';
import type { ModelTier } from '../../../../lib/shared/schemas/providers';

export type { ModelTier };

/** Lightweight per-model info the router reasons over (no secrets / SDK). */
export interface ModelCandidate {
  /** Full model ref as it appears in the agent's `supportedModels`. */
  ref: string;
  /** Operator/registry-declared strength tier, if known. */
  tier?: ModelTier;
  /** Fine-grained quality ordering within a tier (0–1). */
  qualityScore?: number;
  /** Domains this model is preferred for. */
  routingTags?: Domain[];
  /** Output price (cents per million tokens) — the cost-tier fallback signal. */
  outputCentsPerMillion?: number;
  /** Whether the model accepts image input (vision turns must keep it). */
  supportsVision?: boolean;
}

export interface ModelSelection {
  /** Chosen model ref (always one of the input candidates). */
  ref: string;
  /** The tier the chosen model resolved to. */
  tier: ModelTier;
  /** Why it was chosen — telemetry / debug, not user-facing. */
  reason:
    | 'single-candidate'
    | 'domain-match'
    | 'complexity-tier'
    | 'high-stakes'
    | 'fallback';
}

export const TIER_RANK: Record<ModelTier, number> = {
  draft: 0,
  standard: 1,
  frontier: 2,
};
