/**
 * US Social Security Number detection.
 *
 * Detection strategy
 *   - Strict `NNN-NN-NNNN` form only. The "no separators" form
 *     (`123456789`) is intentionally NOT detected: too many non-SSN
 *     cousins (order IDs, phone numbers without separators, timestamps)
 *     for blanket masking to be safe.
 *
 * Filtered false positives
 *   - Unicode-aware negative lookarounds on both sides reject the
 *     SSN-shaped digit run when it sits inside a longer alphanumeric
 *     identifier (`Order-123-45-6789`, `Müller-123-45-6789`). `\b`
 *     alone is not enough because the word-boundary still fires on
 *     `r|-`, letting the SSN through.
 *
 * Accepted false negatives
 *   - Bare 9-digit SSNs — see note above.
 *   - SSA-invalid groups (`000-…`, `666-…`, `9NN-…`) are rejected by
 *     the `validate` function. Area 000, 666, and 900-999 are never
 *     assigned; group 00 and serial 0000 are likewise invalid. Filtering
 *     these out reduces false positives from sequences like `000-12-3456`
 *     or `999-99-9999` which cannot be real SSNs.
 *
 * Locale awareness
 *   - Format is US-specific but the pattern is purely numeric, so it is
 *     safe to enable in any locale set. The factory ignores `locales`.
 */

import type { PiiPattern, PiiPatternFactory } from '../core/types';

// Tightened from `\b` to Unicode-property negative lookarounds. `\p{L}`
// requires the `u` flag. Rejects matches abutting a hyphen, digit, or
// any-script letter on either side, so `A-123-45-6789` and
// `Order-123-45-6789` no longer false-positive while well-formed
// `NNN-NN-NNNN` SSNs still match.
const PATTERN: PiiPattern = {
  name: 'ssn',
  regex: /(?<![\d\p{L}-])\d{3}-\d{2}-\d{4}(?![\d\p{L}-])/gu,
  validate: (m: string) => {
    const area = parseInt(m.slice(0, 3), 10);
    const group = parseInt(m.slice(4, 6), 10);
    const serial = parseInt(m.slice(7, 11), 10);
    if (area === 0 || area === 666 || area >= 900) return false;
    if (group === 0) return false;
    if (serial === 0) return false;
    return true;
  },
  replacement: '[SSN]',
};

export const ssnFactory: PiiPatternFactory = () => [PATTERN];
