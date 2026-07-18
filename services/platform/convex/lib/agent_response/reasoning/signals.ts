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
  countCreativeVerbs,
  countEasyVerbs,
  countHardVerbs,
  matchesAnalyticalVerb,
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
  /**
   * Coarse reasoning-effort seed from the Auto router (low/medium/high). Blends
   * the heuristic difficulty prior toward this hint (a PRIOR, weight {@link
   * SEED_WEIGHT}) — never a hard override; the online controller still refines
   * from observed usage. Undefined = heuristic prior only (pinned agents and
   * non-Auto turns), so behaviour is byte-identical to before.
   */
  effortSeed?: 'low' | 'medium' | 'high';
  /**
   * Coarse creativity seed from the Auto router (precise/balanced/creative).
   * Blends the creativity signal feeding the temperature governor, same weight.
   */
  creativitySeed?: 'precise' | 'balanced' | 'creative';
}

/**
 * Structural signals surfaced for downstream consumers (model routing,
 * cascade). Purely descriptive — they do not change the difficulty math.
 */
interface DifficultyFeatures {
  /** Graded code-likeness in [0,1] (fences, inline, stack traces, syntax). */
  codeDensity: number;
  /** Whether math/LaTeX notation is present. */
  hasMath: boolean;
  /** Structure score in [0,1] (multi-question, tables, enumeration, steps). */
  structure: number;
  /** Number of question marks in the prompt (multi-question detection). */
  questionCount: number;
  /** Agentic shape in [0,1] (tool count, step ceiling, non-chat agent). */
  agentic: number;
  /** Retrieval shape in [0,1] (attachments, RAG/web context). */
  retrieval: number;
  /** Whole message is a trivial greeting / ack. */
  isTrivial: boolean;
}

interface DifficultyResult {
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
  /** Structural signals for model routing / cascade (descriptive only). */
  features: DifficultyFeatures;
}

