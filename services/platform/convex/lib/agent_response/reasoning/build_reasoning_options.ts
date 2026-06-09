/**
 * Orchestrator for the Adaptive Reasoning Governor.
 *
 * Composes the layers — difficulty prior (A) → online controller (C), gated and
 * translated by capability (B) — plus the generation-parameter governor
 * (temperature) into a `providerOptions` overlay merged onto whatever the model
 * config already declares. The overlay is applied at the call site (NOT
 * operator config), so it bypasses the `reasoning_effort` deny-list by design,
 * and the openai-compatible adapter carries it to the wire (`reasoningEffort` →
 * `reasoning_effort`; the raw `thinking` object spreads through as a body field).
 *
 * Pure and synchronous: all inputs are gathered by the caller, so it adds no
 * latency.
 */

import type { SharedV3ProviderOptions } from '@ai-sdk/provider';

import { mergeModelLevel } from '../../provider_options';
import {
  resolveReasoningCapability,
  tierToEffort,
  type ReasoningCapability,
  type ReasoningCapabilityConfig,
} from './capability';
import { adjustTarget, type QualityProfile } from './controller';
import { decideTemperature } from './generation_params';
import { scoreDifficulty, type DifficultySignals } from './signals';
import {
  adaptiveDifficultyThresholds,
  classFromIntensity,
  maxTier,
  minTier,
  TIER_BUDGET_TOKENS,
  TIER_RANK,
  type DifficultyClass,
  type ReasoningState,
  type ReasoningTarget,
  type ReasoningTier,
} from './types';

/** Default thinking-budget ceiling when the model declares no output cap. */
const DEFAULT_BUDGET_CEILING = 24576;
/** Tokens reserved for the answer when deriving a budget from the output cap. */
const ANSWER_HEADROOM = 1024;

export interface ReasoningModelInput {
  providerName: string;
  modelId: string;
  /** Per-model output-token cap; bounds the thinking budget so it leaves room
   * for the answer (Anthropic requires `budget_tokens < max_tokens`). */
  maxOutputTokens?: number;
  /** Operator-declared reasoning capability override. */
  reasoning?: ReasoningCapabilityConfig;
}

export interface BuildReasoningOptionsInput {
  modelData: ReasoningModelInput;
  /** Result of `buildCallProviderOptions(modelData)`; the overlay merges onto it. */
  baseProviderOptions?: Record<string, unknown>;
  signals: DifficultySignals;
  /** Per-thread controller state, if any. */
  state?: ReasoningState;
  /**
   * Inherited cross-thread profile (per org + model) used as the warm-start
   * shrinkage anchor — lets a fresh thread (or the stateless API path) benefit
   * from the org's accumulated learning from turn one.
   */
  profile?: ReasoningState;
  /**
   * Composer-sourced FIXED reasoning tier. When set, the adaptive controller
   * is bypassed and this tier (with its canonical budget) is used directly.
   * `undefined` keeps the governor in charge.
   */
  effortOverride?: ReasoningTier;
  /**
   * Composer-sourced FIXED creativity score in [0, 1]. Overrides the
   * difficulty-scaled creativity fed to `decideTemperature` (which still
   * drops temperature for reasoning-only models). `undefined` = adaptive.
   */
  creativityOverride?: number;
  /**
   * Agent-configured FLOOR — the adaptive controller may not settle below this
   * tier. `undefined` = no floor beyond the per-turn hard floor (Layer A).
   */
  effortFloorTier?: ReasoningTier;
  /**
   * Agent-configured CEILING — the adaptive controller may not exceed this
   * tier. Applied after the floor (the schema enforces floor ≤ ceiling).
   */
  effortCeilingTier?: ReasoningTier;
  /**
   * Agent-configured per-difficulty-class hard cap on the thinking-token
   * budget (budgetTokens-knob models). `undefined` = no extra cap.
   */
  budgetCaps?: Partial<Record<DifficultyClass, number>>;
  /** Agent-configured temperature band override for `decideTemperature`. */
  temperatureRange?: { min?: number; max?: number };
  /** Agent-configured quality-feedback preset for the controller deadbands. */
  qualityProfile?: QualityProfile;
}

