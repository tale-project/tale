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

import { ALL_LEXICONS } from './data';
import type { ReasoningLexicon } from './types';

type Category =
  | 'hardVerbs'
  | 'easyVerbs'
  | 'creativeVerbs'
  | 'analyticalVerbs'
  | 'trivialAcks';

const NEVER = /(?!)/u;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Longest-first, de-duplicated, escaped alternation source (no flags/anchors). */
function alternation(terms: Iterable<string>): string {
  const merged = new Set<string>();
  for (const t of terms) if (t.length > 0) merged.add(t);
  if (merged.size === 0) return '';
  return [...merged]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join('|');
}

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
 * word boundaries; substring-mode (CJK) terms match raw.
 */
function buildAnywhere(category: Category): RegExp {
  const word = alternation(termsFor(category, 'word'));
  const sub = alternation(termsFor(category, 'substring'));
  const parts: string[] = [];
  if (word) parts.push(`(?<![\\p{L}\\p{N}])(?:${word})(?![\\p{L}\\p{N}])`);
  if (sub) parts.push(`(?:${sub})`);
  if (parts.length === 0) return NEVER;
  return new RegExp(parts.join('|'), 'iu');
}

/** Whole-message matcher for trivial acks (the entire message is just an ack). */
function buildTrivial(): RegExp {
  const all = alternation([
    ...termsFor('trivialAcks', 'word'),
    ...termsFor('trivialAcks', 'substring'),
  ]);
  if (!all) return NEVER;
  return new RegExp(`^[\\s\\p{P}]*(?:${all})[\\s\\p{P}]*$`, 'iu');
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

/** True if the whole message is a trivial greeting / acknowledgement. */
export function matchesTrivialAck(text: string): boolean {
  return matchers().trivial.test(text);
}
