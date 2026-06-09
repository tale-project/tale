/**
 * Response-quality analysis (pure, zero-IO).
 *
 * Scores a generated answer for hedging, specificity, hallucination-pattern
 * risk, and length-appropriateness — WITHOUT a second model call. Ported from
 * `old_router/cascadeflow/quality/quality.py` (`ResponseAnalyzer`), adapted to
 * a single continuous score in [0,1] plus an accept/reject decision against the
 * per-complexity preset thresholds.
 *
 * Consumer: the Adaptive Reasoning Governor folds `score` into a per-class
 * quality EMA (`controller.ts`), sharpening its under-resourced / wasteful
 * signals so the controller sees whether a budget produced GOOD answers, not
 * just how many tokens were spent.
 *
 * Lexicons are English-first (matching cascadeflow). They are isolated here so
 * additional locales can be added without touching the scoring logic. Markers
 * that don't match simply contribute nothing — never a false reject.
 */

import { buildAnywhereMatcher } from '../../../../lib/shared/text-matching';
import type { QualityComplexity, QualityThresholds } from './thresholds';

// Soft uncertainty — acceptable in moderation, penalized in excess.
const HEDGING_PHRASES = [
  'might',
  'may',
  'could',
  'possibly',
  'perhaps',
  'maybe',
  'likely',
  'probably',
  'generally',
  'usually',
  'typically',
  'seems to',
  'appears to',
  'i think',
  'i believe',
  'in my opinion',
  'arguably',
  'somewhat',
  'to some extent',
  'in some cases',
  'it depends',
];

// Strong uncertainty / refusal — a near-hard fail (the model is punting).
const UNCERTAINTY_MARKERS = [
  "i don't know",
  "i'm not sure",
  'i cannot',
  "i can't",
  'unclear',
  'uncertain',
  'not confident',
  'no information',
  'unable to',
  'cannot provide',
  'insufficient information',
  'i apologize',
  'beyond my knowledge',
  'outside my expertise',
];

// Over-confident filler that often co-occurs with fabrication.
const HALLUCINATION_PATTERNS: RegExp[] = [
  /according to (studies|research|experts) (show|suggest|indicate)/i,
  /it is (well-known|widely accepted|commonly understood) that/i,
  /(exactly|precisely) \d+\.?\d*%/i,
  /(scientists|researchers|experts) (agree|confirm|prove)/i,
];

const VAGUE_PHRASES = [
  'thing',
  'stuff',
  'something',
  'various',
  'many',
  'some',
  'several',
];

const SENTENCE_SPLIT = /[.!?]+/;
const WORD_SPLIT = /\s+/;

type HallucinationRisk = 'low' | 'medium' | 'high';

export interface QualityAnalysis {
  /** Overall quality in [0,1] — higher is better. */
  score: number;
  /** Whether the answer clears the per-complexity confidence threshold. */
  accept: boolean;
  /** Short machine-readable reason for the decision (debug/telemetry). */
  reason: string;
  /** Component signals (telemetry). */
  signals: {
    wordCount: number;
    hedgingRatio: number;
    severeUncertainty: boolean;
    specificity: number;
    hallucinationRisk: HallucinationRisk;
    tooShort: boolean;
    tooLong: boolean;
  };
}

// Word-boundary, longest-first matchers so overlapping forms (e.g. "may"
// inside "maybe", "some" inside "something") are never double-counted the way a
// plain substring `includes` would.
const HEDGING_MATCHER = buildAnywhereMatcher({
  wordTerms: HEDGING_PHRASES,
  substringTerms: [],
  flags: 'giu',
});
const VAGUE_MATCHER = buildAnywhereMatcher({
  wordTerms: VAGUE_PHRASES,
  substringTerms: [],
  flags: 'giu',
});

/** Count DISTINCT phrases (from a matcher) present in `haystack`. */
function countDistinctMatches(matcher: RegExp, haystack: string): number {
  matcher.lastIndex = 0;
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = matcher.exec(haystack)) !== null) {
    seen.add(m[0].toLowerCase());
    if (m[0].length === 0) matcher.lastIndex += 1; // never stall on zero-width
    if (seen.size > 100) break; // pathological-input guard
  }
  return seen.size;
}

