/**
 * Layer A — the difficulty prior.
 *
 * A pure, zero-cost estimator of how much reasoning a turn deserves, from
 * signals already in hand at the call site. No model call, no I/O — it runs
 * inline and adds no latency.
 *
 * It computes a **continuous intensity in [0,1]** as a logistic blend of
 * normalized features, which captures feature interactions and yields a smooth
 * difficulty→budget curve instead of four cliffs. It is **multilingual**:
 * structural features (length, code density, math, tables, enumeration,
 * retrieval, agentic shape) are language-agnostic and carry every locale, while
 * intent cues come from the composed multilingual lexicon (`./lexicon`,
 * structured after the PII locale registry). It also emits a **creativity**
 * signal (for temperature control) and a **floor** the controller may not
 * undercut for this turn.
 */

import { clamp01 } from './clamp';
import {
  matchesAnalyticalVerb,
  matchesCreativeVerb,
  matchesEasyVerb,
  matchesHardVerb,
  matchesTrivialAck,
} from './lexicon';
import {
  budgetToTier,
  classFromIntensity,
  maxTier,
  TIER_BUDGET_TOKENS,
  type DifficultyClass,
  type ReasoningKind,
  type ReasoningTarget,
  type ReasoningTier,
} from './types';

export interface DifficultySignals {
  kind: ReasoningKind;
  /** The user prompt text for this turn, when available as a plain string. */
  promptText?: string;
  /** Pre-computed prompt token estimate; falls back to a char/4 heuristic. */
  promptTokens?: number;
  hasAttachments?: boolean;
  hasRagContext?: boolean;
  hasWebContext?: boolean;
  /** Number of tools exposed to the agent this turn. */
  toolCount?: number;
  /** Agent step ceiling — high values imply multi-step agentic work. */
  maxSteps?: number;
  /** Agent family (`chat`, `web`, `file`, `crm`, `integration`, `workflow`). */
  agentType?: string;
  /** Count of prior messages in the thread (follow-up detection). */
  historyMessageCount?: number;
}

export interface DifficultyResult {
  /** Continuous difficulty in [0,1] (the calibrated prior). */
  intensity: number;
  /** Continuous creativity in [0,1] — 0 precise/analytical, 1 open-ended. */
  creativity: number;
  /** Coarse class the controller buckets learning by. */
  difficultyClass: DifficultyClass;
  /** Prior reasoning target derived from intensity, lifted to the floor. */
  target: ReasoningTarget;
  /** Minimum tier the controller may not undercut for this turn. */
  floorTier: ReasoningTier;
}

const CODE_FENCE = /```[\s\S]*?```|~~~[\s\S]*?~~~/g;
const TABLE = /\|.*\|.*\n\s*\|?\s*[-:]+\s*\|/;
const ENUMERATION = /(^|\n)\s*(\d+[.)]\s|[-*]\s).*(\n\s*(\d+[.)]\s|[-*]\s))/;
const MULTI_STEP =
  /\b(step[-\s]?by[-\s]?step|first\b.*\bthen\b|then\b.*\bfinally\b|walk me through)\b/i;
