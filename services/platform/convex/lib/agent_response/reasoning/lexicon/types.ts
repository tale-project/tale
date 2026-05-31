/**
 * Multilingual lexicon for the difficulty prior — structured after the PII
 * library's locale registry (`lib/pii/locales/`): one typed config per locale,
 * collected into a registry, then composed into a single cached matcher per
 * category (the union across every locale, longest-first). Adding a language is
 * a data edit, not a detector change.
 *
 * Language-dependent intent cues live here; the structural signals in
 * `signals.ts` (length, code density, math, tables, enumeration, retrieval,
 * agentic shape) are language-agnostic and cover every locale regardless.
 */

/**
 * How keyword boundaries are enforced for a locale's script:
 *  - `word`      → space/punctuation-separated scripts (Latin, Cyrillic,
 *                  Greek): matched with Unicode word boundaries.
 *  - `substring` → scripts without spaces between words (CJK): matched as
 *                  substrings, since `\b`-style boundaries don't apply.
 */
export type BoundaryMode = 'word' | 'substring';

export interface ReasoningLexicon {
  /** BCP-47 code (`en`, `de`, `zh-Hans`). */
  locale: string;
  /** Human-readable English name. */
  name: string;
  boundaryMode: BoundaryMode;
  /** Verbs/phrases signaling hard, deliberation-heavy work (raise reasoning). */
  hardVerbs: string[];
  /** Verbs signaling mechanical, low-reasoning transforms (lower reasoning). */
  easyVerbs: string[];
  /** Short greetings / acknowledgements (a whole trivial message). */
  trivialAcks: string[];
  /** Open-ended / generative intent (raises temperature). */
  creativeVerbs: string[];
  /** Precise / deterministic intent (lowers temperature). */
  analyticalVerbs: string[];
}
