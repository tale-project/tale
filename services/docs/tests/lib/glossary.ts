import fs from 'node:fs';

import { GLOSSARY_PATH } from './paths';

/**
 * Glossary loader + term accessors.
 *
 * Single owner of:
 *   - JSON file parsing (`loadGlossary`, cached after first read)
 *   - The `Term` and `Category` types
 *   - Locale fallback (`de_ch → de → en`, `fr → en`)
 *   - The `_lintExclude` interpretation
 *   - The set of categories the terminology test enforces
 *
 * Everything terminology-related goes through this module so a glossary
 * schema change touches one file, not five.
 */

export type Category =
  | 'brand'
  | 'acronym'
  | 'codeIdentifier'
  | 'role'
  | 'feature'
  | 'knowledgeEntity'
  | 'technicalVocab'
  | 'actionVerb'
  | 'deploymentVocab'
  | 'loanword'
  | 'gitDomain'
  | 'translateBucket'
  | 'abbreviation';

export interface Term {
  key: string;
  category: Category;
  en: string;
  de?: string;
  fr?: string;
  de_ch?: string;
  /** Plural form, if the term gets pluralised in docs. The glossary audit
   *  populates these for `translateBucket` and `feature` entries that need
   *  them. Absent entries don't get plural enforcement. */
  pluralEn?: string;
  pluralDe?: string;
  pluralFr?: string;
  /** Locales for which the terminology test should NOT flag the English form
   *  as drift. Use sparingly — the only legitimate reason is genuine
   *  ambiguity (e.g. `Editor` in DE: also names the IDE/workflow editor in
   *  technical contexts, so blanket-flagging produces false positives). */
  _lintExclude?: string[];
  _note?: string;
}

export interface Glossary {
  terms: Term[];
}

/**
 * Categories whose EN→native gap is enforced by `41-terminology-ui`. Other
 * categories are documented in the glossary but not flagged:
 *
 *   - `brand`, `acronym`, `codeIdentifier`, `loanword`, `gitDomain` —
 *     intentionally kept English in DE/FR.
 *   - `actionVerb`, `technicalVocab`, `deploymentVocab`, `abbreviation` —
 *     soft rules with context-dependent exceptions (`AI`/`KI`, `e.g.`/`z. B.`,
 *     `Save` as a button label).
 *
 * Adding a category here makes the terminology test strictly enforce its
 * `de`/`fr` form against the English form in translated prose.
 */
export const ENFORCED_CATEGORIES: ReadonlySet<Category> = new Set<Category>([
  'feature',
  'role',
  'knowledgeEntity',
  'translateBucket',
]);

let cached: Glossary | null = null;

/** Read and cache `GLOSSARY.json`. Cached for the lifetime of the vitest run
 *  — terms don't change mid-suite. */
export function loadGlossary(): Glossary {
  if (cached) return cached;
  cached = JSON.parse(fs.readFileSync(GLOSSARY_PATH, 'utf8')) as Glossary;
  return cached;
}

/**
 * Resolve the form of a term for a given locale, applying the fallback chain
 * `de_ch → de → en` and `fr → en`. Locales not in `{en,de,fr,de-CH}` fall back
 * to `term.en`.
 */
export function resolveForm(term: Term, locale: string): string {
  if (locale === 'de-CH' || locale === 'de_ch') {
    return term.de_ch ?? term.de ?? term.en;
  }
  if (locale === 'de') return term.de ?? term.en;
  if (locale === 'fr') return term.fr ?? term.en;
  return term.en;
}

/** Resolve the plural form analogously to `resolveForm`. Returns `undefined`
 *  when the term has no plural declared for that locale — callers skip plural
 *  enforcement in that case. */
export function resolvePlural(term: Term, locale: string): string | undefined {
  if (locale === 'de' || locale === 'de-CH') return term.pluralDe;
  if (locale === 'fr') return term.pluralFr;
  return term.pluralEn;
}

/** Every term whose `category` matches. */
export function termsByCategory(category: Category): Term[] {
  return loadGlossary().terms.filter((t) => t.category === category);
}

/**
 * Should the EN→native drift be enforced for this term in this locale?
 *
 * Three gates:
 *   1. The locale form must differ from the English form (otherwise the
 *      term is a loanword in this locale and the EN form is correct).
 *   2. The category must be in `ENFORCED_CATEGORIES`.
 *   3. `_lintExclude` must not list this locale.
 */
export function shouldEnforce(term: Term, locale: string): boolean {
  if (!ENFORCED_CATEGORIES.has(term.category)) return false;
  const native = resolveForm(term, locale);
  if (native === term.en) return false;
  const excludeKey = locale === 'de-CH' ? 'de' : locale;
  if (term._lintExclude?.includes(excludeKey)) return false;
  return true;
}

/**
 * Heuristic: is this position likely the start of a sentence?
 *
 * Used by `40-terminology-pronouns` to allow capitalised `Sie` at sentence
 * start (where it's almost always the third-person plural, not the formal
 * pronoun). The check looks at the characters preceding the match — if the
 * preceding non-whitespace char is sentence-final punctuation or there's
 * nothing before the match, we treat it as sentence-initial.
 */
export function isCapitalisedSentenceStart(
  line: string,
  index: number,
): boolean {
  if (index === 0) return true;
  const before = line.slice(0, index).trimEnd();
  if (before.length === 0) return true;
  const last = before[before.length - 1];
  return (
    last === '.' || last === '!' || last === '?' || last === ':' || last === '—'
  );
}
