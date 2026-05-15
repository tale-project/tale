/**
 * Email-address detection.
 *
 * Detection strategy
 *   - Single regex, no validator. Email syntax has many edge cases (RFC
 *     5322 is famously permissive), but for PII redaction we want the
 *     pragmatic subset that covers virtually every real address: standard
 *     `local@host.tld` form with the common local-part character class and
 *     a TLD of two or more alphabetic characters.
 *
 * Filtered false positives
 *   - Trailing punctuation is naturally excluded by the regex's terminal
 *     `[a-zA-Z]{2,}` (a period or comma after the TLD won't be captured).
 *
 * Accepted false negatives
 *   - Punycode (`xn--…`) and IDNA addresses: rare in user input that
 *     reaches a Latin-script chat, and we'd rather miss them than chase
 *     RFC compliance into a ReDoS-prone monster regex.
 *   - Quoted-string local parts (`"a b"@example.com`): explicitly out of
 *     scope; almost never seen outside automated mail systems.
 *
 * Locale awareness
 *   - None. Email syntax is locale-independent. The factory ignores its
 *     `locales` argument.
 */

import type { PiiPattern, PiiPatternFactory } from '../core/types';

const PATTERN: PiiPattern = {
  name: 'email',
  regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  validate: (m) => {
    const atIdx = m.indexOf('@');
    if (atIdx > 64) return false; // Local part too long (RFC 5321)
    if (m.length - atIdx > 255) return false; // Domain too long
    return true;
  },
  replacement: '[EMAIL]',
};

export const emailFactory: PiiPatternFactory = () => [PATTERN];
