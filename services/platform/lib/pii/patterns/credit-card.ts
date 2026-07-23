/**
 * Credit card — data regex plus the Luhn (mod-10) gate.
 *
 * The wide-net regex (13–19 digit runs with single space/hyphen/dot
 * separators) lives in the pattern file. Luhn is the whole gate: issuer
 * IIN ranges drift over time (BIN reallocations, the Mastercard 2-series),
 * and any Luhn-valid run at card length is suspicious enough to mask —
 * the posture PCI-DSS DLP scanners take. Luhn-valid test cards are masked
 * on purpose; a test-card number in user content is still PII-shaped.
 */

import type { PiiPattern } from '../core/types';
import type { NativePatternBuilder } from './native';
import { compileRegexKnob } from './native';

const CHAR_CODE_ZERO = 48;
const CHAR_CODE_NINE = 57;

/**
 * Luhn mod-10 over an ASCII digit string: walking right to left, double
 * every second digit (subtracting 9 when the double exceeds 9) and require
 * the sum to be a positive multiple of 10. Returns false on any non-digit
 * byte so callers can skip pre-validation. No allocations.
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

/** Drop space/hyphen/dot separators in one pass; fast path when none. */
function stripSeparators(s: string): string {
  if (!s.includes(' ') && !s.includes('-') && !s.includes('.')) return s;
  const parts: string[] = [];
  let start = 0;
  for (let i = 0; i <= s.length; i++) {
    const code = i === s.length ? -1 : s.charCodeAt(i);
    if (i === s.length || code === 32 || code === 45 || code === 46) {
      if (i > start) parts.push(s.slice(start, i));
      start = i + 1;
    }
  }
  return parts.join('');
}

export const buildCreditCardPattern: NativePatternBuilder = (file) => {
  const regex = compileRegexKnob(file);
  if (!regex) return () => [];
  const pattern: PiiPattern = {
    name: file.name,
    regex,
    validate: (m) => {
      const digits = stripSeparators(m);
      // Re-check length after the strip — belt and braces against a
      // separator-heavy candidate slipping the regex's digit count.
      if (digits.length < 13 || digits.length > 19) return false;
      return luhn(digits);
    },
    replacement: file.replacement,
  };
  return () => [pattern];
};