export interface ReasoningDecision {
  /** Merged options to hand to streamText/generateText (undefined if empty). */
  providerOptions?: SharedV3ProviderOptions;
  /** The tier the governor settled on (for telemetry / debug). */
  tier: ReasoningTier;
  budgetTokens: number;
  /** Difficulty class this turn fell into (for outcome recording). */
  difficultyClass: DifficultyClass;
  /** Continuous difficulty intensity [0,1] (for outcome recording / telemetry). */
  intensity: number;
  /** Whether the model self-truncates — undefined when not steerable. */
  selfTruncates?: boolean;
  /** Default sampling temperature, or undefined to leave unset. */
  temperature?: number;
  /** Whether a reasoning overlay was actually applied (model is steerable). */
  applied: boolean;
}

export function buildReasoningOptions(
  input: BuildReasoningOptionsInput,
): ReasoningDecision {
  const {
    modelData,
    baseProviderOptions,
    signals,
    state,
    profile,
    effortOverride,
    creativityOverride,
    effortFloorTier,
    effortCeilingTier,
    budgetCaps,
    temperatureRange,
    qualityProfile,
  } = input;

  const difficulty = scoreDifficulty(signals);
  const capability = resolveReasoningCapability(modelData);

  // Self-calibrate the difficulty-class boundaries to the org's traffic, using
  // whichever learned state has more intensity evidence (profile is org-wide
  // and accumulates faster). Falls back to the static thresholds until there's
  // enough data, so cold paths reproduce today's bucketing exactly.
  const thresholdSource =
    (profile?.intensityCount ?? 0) >= (state?.intensityCount ?? 0)
      ? profile
      : state;
  const difficultyClass = classFromIntensity(
    difficulty.intensity,
    adaptiveDifficultyThresholds(thresholdSource),
  );

  // Fixed effort profile bypasses the adaptive controller entirely; otherwise
  // use the controller-adjusted target (when steerable) / raw prior.
  const rawTarget = effortOverride
    ? { tier: effortOverride, budgetTokens: TIER_BUDGET_TOKENS[effortOverride] }
    : capability
      ? adjustTarget(
          difficulty.target,
          difficulty.floorTier,
          difficultyClass,
          state,
          capability,
          profile,
          qualityProfile,
        )
      : difficulty.target;

  // Apply the agent-configured floor/ceiling band and per-class budget cap. The
  // controller still adapts WITHIN the band; the floor never undercuts Layer A.
  const target = applyTuningBounds(rawTarget, {
    effortFloorTier,
    effortCeilingTier,
    budgetCap: budgetCaps?.[difficultyClass],
  });

  const { overlay, applied } = capability
    ? buildOverlay(target.tier, target.budgetTokens, capability, modelData)
    : { overlay: undefined, applied: false };

  const reasoningActive = applied && target.tier !== 'off';
  const temperature = decideTemperature(
    creativityOverride ?? difficulty.creativity,
    capability,
    reasoningActive,
    temperatureRange,
  );

  const providerOptions = asProviderOptions(
    overlay
      ? mergeModelLevel(baseProviderOptions, overlay)
      : baseProviderOptions,
  );

  return {
    providerOptions,
    tier: target.tier,
    budgetTokens: target.budgetTokens,
    difficultyClass,
    intensity: difficulty.intensity,
    selfTruncates: capability?.selfTruncates,
    temperature,
    applied,
  };
}

/**
 * Apply the per-agent effort floor/ceiling and per-class budget cap to a target.
 * Ceiling is applied first, then the floor (floor wins on conflict; the schema
 * already enforces floor ≤ ceiling). Tier and budget are kept consistent.
 */
