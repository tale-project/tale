/**
 * French patterns config — formal-pronoun denylist + status chatter.
 */

import type { LocalePatternsConfig } from '../types';

export const PATTERNS_FR: LocalePatternsConfig = {
  formalPronouns: [
    /\bvous\b/g,
    /\bvotre\b/g,
    /\bvos\b/g,
    /\bVous\b/g,
    /\bVotre\b/g,
    /\bVos\b/g,
  ],
  statusChatter: [
    /^\s*Mis\s+à\s+jour:\s*/i,
    /^\s*Bientôt\s+disponible:?\s*/i,
    /^\s*À\s+noter\b/i,
  ],
};
