/**
 * Credit-card-number detection — wide-net regex + Luhn validator.
 *
 * Detection strategy
 *   - One pre-compiled regex casts a wide net: 13–19 digit runs allowing
 *     single space, hyphen, or dot separators between digits (common print
 *     form groups cards in 4 / 3-character runs; some European formats use
 *     dots). The post-filter applies the Luhn (mod-10) check after
 *     stripping separators.
 *   - Luhn alone is the gate. We deliberately do NOT enforce the network
 *     IIN (Issuer Identification Number) ranges in the validator — IIN
 *     ranges drift over time (new BIN allocations, the Mastercard 2-series
 *     expansion in 2016, UnionPay's growing footprint), and any string
 *     that passes Luhn at 13–19 digits is suspicious enough to mask. This
 *     mirrors how PCI-DSS DLP scanners behave in the wild.
 *
 * Networks covered by the wide-net regex (informational — Luhn is the
 * actual gate; this list documents the prefixes that, if they pass Luhn
 * at a network-legal length, will be caught):
 *   - Visa            `4`,            lengths 13, 16, 19
 *   - Mastercard      `51–55`, `2221–2720`, length 16
 *   - American Express`34`, `37`,     length 15
 *   - Discover        `6011`, `622126–622925`, `644–649`, `65`, lengths 16–19
 *   - JCB             `3528–3589`,    lengths 16–19
 *   - Diners Club     `300–305`, `309`, `36`, `38`, `39`, lengths 14–19
 *   - UnionPay        `62`, `81`,     lengths 16–19
 *   - Maestro         `50`, `56–58`, `6`, lengths 12–19 (regex floor is 13;
 *                     12-digit Maestros are rare in the wild and the
 *                     false-positive cost of a 12-digit Luhn-valid run
 *                     outweighs the recall gain)
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
 *   - Pure repeating-digit runs that happen to be Luhn-valid (e.g.
 *     `1111 1111 1111 1118`) are NOT filtered out: those are commonly
 *     used test cards, and a test-card number in user content is still
 *     PII-shaped enough to mask. Filtering them would invite confusion
 *     when real cards happen to have low entropy.
 *
 * Performance
 *   - Regex is a module-level constant; cloned into a per-call instance
 *     by `execWithBudget` to keep `lastIndex` thread-safe.
 *   - Luhn is computed in a single right-to-left pass with no allocations
 *     beyond the stripped digit string. ASCII fast-path on `charCodeAt`
 *     avoids `parseInt` overhead.
 *
 * ReDoS safety
 *   - The single `{12,18}` quantifier on `(?:[ .\-]?\d)` has a bounded upper
 *     limit. The inner group `[ .\-]?\d` matches one optional separator and
 *     exactly one digit — no nested unbounded quantifier, no ambiguous
 *     alternation. Worst case is linear in input length.
 *
 * Accepted false negatives
 *   - 19-digit cards (some private-label) are caught only when they pass
 *     Luhn. Raising the cap would invite OCR-corrupted runs of digits.
 *
 * Locale awareness
 *   - None. Card numbering is an industry standard, not language-specific.
 */

import type { PiiPattern, PiiPatternFactory } from '../core/types';

// Wide-net regex: 13–19 digits with optional single-character separators
// (space, hyphen, or dot) between consecutive digits. The leading `\d` and
// trailing `\d` ensure both ends are digits (not separators).
// Dot separators cover European print formats (e.g. `4111.1111.1111.1111`).
// IP addresses (max 12 digits) fall below the 13-digit floor, and any
// dot-separated digit run that reaches 13+ digits still needs to pass Luhn.
const CREDIT_CARD_REGEX = /(?<!\d)\d(?:[ .\-]?\d){12,18}(?!\d)/g;

const CHAR_CODE_ZERO = 48;
const CHAR_CODE_NINE = 57;

/**
 * Luhn (mod-10) check on a digit-only ASCII string. No allocations,
 * no `parseInt`. Returns false on any non-digit byte so the caller can
 * be lazy about pre-validating the input.
 *
 * Algorithm: walk right-to-left. Every second digit (the ones in even
 * positions counting from the right, i.e. 0-indexed odd indices when the
 * rightmost is index 0) is doubled; if the doubled value exceeds 9,
 * subtract 9 (equivalent to summing its decimal digits). The total must
 * be divisible by 10.
 */
function luhn(digits: string): boolean {
  let sum = 0;
  let doubleIt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    const code = digits.charCodeAt(i);
    if (code < CHAR_CODE_ZERO || code > CHAR_CODE_NINE) return false;
    let value = code - CHAR_CODE_ZERO;
    if (doubleIt) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    doubleIt = !doubleIt;
  }
  return sum > 0 && sum % 10 === 0;
}

/**
 * Strip space, hyphen, and dot separators in a single pass using an
 * array + join approach. Avoids building a string by repeated
 * concatenation (which creates many intermediate strings in V8).
 */
function stripSeparators(s: string): string {
  // Most matches contain no separators at all — fast-path that case.
  if (s.indexOf(' ') === -1 && s.indexOf('-') === -1 && s.indexOf('.') === -1)
    return s;
  const parts: string[] = [];
  let start = 0;
  for (let i = 0; i <= s.length; i++) {
    if (
      i === s.length ||
      s.charCodeAt(i) === 32 || // space
      s.charCodeAt(i) === 45 || // hyphen
      s.charCodeAt(i) === 46 // dot
    ) {
      if (i > start) parts.push(s.slice(start, i));
      start = i + 1;
    }
  }
  return parts.join('');
}

const PATTERN: PiiPattern = {
  name: 'creditCard',
  regex: CREDIT_CARD_REGEX,
  validate: (m) => {
    const digits = stripSeparators(m);
    // Re-check length after separator strip: the regex permits 13–19
    // digit *positions* but a malformed input like `1-2-3-…` could slip
    // through if separators were ever counted. Belt-and-braces.
    if (digits.length < 13 || digits.length > 19) return false;
    return luhn(digits);
  },
  replacement: '[CREDIT_CARD]',
};

export const creditCardFactory: PiiPatternFactory = () => [PATTERN];