function applyTuningBounds(
  target: ReasoningTarget,
  bounds: {
    effortFloorTier?: ReasoningTier;
    effortCeilingTier?: ReasoningTier;
    budgetCap?: number;
  },
): ReasoningTarget {
  let { tier, budgetTokens } = target;

  if (bounds.effortCeilingTier) {
    tier = minTier(tier, bounds.effortCeilingTier);
    if (TIER_RANK[tier] < TIER_RANK[target.tier]) {
      budgetTokens = Math.min(budgetTokens, TIER_BUDGET_TOKENS[tier]);
    }
  }
  if (bounds.effortFloorTier) {
    tier = maxTier(tier, bounds.effortFloorTier);
    budgetTokens = Math.max(
      budgetTokens,
      TIER_BUDGET_TOKENS[bounds.effortFloorTier],
    );
  }
  if (bounds.budgetCap != null && bounds.budgetCap > 0) {
    budgetTokens = Math.min(budgetTokens, bounds.budgetCap);
  }
  return { tier, budgetTokens };
}

function buildOverlay(
  tier: ReasoningTier,
  budgetTokens: number,
  capability: ReasoningCapability,
  modelData: ReasoningModelInput,
): { overlay: Record<string, unknown> | undefined; applied: boolean } {
  if (capability.knob === 'effort') {
    return {
      overlay: {
        [modelData.providerName]: {
          reasoningEffort: tierToEffort(tier, capability.supportsMinimal),
        },
      },
      applied: true,
    };
  }
  // budgetTokens (Anthropic-style extended thinking).
  const budget = resolveBudget(budgetTokens, capability, modelData);
  if (tier !== 'off' && budget != null) {
    return {
      overlay: {
        [modelData.providerName]: {
          thinking: { type: 'enabled', budget_tokens: budget },
        },
      },
      applied: true,
    };
  }
  return { overlay: undefined, applied: false };
}

/**
 * Convenience wrapper for call sites that only need the merged reasoning
 * options (no per-thread controller state, no temperature). Used by the
 * non-chat generation paths (workflow nodes, utility calls like
 * title/translation, vision helpers).
 */
export function reasoningProviderOptionsFor(
  modelData: ReasoningModelInput,
  baseProviderOptions: Record<string, unknown> | undefined,
  signals: DifficultySignals,
  state?: ReasoningState,
): SharedV3ProviderOptions | undefined {
  return buildReasoningOptions({
    modelData,
    baseProviderOptions,
    signals,
    state,
  }).providerOptions;
}

/**
 * Clamp a canonical budget to the model's real limits. Returns `null` when no
 * valid budget fits (e.g. the output cap is too small to leave answer
 * headroom) so the caller omits the overlay rather than send an invalid value.
 */
function resolveBudget(
  canonical: number,
  capability: { minBudgetTokens?: number; maxBudgetTokens?: number },
  modelData: ReasoningModelInput,
): number | null {
  const min = capability.minBudgetTokens ?? 1024;
  let max = capability.maxBudgetTokens ?? Number.POSITIVE_INFINITY;
  if (modelData.maxOutputTokens && modelData.maxOutputTokens > 0) {
    max = Math.min(max, modelData.maxOutputTokens - ANSWER_HEADROOM);
  }
  if (!Number.isFinite(max)) max = DEFAULT_BUDGET_CEILING;
  if (max < min) return null;
  return Math.max(min, Math.min(canonical, max));
}

function asProviderOptions(
  value: Record<string, unknown> | undefined,
): SharedV3ProviderOptions | undefined {
  if (!value) return undefined;
  // Mirrors buildCallProviderOptions: the data is JSON-shaped, structurally
  // satisfying SharedV3ProviderOptions = Record<string, JSONObject>.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- JSON-derived data structurally satisfies JSONObject; TS cannot infer JSON-shape across the merge boundary
  return value as SharedV3ProviderOptions;
}
