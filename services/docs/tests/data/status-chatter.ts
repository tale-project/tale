/**
 * Status-chatter prefixes — phrases that belong in release notes or git
 * history, never in docs prose.
 *
 * Source: `.claude/skills/docs/SKILL.md` voice rules and anti-pattern
 * catalogue ("Status Chatter").
 *
 * Consumed by `24-structure-prose.test.ts`. Each entry is a regex that
 * matches the offending opener at the start of a line. Line-anchored on
 * purpose — the test does not flag `Note that` mid-sentence, only as a
 * sentence opener (where it adds nothing).
 */

export const STATUS_CHATTER: ReadonlyArray<{
  id: string;
  pattern: RegExp;
  rationale: string;
}> = [
  {
    id: 'chatter-updated',
    pattern: /^\s*Updated:\s*/i,
    rationale: 'release notes carry version history; git carries the rest',
  },
  {
    id: 'chatter-new-in',
    pattern: /^\s*New\s+in\s+v?[\d.]+:?\s*/i,
    rationale: 'belongs in release notes, not in the page itself',
  },
  {
    id: 'chatter-coming-soon',
    pattern: /^\s*Coming\s+soon:?\s*/i,
    rationale:
      'either it ships and the page documents it, or the page does not exist yet',
  },
  {
    id: 'chatter-todo',
    pattern: /^\s*TODO:?\s*/i,
    rationale: 'incomplete work does not ship to docs',
  },
  {
    id: 'chatter-note-that',
    pattern: /^\s*Note\s+that\b[,.\s]/i,
    rationale: 'softens the assertion — write the assertion directly',
  },
  {
    id: 'chatter-please-note',
    pattern: /^\s*Please\s+note(?:\s+that)?\b[,.\s:]/i,
    rationale: 'softens the assertion — write the assertion directly',
  },
  {
    id: 'chatter-it-should-be-noted',
    pattern: /^\s*It\s+should\s+be\s+noted\b/i,
    rationale: 'bureaucratic softener — strike',
  },
  // German equivalents.
  {
    id: 'chatter-aktualisiert',
    pattern: /^\s*Aktualisiert:\s*/i,
    rationale: 'Release Notes tragen den Versionsverlauf',
  },
  {
    id: 'chatter-bald-verfuegbar',
    pattern: /^\s*Bald\s+verfügbar:?\s*/i,
    rationale: 'either it ships or the page does not exist yet',
  },
  {
    id: 'chatter-beachte',
    pattern: /^\s*Beachte\s+bitte\b/i,
    rationale: 'softener — write the assertion directly',
  },
  // French equivalents.
  {
    id: 'chatter-mis-a-jour',
    pattern: /^\s*Mis\s+à\s+jour:\s*/i,
    rationale: "les notes de version portent l'historique",
  },
  {
    id: 'chatter-bientot-disponible',
    pattern: /^\s*Bientôt\s+disponible:?\s*/i,
    rationale: 'either it ships or the page does not exist yet',
  },
  {
    id: 'chatter-a-noter',
    pattern: /^\s*À\s+noter\b/i,
    rationale: 'softener — write the assertion directly',
  },
];
