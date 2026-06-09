/**
 * Lexicon registry — composes the per-locale keyword lists in `./data` into one
 * cached matcher per intent category (the union across every locale), exactly
 * like the PII library composes a keyword alternation across enabled locales.
 *
 * Boundary handling is script-aware: `word`-mode locales (Latin / Cyrillic /
 * Greek) are matched with Unicode word boundaries so `optimize` doesn't fire
 * inside `optimizer`; `substring`-mode locales (CJK) match raw, since those
 * scripts don't separate words with spaces. Matchers are built lazily and
 * cached — the regexes carry no `g` flag, so reusing them across `.test()`
 * calls is stateless and safe.
 */

import {
  buildAnywhereMatcher,
  buildWholeMessageMatcher,
  countMatches,
} from '../../../../../lib/shared/text-matching';
import { ALL_LEXICONS } from './data';
import type { ReasoningLexicon } from './types';

type Category =
  | 'hardVerbs'
  | 'easyVerbs'
  | 'creativeVerbs'
  | 'analyticalVerbs'
  | 'trivialAcks';

function termsFor(
  category: Category,
  mode: ReasoningLexicon['boundaryMode'],
): string[] {
  const out: string[] = [];
  for (const lex of ALL_LEXICONS) {
    if (lex.boundaryMode === mode) out.push(...lex[category]);
  }
  return out;
}

/**
 * "Match anywhere in the text" matcher: word-mode terms are wrapped in Unicode
 * word boundaries; substring-mode (CJK) terms match raw. Built via the shared
 * matcher utility so the lexicon and domain detection stay in lockstep.
 */
function buildAnywhere(category: Category): RegExp {
  return buildAnywhereMatcher({
    wordTerms: termsFor(category, 'word'),
    substringTerms: termsFor(category, 'substring'),
  });
}

/** Whole-message matcher for trivial acks (the entire message is just an ack). */
function buildTrivial(): RegExp {
  return buildWholeMessageMatcher({
    wordTerms: termsFor('trivialAcks', 'word'),
    substringTerms: termsFor('trivialAcks', 'substring'),
  });
}

interface Matchers {
  hard: RegExp;
  easy: RegExp;
  creative: RegExp;
  analytical: RegExp;
  trivial: RegExp;
}

let cache: Matchers | null = null;

function matchers(): Matchers {
  if (cache) return cache;
  cache = {
    hard: buildAnywhere('hardVerbs'),
    easy: buildAnywhere('easyVerbs'),
    creative: buildAnywhere('creativeVerbs'),
    analytical: buildAnywhere('analyticalVerbs'),
    trivial: buildTrivial(),
  };
  return cache;
}

/** True if the text contains a hard, deliberation-heavy intent in any locale. */
export function matchesHardVerb(text: string): boolean {
  return matchers().hard.test(text);
}

/** True if the text contains a mechanical, low-reasoning intent in any locale. */
export function matchesEasyVerb(text: string): boolean {
  return matchers().easy.test(text);
}

/** True if the text contains an open-ended / generative intent in any locale. */
export function matchesCreativeVerb(text: string): boolean {
  return matchers().creative.test(text);
}

/** True if the text contains a precise / deterministic intent in any locale. */
export function matchesAnalyticalVerb(text: string): boolean {
  return matchers().analytical.test(text);
}

/**
 * True if the whole message is a trivial greeting / acknowledgement. Still used
 * by the reasoning governor's difficulty prior ([signals.ts] `W.trivial`) to
 * keep a bare greeting at the lowest reasoning budget — NOT a routing fast-path
 * (that small-talk gate was removed).
 */
export function matchesTrivialAck(text: string): boolean {
  return matchers().trivial.test(text);
}

// Graded intent: COUNT matches (not just presence) so two hard verbs read as a
// stronger signal than one. Separate `g`-flagged clones — the stateless
// `matches*` regexes deliberately carry no `g` flag (see the file header), so
// we cannot reuse them for counting without corrupting `lastIndex`.
interface Counters {
  hard: RegExp;
  easy: RegExp;
  creative: RegExp;
}
let gCache: Counters | null = null;
function counters(): Counters {
  if (gCache) return gCache;
  const withG = (r: RegExp): RegExp =>
    r.flags.includes('g') ? r : new RegExp(r.source, `${r.flags}g`);
  const m = matchers();
  gCache = {
    hard: withG(m.hard),
    easy: withG(m.easy),
    creative: withG(m.creative),
  };
  return gCache;
}

/** Count of hard, deliberation-heavy intent cues across all locales. */
export function countHardVerbs(text: string): number {
  return countMatches(counters().hard, text);
}

/** Count of mechanical, low-reasoning intent cues across all locales. */
export function countEasyVerbs(text: string): number {
  return countMatches(counters().easy, text);
}

/** Count of open-ended / generative intent cues across all locales. */
export function countCreativeVerbs(text: string): number {
  return countMatches(counters().creative, text);
}
