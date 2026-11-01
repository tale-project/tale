/**
 * Glossary types and the public handle.
 *
 * The glossary is a flat `terms[]` array of `Term` records. Each term has an
 * `en` form (required) and optional locale forms (`de`, `fr`, `de_CH`). The
 * `category` field is the term's classification — terminology checks group
 * by category to decide which English forms must translate, which stay
 * English, which match the shipped UI label, etc.
 *
 * The handle is the consumer-facing interface: `byCategory`, `resolveForm`
 * (locale-fallback aware), `forLocale` (the same fallback for the
 * per-locale settings `_lintExclude`, `_avoid` and `_allow`), and
 * `shouldEnforce` (honors `_lintExclude`).
 */

/**
 * Term categories. The semantics:
 *
 *   - `brand`            — always English (Tale, Convex, OpenRouter).
 *   - `acronym`          — always English (AI, LLM, API, MCP).
 *   - `codeIdentifier`   — always English (env vars, CLI flags, file paths).
 *   - `role`             — translates per locale (Owner / Inhaber / Propriétaire).
 *   - `feature`          — translates per locale where the UI translates it.
 *   - `knowledgeEntity`  — translates per locale (Document, Conversation).
 *   - `technicalVocab`   — typically translates; a category for non-product
 *                          but project-specific vocabulary.
 *   - `actionVerb`       — typically translates.
 *   - `deploymentVocab`  — typically translates.
 *   - `loanword`         — stays English in DE/FR (Workflow, Dashboard).
 *   - `gitDomain`        — stays English in DE/FR (Pull Request, Merge, Branch).
 *   - `translateBucket`  — MUST translate in DE/FR/de-CH; the test enforces it.
 *   - `abbreviation`     — typically stays English.
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

/**
 * One glossary entry. The settings `_lintExclude`, `_avoid` and `_allow` are
 * keyed by locale id, and `de-CH` follows `de` unless it has an entry of its
 * own (`GlossaryHandle.forLocale`).
 */
export interface Term {
  /** Stable identifier, used for cross-references in `_note` and tests. */
  readonly key: string;
  readonly category: Category;
  /** English form. Required. */
  readonly en: string;
  /** German form. Omit when the term stays English in DE (loanword, etc.). */
  readonly de?: string;
  /** French form. Omit when the term stays English in FR. */
  readonly fr?: string;
  /** Swiss German override. Falls back to `de`, then `en`. */
  readonly de_CH?: string;
  /**
   * Locales for which the terminology checks should NOT flag the EN form.
   * Use sparingly — every `true` is a deliberate decision and should be
   * accompanied by a `_note` explaining why. `'de-CH': false` enforces a
   * term in Swiss German that `de: true` excludes.
   */
  readonly _lintExclude?: Partial<Record<string, boolean>>;
  /**
   * Non-shipped names a locale must not use for this term, such as a
   * lowercase loanword or a retired translation. `terminology-ui-label`
   * reports them case-insensitively in every locale that `_lintExclude`
   * doesn't exclude, also in one that keeps the `en` form (German `Node`
   * avoids `Knoten`). A `*` at either end of a name lets the word go on
   * there, for a compound or an ending: `*knoten*` matches `Agentenknoten`.
   */
  readonly _avoid?: Partial<Record<string, ReadonlyArray<string>>>;
  /**
   * Names that contain the term's `en` form, or an `_avoid` name, yet name
   * something else, such as another vendor's product (`Google Workspace`).
   * `terminology-ui-label` skips a match that lies inside one of them, and
   * still reports the same word anywhere else in that locale's text. A `*`
   * at either end works as in `_avoid`.
   */
  readonly _allow?: Partial<Record<string, ReadonlyArray<string>>>;
  readonly _note?: string;
}

export interface Glossary {
  readonly _note?: string;
  readonly _categories?: Partial<Record<Category, string>>;
  readonly terms: ReadonlyArray<Term>;
}

/** Public glossary handle. Returned by `loadGlossary(path?)`. */
export interface GlossaryHandle {
  readonly all: ReadonlyArray<Term>;
  byCategory(category: Category): ReadonlyArray<Term>;
  /** Resolve `term.<locale>` walking the fallback chain (de-CH → de → en). */
  resolveForm(term: Term, locale: string): string;
  /**
   * Resolve a per-locale setting (`_lintExclude`, `_avoid`, `_allow`) along
   * the same chain: `de-CH` reads the `de` entry unless it has its own. A
   * Swiss string copies a German one (every German string with `ß` needs
   * one), so the German decisions apply to it.
   */
  forLocale<T>(
    setting: Partial<Record<string, T>> | undefined,
    locale: string,
  ): T | undefined;
  /**
   * Returns true if a terminology check should reject the EN form for this
   * locale: the locale form differs from `en` AND the locale's
   * `_lintExclude` entry (through `forLocale`) isn't `true`.
   */
  shouldEnforce(term: Term, locale: string): boolean;
}
