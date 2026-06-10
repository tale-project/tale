/**
 * Types for the centralized prompt registry.
 *
 * Every LLM prompt that used to be hardcoded in a feature module lives here as
 * a typed `PromptEntry`. Entries are PURE string literals (+ optional per-locale
 * variants) with declared placeholders — no imports from feature modules, so the
 * dependency graph stays a strict DAG (feature → registry → entries/substitute).
 */

/**
 * Locales the registry ships localized variants for. Mirrors the UI-supported
 * locale set; `en` is always required so the fallback chain terminates.
 *
 * NOTE: distinct from `SUPPORTED_DATASET_LOCALES` (the 43-locale dataset set) —
 * prompts are author-maintained UI copy, not detection datasets.
 */
export type PromptLocale = 'en' | 'de' | 'fr';

/** Per-locale string map; `en` required, others optional. */
export type LocalizedVariants = { en: string } & Partial<
  Record<PromptLocale, string>
>;

export interface PromptEntry {
  /** Stable, namespaced id (e.g. `system.untrusted_content`). Never change once shipped. */
  readonly key: string;
  /** Single template. Mutually exclusive with `localized`. */
  readonly template?: string;
  /** Localized variants. Mutually exclusive with `template`. */
  readonly localized?: LocalizedVariants;
  /** Placeholder names (without braces) that MUST be supplied at render time. */
  readonly required?: readonly string[];
  /** Placeholder names that MAY be supplied; absent → empty string (not an error). */
  readonly optional?: readonly string[];
  /** Free-form provenance: `file:symbol` where this prompt is used. Doc only. */
  readonly usedBy: readonly string[];
}

export interface RenderOptions {
  /** BCP-47 tag; resolved via direct → narrowed base → `en`. */
  locale?: string;
  /**
   * Policy for required placeholders absent from `vars`.
   * `'throw'` (default) raises; `'warn'` logs and leaves the marker intact.
   */
  onMissing?: 'throw' | 'warn';
}
