/**
 * Public types for `@tale/pii`.
 *
 * Kept in `core/` rather than co-located with the consumers because every
 * subpath import (`engine/`, `patterns/`, `locales/`) depends on them.
 *
 * `LocaleConfig` is imported from `../locales/types` — that module has no
 * imports of its own, so the dependency is one-directional: locales/types
 * → core/types → engine/patterns. No circular risk.
 */

import type { LocaleConfig } from '../locales/types';

/**
 * BCP 47 locale code for opt-in address / national-ID detection. The
 * library ships 50 locales; users may pass any subset. `'*'` means "every
 * locale the library knows about".
 *
 * The string is intentionally typed loosely as `string` rather than a
 * closed union — adding the 51st locale should not be a breaking change
 * for downstream consumers' type checks. Runtime validation rejects
 * unknown codes via `loadLocale`.
 */
export type LocaleCode = string;

/**
 * One span of detected PII inside the input text.
 *
 * `start` / `end` are UTF-16 code-unit offsets, matching `String.prototype.slice`
 * semantics. They are computed against the NFC-normalized input (see
 * `core/normalize.ts`); callers that need byte offsets against the original
 * pre-normalization text must track that mapping themselves.
 */
export interface PiiMatchSpan {
  start: number;
  end: number;
  matchedText: string;
}

/**
 * A detected match enriched with the originating pattern's name and
 * replacement token. Returned by `detectPii` and consumed by `maskPii`.
 */
export interface PiiMatch {
  patternName: string;
  start: number;
  end: number;
  matchedText: string;
  replacement: string;
}

/**
 * A pattern definition. Exactly one of `regex` or `detect` must be set:
 *
 *   - `regex` only: classical pattern, runs under `execWithBudget`.
 *   - `regex` + `validate`: regex finds candidates, post-filter accepts
 *     or rejects each one (used for IBAN mod-97, credit-card Luhn,
 *     national-ID check digits — eliminates whole classes of false
 *     positive that pure regex cannot).
 *   - `detect`: function form for libraries with their own scanner
 *     (`libphonenumber-js`). Skips `execWithBudget` because the library
 *     owns its own performance contract.
 *
 * `validate` is wrapped in try/catch inside the detector: a thrown
 * exception never propagates matched text into the log line (GDPR — only
 * pattern name and `err.name` are logged).
 */
export interface PiiPattern {
  name: string;
  replacement: string;
  regex?: RegExp;
  validate?: (matchedText: string) => boolean;
  detect?: (text: string) => PiiMatchSpan[];
}

/**
 * Pattern factory.
 *
 * Every built-in pattern is exposed as a factory rather than a static
 * `PiiPattern`. A factory takes the enabled-locale set and returns the
 * `PiiPattern`s that pattern contributes:
 *
 *   - Universal patterns (email, SSN, IBAN, IP, credit card, DOB)
 *     ignore `locales` and return `[onePattern]`.
 *   - Locale-composed patterns (CVC, phone, address) build their regex
 *     from the union of keyword lists across `locales` and return
 *     `[oneComposedPattern]`.
 *   - Per-locale-instance patterns (national-ID) emit one pattern per
 *     locale that declares an ID spec, so the result is `N` patterns.
 *
 * Returning `[]` is valid — it means "this pattern contributes nothing
 * for the current locale selection." For example a `national-id`
 * factory called with `locales` of just `en` (which has no national ID)
 * returns `[]`.
 */
export type PiiPatternFactory = (
  locales: ReadonlyArray<LocaleConfig>,
) => PiiPattern[];