const MATH = /\$[^$]+\$|\\\(|\\\[|\\begin\{/;

/** Logistic squashing into (0,1). */
function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Fraction of characters that live inside fenced code blocks (0..1). */
function codeDensity(text: string): number {
  if (text.length === 0) return 0;
  let inside = 0;
  for (const match of text.matchAll(CODE_FENCE)) inside += match[0].length;
  return clamp01(inside / text.length);
}

// Feature weights for the logit. Tuned so an empty/greeting prompt lands near
// "off", a plain question near "low/medium", and a long structured coding task
// near "high". Code and intent verbs additionally raise a hard floor below.
const W = {
  bias: -1.25,
  length: 1.7,
  code: 2.6,
  structure: 1.2,
  math: 0.8,
  hardVerb: 1.5,
  easyVerb: -1.6,
  retrieval: 0.9,
  agentic: 1.1,
  trivial: -3.0,
  followUp: -0.9,
} as const;

const OFF_INTENSITY = 0.12;
const PRIOR_BUDGET_GAMMA = 1.4;
const PRIOR_BUDGET_MAX = TIER_BUDGET_TOKENS.high;

/**
 * Score a turn's reasoning difficulty into a continuous intensity, a creativity
 * signal, a coarse class, a canonical target, and a hard floor.
 */
export function scoreDifficulty(signals: DifficultySignals): DifficultyResult {
  // Utility work (titles, translations, message polish, cron) is mechanical —
  // never burn reasoning on it, and keep it precise (low creativity).
  if (signals.kind === 'utility') {
    return {
      intensity: 0,
      creativity: 0,
      difficultyClass: 'easy',
      target: { tier: 'off', budgetTokens: 0 },
      floorTier: 'off',
    };
  }

  const text = signals.promptText ?? '';
  const tokens = signals.promptTokens ?? estimateTokens(text);

  // Normalized, language-agnostic features in [0,1].
  const lengthNorm = clamp01(Math.log1p(tokens) / Math.log(1500));
  const density = codeDensity(text);
  const hasMath = MATH.test(text);
  const questionCount = (text.match(/\?|？/g) ?? []).length;
  const structure = clamp01(
    (questionCount >= 2 ? 0.4 : 0) +
      (TABLE.test(text) ? 0.4 : 0) +
      (ENUMERATION.test(text) || MULTI_STEP.test(text) ? 0.5 : 0),
  );

  // Multilingual intent cues (composed across every shipped locale).
  const hasHardVerb = matchesHardVerb(text);
  const hasEasyVerb = matchesEasyVerb(text);
  const hasCreativeVerb = matchesCreativeVerb(text);
  const hasAnalyticalVerb = matchesAnalyticalVerb(text);
  const isTrivial = matchesTrivialAck(text);

  const retrieval = clamp01(
    (signals.hasAttachments ? 0.5 : 0) +
      (signals.hasRagContext || signals.hasWebContext ? 0.5 : 0),
  );
  const toolCount = signals.toolCount ?? 0;
  const agentic = clamp01(
    Math.min(toolCount, 8) / 8 +
      ((signals.maxSteps ?? 0) >= 10 ? 0.4 : 0) +
      (signals.agentType &&
      signals.agentType !== 'chat' &&
      signals.agentType !== 'subagent'
        ? 0.3
        : 0),
  );
  const isFollowUp =
    (signals.historyMessageCount ?? 0) >= 6 && tokens < 30 ? 1 : 0;

  const z =
    W.bias +
    W.length * lengthNorm +
    W.code * density +
    W.structure * structure +
    W.math * (hasMath ? 1 : 0) +
    W.hardVerb * (hasHardVerb ? 1 : 0) +
    W.easyVerb * (hasEasyVerb ? 1 : 0) +
    W.retrieval * retrieval +
    W.agentic * agentic +
    W.trivial * (isTrivial ? 1 : 0) +
    W.followUp * isFollowUp;

  const intensity = sigmoid(z);

  // Creativity: precise/deterministic work pulls temperature down, open-ended
  // generation pulls it up. Code / math / analytical intent are precise.
  const analytical = hasAnalyticalVerb || density > 0 || hasMath || hasHardVerb;
  const creativity = clamp01(
    0.5 +
      (hasCreativeVerb ? 0.35 : 0) -
      (analytical ? 0.35 : 0) -
      (hasEasyVerb ? 0.1 : 0),
  );

  // Hard floors: a genuinely hard turn can't be starved by history.
  let floorTier: ReasoningTier = 'off';
  if (density > 0 || hasHardVerb) floorTier = maxTier(floorTier, 'medium');
  if (signals.hasAttachments) floorTier = maxTier(floorTier, 'low');

  // Continuous intensity → prior budget → tier, lifted to the floor.
  const rawBudget =
    intensity <= OFF_INTENSITY
      ? 0
      : Math.round(
          1024 +
            Math.pow(intensity, PRIOR_BUDGET_GAMMA) * (PRIOR_BUDGET_MAX - 1024),
        );
  const tier = maxTier(budgetToTier(rawBudget), floorTier);
  const budgetTokens = Math.max(rawBudget, TIER_BUDGET_TOKENS[floorTier]);

  return {
    intensity,
    creativity,
    difficultyClass: classFromIntensity(intensity),
    target: { tier, budgetTokens },
    floorTier,
  };
}
