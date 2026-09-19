/**
 * English patterns config.
 *
 * No formal pronouns to deny in English (it's already informal). Status
 * chatter list mirrors the English entries from
 * `services/docs/tests/data/status-chatter.ts`.
 */

import type { LocalePatternsConfig } from '../types';

export const PATTERNS_EN: LocalePatternsConfig = {
  formalPronouns: [],
  statusChatter: [
    /^\s*Updated:\s*/i,
    /^\s*New\s+in\s+v?[\d.]+:?\s*/i,
    /^\s*Coming\s+soon:?\s*/i,
    /^\s*TODO:?\s*/i,
    /^\s*Note\s+that\b[,.\s]/i,
    /^\s*Please\s+note(?:\s+that)?\b[,.\s:]/i,
    /^\s*It\s+should\s+be\s+noted\b/i,
  ],
};