function specificityScore(text: string, lower: string): number {
  const hasNumbers = /\d/.test(text);
  const hasExamples = /\b(example|for instance|such as|e\.g\.)\b/i.test(text);
  const hasReferences =
    /\b(according to|research|study|source|documented)\b/i.test(text);
  // CamelCase / TitleCase compound terms are a decent proxy for domain terms.
  const hasTechnicalTerms = /\b[A-Z][a-z]+(?:[A-Z][a-z]+)+\b/.test(text);
  const words = text.split(WORD_SPLIT).filter(Boolean);
  const vagueCount = countDistinctMatches(VAGUE_MATCHER, lower);
  const vaguenessRatio = words.length > 0 ? vagueCount / words.length : 0;
  return Math.max(
    0,
    Math.min(
      1,
      (hasNumbers ? 0.25 : 0) +
        (hasExamples ? 0.2 : 0) +
        (hasReferences ? 0.2 : 0) +
        (hasTechnicalTerms ? 0.2 : 0) +
        Math.max(0, 0.15 - vaguenessRatio),
    ),
  );
}

/**
 * Analyze a response and decide acceptance against the complexity thresholds.
 * `isMathLike` relaxes hedging (calculation prose like "so we have" is not real
 * uncertainty), matching cascadeflow's math leniency.
 */
export function analyzeResponseQuality(input: {
  text: string;
  complexity: QualityComplexity;
  thresholds: QualityThresholds;
  isMathLike?: boolean;
}): QualityAnalysis {
  const { text, complexity, thresholds } = input;
  const lower = text.toLowerCase();
  const words = text.split(WORD_SPLIT).filter(Boolean);
  const wordCount = words.length;
  const sentences = text.split(SENTENCE_SPLIT).filter((s) => s.trim());

  const hedgingCount = countDistinctMatches(HEDGING_MATCHER, lower);
  const hedgingRatio =
    sentences.length > 0 ? hedgingCount / sentences.length : 0;
  const severeUncertainty = UNCERTAINTY_MARKERS.some((m) => lower.includes(m));

  const specificity = specificityScore(text, lower);

  const hallucinationHits = HALLUCINATION_PATTERNS.filter((pattern) =>
    pattern.test(text),
  ).length;
  const hallucinationRisk: HallucinationRisk =
    hallucinationHits >= 2
      ? 'high'
      : hallucinationHits === 1
        ? 'medium'
        : 'low';

  const minWords = thresholds.minWords[complexity];
  const maxWords = thresholds.maxWords[complexity];
  const tooShort = wordCount < minWords * 0.5;
  const tooLong = wordCount > maxWords * 3;

  const hedgingCeiling = input.isMathLike
    ? Math.max(thresholds.maxHedgingRatio, 0.5)
    : thresholds.maxHedgingRatio;
  const minSpecificity = thresholds.minSpecificity[complexity];
  const overHedged = hedgingRatio > hedgingCeiling;
  const underSpecific = specificity < minSpecificity;

  // Compose the score: start perfect, subtract penalties.
  let score = 1;
  if (severeUncertainty && !input.isMathLike) score -= 0.5;
  if (overHedged) score -= 0.25;
  if (underSpecific) score -= 0.2;
  if (hallucinationRisk === 'high') score -= 0.3;
  else if (hallucinationRisk === 'medium') score -= 0.15;
  if (tooShort) score -= 0.3;
  if (tooLong) score -= 0.1;
  score = Math.max(0, Math.min(1, score));

  const threshold = thresholds.confidence[complexity];
  // A severe refusal is a hard fail regardless of score (unless math with an
  // actual answer, handled by skipping the severe penalty above).
  const hardFail = severeUncertainty && !input.isMathLike;
  const accept = !hardFail && score >= threshold;

  const reason = hardFail
    ? 'severe-uncertainty'
    : accept
      ? 'accepted'
      : tooShort
        ? 'too-short'
        : underSpecific
          ? 'low-specificity'
          : overHedged
            ? 'excessive-hedging'
            : 'below-threshold';

  return {
    score,
    accept,
    reason,
    signals: {
      wordCount,
      hedgingRatio,
      severeUncertainty,
      specificity,
      hallucinationRisk,
      tooShort,
      tooLong,
    },
  };
}
