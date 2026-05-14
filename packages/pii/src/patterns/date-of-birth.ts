/**
 * Date-of-birth detection — multi-separator, multi-ordering.
 *
 * Detection strategy
 *   - Three orderings: DMY (DE/FR/most-EU), MDY (US), YMD (ISO/JP/KR).
 *   - Separators: `.`, `/`, `-`.
 *
 * Trailing context
 *   - `(?=[T\s,;.]|$|[^\w])` — accepts an ISO timestamp continuation
 *     (`1990-01-02T03:04:05Z`), end-of-string, or any non-word char. The
 *     original `\b` failed at digit→letter (`2|T`), leaving the date
 *     portion of an ISO timestamp unmasked.
 *
 * Accepted false negatives
 *   - Locale-spelled dates (`January 1, 1990`, `1er janvier 1990`). The
 *     pattern is purely numeric. Locale-spelled dates appear in the
 *     per-locale fixture generator's negative pool, which is fine — we'd
 *     rather miss them than chase 50 locale-specific month-name regexes.
 *
 * Locale awareness
 *   - None. The regex is purely numeric. Locale-spelled dates are out of
 *     scope and stay in the negatives corpus.
 */

import type { PiiPattern, PiiPatternFactory } from '../core/types';

const PATTERN: PiiPattern = {
  name: 'dateOfBirth',
  regex:
    /(?<!\w)(?:\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}[./-]\d{1,2}[./-]\d{1,2})(?=[T\s,;.]|$|[^\w])/g,
  replacement: '[DATE_OF_BIRTH]',
};

export const dateOfBirthFactory: PiiPatternFactory = () => [PATTERN];
