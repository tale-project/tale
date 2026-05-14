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
 *   - The leading `\b` boundary prevents matches inside longer digit runs
 *     (`X-123-45-6789` inside an order ID, for example).
 *
 * Accepted false negatives
 *   - Bare 9-digit SSNs — see note above.
 *   - SSA-invalid groups (`000-…`, `666-…`, `9NN-…`) are still masked.
 *     We treat any well-formed SSN-shaped string as PII risk; the SSA's
 *     validity rules exist to catch fraud, not to certify a string
 *     ISN'T a real SSN.
 *
 * Locale awareness
 *   - Format is US-specific but the pattern is purely numeric, so it is
 *     safe to enable in any locale set. The factory ignores `locales`.
 */

import type { PiiPattern, PiiPatternFactory } from '../core/types';

const PATTERN: PiiPattern = {
  name: 'ssn',
  regex: /\b\d{3}-\d{2}-\d{4}\b/g,
  replacement: '[SSN]',
};

export const ssnFactory: PiiPatternFactory = () => [PATTERN];
