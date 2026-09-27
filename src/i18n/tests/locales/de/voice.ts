/**
 * German voice config — marketing-softener strikes + bureaucracy drift.
 *
 * Migrated from `services/docs/tests/data/voice-strike-de.ts` and
 * `services/docs/tests/data/voice-bureaucracy-de.ts`.
 *
 * The drift `Wird` rule is value-shape-aware (`whole-value`) so legitimate
 * declarative passive (e.g. `Wird verwendet, wenn ...`) doesn't trip the
 * pattern.
 */

import { wordBoundaryDe } from '../../internals/regex';
import type { DriftRule, LocaleVoiceConfig, StrikeEntry } from '../types';

const STRIKES: ReadonlyArray<StrikeEntry> = [
  {
    pattern: wordBoundaryDe('einfach', 'gi'),
    rule: 'de-strike-einfach',
    suggest: 'delete; the demonstration carries it',
    applyTo: ['json', 'markdown'],
  },
  {
    pattern: wordBoundaryDe('ganz einfach', 'gi'),
    rule: 'de-strike-ganz-einfach',
    suggest: 'delete',
    applyTo: ['json', 'markdown'],
  },
  {
    pattern: wordBoundaryDe('mühelos', 'gi'),
    rule: 'de-strike-muehelos',
    suggest: 'delete',
    applyTo: ['json', 'markdown'],
  },
  {
    pattern: wordBoundaryDe('bequem', 'gi'),
    rule: 'de-strike-bequem',
    suggest: 'delete or describe what makes it convenient',
    applyTo: ['json', 'markdown'],
  },
  {
    pattern: wordBoundaryDe('praktisch', 'gi'),
    rule: 'de-strike-praktisch',
    suggest: 'delete',
    applyTo: ['json', 'markdown'],
  },
  {
    pattern: wordBoundaryDe('leistungsstark', 'gi'),
    rule: 'de-strike-leistungsstark',
    suggest: 'replace with a concrete capability',
    applyTo: ['json', 'markdown'],
  },
  {
    pattern: wordBoundaryDe('intuitiv', 'gi'),
    rule: 'de-strike-intuitiv',
    suggest: 'delete; the screenshot shows it',
    applyTo: ['markdown'],
  },
  {
    pattern: wordBoundaryDe('nahtlos', 'gi'),
    rule: 'de-strike-nahtlos',
    suggest: 'describe the missing step',
    applyTo: ['json', 'markdown'],
  },
  {
    pattern: wordBoundaryDe('bitte', 'gi'),
    rule: 'de-strike-bitte',
    suggest: 'delete; imperative does the work',
    applyTo: ['json', 'markdown'],
  },
  {
    pattern: wordBoundaryDe('Entdecke', 'g'),
    rule: 'de-strike-entdecke',
    suggest: 'use "Lies", "Öffne", "Sieh dir ... an"',
    applyTo: ['markdown'],
  },
  {
    pattern: wordBoundaryDe('Entdecken', 'g'),
    rule: 'de-strike-entdecken',
    suggest: 'use "Lies", "Öffne", "Sieh dir ... an"',
    applyTo: ['markdown'],
  },
  {
    pattern: wordBoundaryDe('Erlebe', 'g'),
    rule: 'de-strike-erlebe',
    suggest: 'replace with the concrete action',
    applyTo: ['markdown'],
  },
];

const DRIFT: ReadonlyArray<DriftRule> = [
  {
    // Whole-value passive-present status messages: "Wird gespeichert...".
    // Does NOT fire on declarative passive "Wird verwendet, wenn ...".
    pattern: /^\s*Wird\s+\w+[\s.…!?]*$/,
    rule: 'de-wird-passive',
    suggest: 'use active form ("Speichert...", "Lädt...", "Importiert...")',
    applyTo: ['json', 'markdown'],
    valueShape: 'whole-value',
  },
  {
    pattern: /\berfolgreich\s+\w+(?:t|en)\b\s*[.!?]?\s*$/,
    rule: 'de-erfolgreich-redundant',
    suggest: 'drop "erfolgreich" — toast is the success signal',
    applyTo: ['json', 'markdown'],
  },
  {
    pattern: /^\s*Damit\b/,
    rule: 'de-damit-opener',
    suggest: 'rewrite verb-first',
    applyTo: ['markdown'],
  },
  {
    pattern: /\bin\s+der\s+Schleife\b/i,
    rule: 'de-calque-in-der-schleife',
    suggest: '"eingebunden" — the idiom is "in the loop"',
    applyTo: ['markdown'],
  },
  {
    pattern: /\baus\s+der\s+Box\b/i,
    rule: 'de-calque-aus-der-box',
    suggest: '"sofort einsatzbereit"',
    applyTo: ['markdown'],
  },
];

export const VOICE_DE: LocaleVoiceConfig = { strikes: STRIKES, drift: DRIFT };
