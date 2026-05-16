import type { DriftRule } from '../lib/rules';

/**
 * German bureaucracy anti-patterns — regex-based drift→target rules.
 *
 * Source: `.agents/terminology/TERMINOLOGY_DE.md` §2 anti-patterns 1–3 and
 * §2 anti-pattern 5 (calqued idioms, where doable mechanically).
 *
 * Consumed by `51-voice-de.test.ts`. The strike list in `voice-strike-de.ts`
 * covers term-level softeners; this file covers patterns that need positional
 * context (passive-present openers, sentence-final adverbs, sentence-opening
 * `Damit`).
 *
 * The patterns target prose lines after `iterProseLines` has masked inline
 * code and URLs, so a `Wird` inside a code block won't trip them.
 */

export const VOICE_BUREAUCRACY_DE: readonly DriftRule[] = [
  // Anti-pattern 1 — passive-present openers (`Wird gespeichert…`, etc.).
  // The pattern matches `Wird` at line/sentence start followed by a verb
  // participle. We use `^\s*Wird` to anchor at line start (after prose-line
  // masking, list bullets and headings are blank so this is effectively
  // sentence-start in body prose).
  {
    id: 'de-passive-present',
    pattern: /^\s*Wird\s+\w+/,
    target: 'active form ("Speichert…", "Lädt…", "Erstellt…")',
    locales: ['de', 'de-CH'],
    rationale:
      'passive present hides the agent (the system) — the active form is the bar for UI feedback',
  },

  // Anti-pattern 2 — sentence-final `erfolgreich` on confirmation messages.
  // Match `erfolgreich` followed by a past participle and then end of
  // sentence (`.`, `!`, `?`, or end of line).
  {
    id: 'de-erfolgreich',
    pattern: /\berfolgreich\s+\w+(?:t|en)\b\s*[.!?]?\s*$/,
    target: 'drop "erfolgreich" — the message itself is the success signal',
    locales: ['de', 'de-CH'],
    rationale: 'the toast is the success signal; "erfolgreich" is redundant',
  },

  // Anti-pattern 3 — `Damit` as a sentence opener. Line-initial only;
  // sentence-internal `damit` (subordinate clause) is legal.
  {
    id: 'de-damit-opener',
    pattern: /^\s*Damit\b/,
    target: 'verb-first ("Entfernt …") or "So …" construction',
    locales: ['de', 'de-CH'],
    rationale:
      "translator's tic — verb-first reads native and matches the imperative voice",
  },

  // Anti-pattern 5 — calqued English idioms. The most common literal
  // calques caught by regex; subtler ones (e.g. `User journey` →
  // `Nutzerreise`) still rely on review.
  {
    id: 'de-calque-in-der-schleife',
    pattern: /\bin\s+der\s+Schleife\b/i,
    target: '"eingebunden" — the idiom is "in the loop"',
    locales: ['de', 'de-CH'],
    rationale: 'literal English calque',
  },
  {
    id: 'de-calque-aus-der-box',
    pattern: /\baus\s+der\s+Box\b/i,
    target: '"sofort einsatzbereit"',
    locales: ['de', 'de-CH'],
    rationale: 'literal English calque ("out of the box")',
  },
];
