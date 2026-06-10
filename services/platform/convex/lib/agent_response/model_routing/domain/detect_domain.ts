/**
 * Domain detection (pure, zero-IO, multilingual-ready).
 *
 * Scores a user turn against weighted keyword tiers per domain (ported from
 * `old_router/cascadeflow/routing/domain.py`) and returns the top domain plus a
 * normalized confidence. Boundary handling mirrors the reasoning lexicon:
 * word-mode locales use Unicode word boundaries, substring-mode (CJK) match
 * raw. Matchers are built once and cached.
 *
 * Computed once per turn and consumed by both agent routing (a classifier hint
 * + the key for learned routing priors) and model routing (`routingTags`
 * preference + high-stakes frontier bias).
 */

import {
  DEFAULT_DOMAIN,
  domainLiterals,
  type Domain,
} from '../../../../../lib/shared/constants/domains';
import {
  buildAnywhereMatcher,
  countMatches,
} from '../../../../../lib/shared/text-matching';
import { ALL_DOMAIN_LEXICONS } from './data';
import { TIER_WEIGHTS, type KeywordTier } from './types';

const TIERS: KeywordTier[] = ['veryStrong', 'strong', 'moderate', 'weak'];

/** Confidence below this ⇒ no domain is convincing; fall back to `general`. */
const MIN_CONFIDENCE = 0.18;

/** Collect terms for one domain+tier across every locale of a boundary mode. */
function termsFor(
  domain: Domain,
  tier: KeywordTier,
  mode: 'word' | 'substring',
): string[] {
  const out: string[] = [];
  for (const lex of ALL_DOMAIN_LEXICONS) {
    if (lex.boundaryMode !== mode) continue;
    const list = lex.keywords[domain]?.[tier];
    if (list) out.push(...list);
  }
  return out;
}

/**
 * A token that is purely ASCII Latin letters/digits (plus a few separators that
 * appear in tech terms like `npm install` / `c++` / `node.js`) and contains at
 * least one letter. Such a token living in a substring-mode (CJK/Thai) lexicon
 * is the false-positive source: matched raw, `def`/`git`/`roi` fire inside
 * ordinary Latin words. Routed through ASCII word boundaries instead.
 */
function isAsciiLatinToken(term: string): boolean {
  return /^[\x20-\x7e]+$/.test(term) && /[A-Za-z]/.test(term);
}

function buildMatcher(domain: Domain, tier: KeywordTier): RegExp {
  // Substring-mode lexicons match raw (CJK/Thai have no inter-word spaces), but
  // bare Latin tokens embedded in them must not match inside Latin words —
  // promote those to ASCII-boundary matching (still hits CJK-adjacent loanwords
  // like `gitを使う` since CJK chars are not ASCII word chars).
  const substringAll = termsFor(domain, tier, 'substring');
  const asciiBoundaryTerms: string[] = [];
  const substringTerms: string[] = [];
  for (const term of substringAll) {
    (isAsciiLatinToken(term) ? asciiBoundaryTerms : substringTerms).push(term);
  }
  // `g` flag so we can COUNT matches, not just test presence.
  return buildAnywhereMatcher({
    wordTerms: termsFor(domain, tier, 'word'),
    asciiBoundaryTerms,
    substringTerms,
    flags: 'giu',
  });
}

type DomainMatchers = Map<Domain, Partial<Record<KeywordTier, RegExp>>>;

let cache: DomainMatchers | null = null;

function matchers(): DomainMatchers {
  if (cache) return cache;
  const map: DomainMatchers = new Map();
  for (const domain of domainLiterals) {
    if (domain === DEFAULT_DOMAIN) continue; // `general` has no keywords
    const perTier: Partial<Record<KeywordTier, RegExp>> = {};
    for (const tier of TIERS) perTier[tier] = buildMatcher(domain, tier);
    map.set(domain, perTier);
  }
  cache = map;
  return cache;
}

export interface DomainResult {
  domain: Domain;
  /** Normalized confidence in [0,1] of the winning domain. */
  confidence: number;
  /** Raw weighted score per domain (telemetry / tie inspection). */
  scores: Partial<Record<Domain, number>>;
}

/**
 * Detect the most likely topical domain of a user turn. Returns `general` with
 * confidence 0 when nothing scores above `MIN_CONFIDENCE`.
 */
export function detectDomain(text: string): DomainResult {
  const trimmed = text.trim();
  if (!trimmed) {
    return { domain: DEFAULT_DOMAIN, confidence: 0, scores: {} };
  }

  const scores: Partial<Record<Domain, number>> = {};
  let total = 0;
  let topDomain: Domain = DEFAULT_DOMAIN;
  let topScore = 0;

  for (const [domain, perTier] of matchers()) {
    let score = 0;
    for (const tier of TIERS) {
      const re = perTier[tier];
      if (!re) continue;
      score += countMatches(re, trimmed) * TIER_WEIGHTS[tier];
    }
    if (score > 0) {
      scores[domain] = score;
      total += score;
      if (score > topScore) {
        topScore = score;
        topDomain = domain;
      }
    }
  }

  if (topScore === 0) {
    return { domain: DEFAULT_DOMAIN, confidence: 0, scores };
  }
  const confidence = topScore / total;
  if (confidence < MIN_CONFIDENCE) {
    return { domain: DEFAULT_DOMAIN, confidence, scores };
  }
  return { domain: topDomain, confidence, scores };
}
