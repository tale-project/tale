/**
 * Types for the domain-detection lexicon.
 *
 * A domain's keyword list is split into weighted tiers (most→least
 * discriminative), ported from `old_router/cascadeflow/routing/domain.py`.
 * Weights follow the cascadeflow research: very-strong terms are nearly
 * decisive, weak terms barely nudge.
 */

import type { Domain } from '../../../../../lib/shared/constants/domains';

export type KeywordTier = 'veryStrong' | 'strong' | 'moderate' | 'weak';

export const TIER_WEIGHTS: Record<KeywordTier, number> = {
  veryStrong: 1.5,
  strong: 1.0,
  moderate: 0.7,
  weak: 0.3,
};

export interface DomainKeywords {
  veryStrong?: string[];
  strong?: string[];
  moderate?: string[];
  weak?: string[];
}

/** One locale's keyword tables, keyed by domain. */
export interface DomainLexicon {
  locale: string;
  /** CJK locales match raw substrings; Latin/Cyrillic use word boundaries. */
  boundaryMode: 'word' | 'substring';
  keywords: Partial<Record<Domain, DomainKeywords>>;
}
