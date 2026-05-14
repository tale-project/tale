/**
 * Credit-card-number detection — wide-net regex + Luhn validator.
 *
 * Detection strategy
 *   - Regex casts a wide net: 13-19 digit runs allowing single spaces or
 *     hyphens between groups. The `validator/lib/isCreditCard` post-filter
 *     applies Luhn (mod-10) so non-card numeric strings are rejected.
 *
 * Regex anchors
 *   - `(?<!\d)` / `(?!\d)` — boundary on a non-digit, not `\b`. `\b` is a
 *     transition between word and non-word chars; consecutive digit runs
 *     separated by a hyphen are word-on-both-sides, so `\b` does not fire
 *     there. Negative lookarounds catch that.
 *   - Last character must be a digit (not a separator). Without that,
 *     `(?:\d[ -]?){N}` greedily consumes a trailing space and shifts the
 *     splice into the next match, eating the next replacement token.
 *     (#1618.)
 *
 * Filtered false positives
 *   - Order IDs, tracking numbers, ISBNs (which have their own check
 *     digit but not Luhn). The Luhn validator catches these.
 *
 * Accepted false negatives
 *   - 19-digit cards (some private-label) are caught only when they pass
 *     Luhn. Raising the cap would invite OCR-corrupted runs of digits.
 *
 * Locale awareness
 *   - None. Card numbering is an industry standard, not language-specific.
 */

import isCreditCard from 'validator/lib/isCreditCard';

import type { PiiPattern, PiiPatternFactory } from '../core/types';

const PATTERN: PiiPattern = {
  name: 'creditCard',
  regex: /(?<!\d)\d(?:[ -]?\d){12,18}(?!\d)/g,
  validate: (m) => {
    try {
      return isCreditCard(m.replace(/[\s-]/g, ''));
    } catch {
      return false;
    }
  },
  replacement: '[CREDIT_CARD]',
};

export const creditCardFactory: PiiPatternFactory = () => [PATTERN];