const CODE_FENCE = /```[\s\S]*?```|~~~[\s\S]*?~~~/g;
const INLINE_CODE = /`[^`\n]+`/g;
// Stack traces / exceptions across common runtimes (JS, Python, Java, .NET).
const STACK_TRACE =
  /\bat\s+.+\(.+:\d+:\d+\)|Traceback \(most recent call last\)|Exception in thread|\b[\w.]+(?:Error|Exception):/;
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

/**
 * Graded "how code-like is this" in [0,1]. Fenced blocks are the strongest
 * signal; inline backticks, stack traces, and brace/semicolon density catch
 * code that fenced-only counting misses (a pasted error, a one-liner, raw
 * JSON). Take the max so any one strong cue suffices — still O(n), no latency.
 */
function codeDensity(text: string): number {
  if (text.length === 0) return 0;
  let fenced = 0;
  for (const match of text.matchAll(CODE_FENCE)) fenced += match[0].length;
  const fencedFraction = fenced / text.length;

  let inlineChars = 0;
  for (const match of text.matchAll(INLINE_CODE))
    inlineChars += match[0].length;
  const inlineFraction = inlineChars / text.length;

  const stackTrace = STACK_TRACE.test(text) ? 1 : 0;
  // Brace/semicolon/bracket density — a cheap proxy for raw code or JSON.
  const syntaxChars = (text.match(/[{};[\]]/g) ?? []).length;
  const syntaxFraction = syntaxChars / text.length;

  return clamp01(
    Math.max(
      fencedFraction,
      inlineFraction,
      0.5 * stackTrace,
      Math.min(1, syntaxFraction * 4),
    ),
  );
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
  // Doubled vs. the old binary weights so a single match (strength 0.5)
  // reproduces the prior contribution (1.5 / -1.6); a second match doubles it.
  hardVerb: 3.0,
  easyVerb: -3.2,
  retrieval: 0.9,
  agentic: 1.1,
  trivial: -3.0,
  followUp: -0.9,
} as const;

const OFF_INTENSITY = 0.12;
const PRIOR_BUDGET_GAMMA = 1.4;
const PRIOR_BUDGET_MAX = TIER_BUDGET_TOKENS.high;

/** Ceiling the PRIOR budget may reach per difficulty class — the prior can
 *  never announce 'easy' yet spend a 'medium' thinking budget. Floors (code /
 *  hard verbs / attachments) and the online controller may still raise it. */
const CLASS_TIER_CAP: Record<DifficultyClass, ReasoningTier> = {
  easy: 'low',
  medium: 'medium',
  hard: 'high',
};

// How far the Auto router's coarse hint pulls the heuristic prior toward it — a
// blend, not an override (the online controller still refines from observed
// usage). Representative prior intensity / creativity score per hint level.
const SEED_WEIGHT = 0.5;
const SEED_INTENSITY: Record<'low' | 'medium' | 'high', number> = {
  low: 0.25,
  medium: 0.55,
  high: 0.85,
};
const SEED_CREATIVITY: Record<'precise' | 'balanced' | 'creative', number> = {
  precise: 0,
  balanced: 0.5,
  creative: 1,
};

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
      features: {
        codeDensity: 0,
        hasMath: false,
        structure: 0,
        questionCount: 0,
        agentic: 0,
        retrieval: 0,
        isTrivial: false,
      },
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

  // Multilingual intent cues (composed across every shipped locale). Graded by
  // COUNT and saturated at two occurrences, so two hard verbs read stronger than
  // one. A single match yields strength 0.5; the weights below are scaled so
  // that single-match case reproduces the original binary contribution exactly.
  const hardStrength = clamp01(countHardVerbs(text) / 2);
  const easyStrength = clamp01(countEasyVerbs(text) / 2);
  const creativeStrength = clamp01(countCreativeVerbs(text) / 2);
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
  // Follow-up: a short reply deep in a thread leans on prior context and needs
  // less reasoning. Continuous (not a 6/30 cliff): history depth ramps in after
  // ~2 turns and saturates by ~8; shortness fades out by ~40 tokens.
  const historyDepth = clamp01(((signals.historyMessageCount ?? 0) - 2) / 6);
  const shortness = 1 - clamp01(tokens / 40);
  // A genuinely hard turn is never damped as a follow-up: a terse rework deep in
  // a thread ("now redo it in Rust", "make it handle the edge cases") carries
  // code / hard-verb / math signal and must score on its content, not be pulled
  // down for being short. Plain short follow-ups still damp.
  const followUpScore =
    density > 0 || hardStrength > 0 || hasMath ? 0 : historyDepth * shortness;

  const z =
    W.bias +
    W.length * lengthNorm +
    W.code * density +
    W.structure * structure +
    W.math * (hasMath ? 1 : 0) +
    W.hardVerb * hardStrength +
    W.easyVerb * easyStrength +
    W.retrieval * retrieval +
    W.agentic * agentic +
    W.trivial * (isTrivial ? 1 : 0) +
    W.followUp * followUpScore;

  let intensity = sigmoid(z);

  // Long-context QA damp: a very long prompt with NO code, NO hard-verb intent,
  // and little structure is usually a pasted document with a short ask
  // (extract / look up / answer-from-this) — mechanically simpler than its
  // length implies. The length feature alone would over-escalate it, so damp
  // the prior. Gated tightly so it can never fire on a long *coding* or
  // *analytical* task (those carry density / hardStrength / structure).
  const longContextQa =
    tokens > 1500 &&
    density === 0 &&
    hardStrength === 0 &&
    !hasMath &&
    structure < 0.4 &&
    !isTrivial;
  if (longContextQa) intensity *= 0.85;

  // Router seed (Auto mode only): blend the heuristic prior toward the LLM's
  // coarse effort read. The router actually read the message, so this fixes
  // cold-start and the heuristic's semantic blind spots (a terse-but-hard ask)
  // on turn one; the online controller then refines from observed usage, so a
  // wrong hint self-corrects. Absent = byte-identical to the pure heuristic.
  if (signals.effortSeed) {
    intensity =
      (1 - SEED_WEIGHT) * intensity +
      SEED_WEIGHT * SEED_INTENSITY[signals.effortSeed];
  }

  // Creativity: precise/deterministic work pulls temperature down, open-ended
  // generation pulls it up. Code / math / analytical intent are precise.
  const analytical =
    hasAnalyticalVerb || density > 0 || hasMath || hardStrength > 0;
  let creativity = clamp01(
    0.5 + 0.7 * creativeStrength - (analytical ? 0.35 : 0) - 0.2 * easyStrength,
  );
  if (signals.creativitySeed) {
    creativity = clamp01(
      (1 - SEED_WEIGHT) * creativity +
        SEED_WEIGHT * SEED_CREATIVITY[signals.creativitySeed],
    );
  }

  // Hard floors: a genuinely hard turn can't be starved by history.
  let floorTier: ReasoningTier = 'off';
  if (density > 0 || hardStrength > 0) floorTier = maxTier(floorTier, 'medium');
  if (signals.hasAttachments) floorTier = maxTier(floorTier, 'low');

  // Continuous intensity → prior budget → tier, lifted to the floor.
  //
  // The budget is CAPPED at the turn's own difficulty class: without the cap a
  // single feature weight (math on "what is 2+2?") pushed an easy-class turn
  // into a medium thinking budget — seconds of dead air before the first
  // visible token on a trivial message. The floors below still win, so code /
  // hard-verb / attachment turns keep their guaranteed minimum, and the online
  // controller can still raise the budget when a model's revealed need says so.
  const difficultyClass = classFromIntensity(intensity);
  const classCapBudget = TIER_BUDGET_TOKENS[CLASS_TIER_CAP[difficultyClass]];
  const rawBudget =
    intensity <= OFF_INTENSITY
      ? 0
      : Math.min(
          Math.round(
            1024 +
              Math.pow(intensity, PRIOR_BUDGET_GAMMA) *
                (PRIOR_BUDGET_MAX - 1024),
          ),
          classCapBudget,
        );
  const tier = maxTier(budgetToTier(rawBudget), floorTier);
  const budgetTokens = Math.max(rawBudget, TIER_BUDGET_TOKENS[floorTier]);

  return {
    intensity,
    creativity,
    difficultyClass,
    target: { tier, budgetTokens },
    floorTier,
    features: {
      codeDensity: density,
      hasMath,
      structure,
      questionCount,
      agentic,
      retrieval,
      isTrivial,
    },
  };
}
