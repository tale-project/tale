/**
 * IBAN (International Bank Account Number) detection — regex + mod-97 validator.
 *
 * Detection strategy
 *   - Regex matches the structural form: two-letter country code, two
 *     check digits, then 11–30 alphanumeric body characters, with optional
 *     whitespace or hyphens between 4-char groups. `validator/lib/isIBAN`
 *     applies the ISO 13616 mod-97 check after stripping separators.
 *
 * Regex details
 *   - Min 15 chars total (Norway, shortest globally — most are 18+).
 *   - Max 34 chars total (Malta, longest).
 *   - Inner repetition `{1,6}` matches 1–6 four-char groups so 15-char
 *     Norwegian IBANs match cleanly.
 *
 * Locale awareness
 *   - None. IBAN is a global standard; the country prefix is inside the
 *     IBAN itself, not derived from locale.
 */

import isIBAN from 'validator/lib/isIBAN';

import type { PiiPattern, PiiPatternFactory } from '../core/types';

const PATTERN: PiiPattern = {
  name: 'iban',
  regex:
    /\b[A-Z]{2}\d{2}[\s-]?[\dA-Z]{4}(?:[\s-]?[\dA-Z]{4}){1,6}(?:[\s-]?[\dA-Z]{1,4})?\b/g,
  validate: (m) => {
    try {
      return isIBAN(m);
    } catch {
      return false;
    }
  },
  replacement: '[IBAN]',
};

export const ibanFactory: PiiPatternFactory = () => [PATTERN];
