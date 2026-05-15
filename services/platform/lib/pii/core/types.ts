/**
 * Public types for the PII detection library (`@/lib/pii`).
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
 * library ships 43 locales; users may pass any subset. `'*'` means "every
 * locale the library knows about".
 *
 * Typed loosely as `string` rather than a closed union so adding a new
 * locale isn't a breaking change for callers' type checks. Runtime
 * validation rejects unknown codes via `loadLocale`.
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
 * A pattern definition modelled as a discriminated union so consumers
 * cannot construct a pattern carrying both `regex` and `detect`. The
 * `?: never` markers make the discriminator structural — detector.ts
 * can keep its truthiness narrowing (`if (pattern.detect)` then
 * `if (!pattern.regex)`) without changing the algorithm.
 *
 *   - `PiiPatternRegex` (+ optional `validate`): classical pattern, runs
 *     under `execWithBudget`. The optional post-filter accepts or rejects
 *     each candidate (used for IBAN mod-97, credit-card Luhn, national-ID
 *     check digits — eliminates whole classes of false positive that
 *     pure regex cannot).
 *   - `PiiPatternDetect`: function form for libraries with their own
 *     scanner (`libphonenumber-js`). Skips `execWithBudget` because the
 *     library owns its own performance contract.
 *
 * `regex` on `PiiPatternRegex` is intentionally typed as optional so
 * detector.ts's defensive `if (!pattern.regex)` log-and-skip branch
 * still narrows cleanly. Construct sites should always populate it; the
 * shape discriminator is `detect?: never`, not `regex` presence.
 *
 * `validate` is wrapped in try/catch inside the detector: a thrown
 * exception never propagates matched text into the log line (GDPR — only
 * pattern name and `err.name` are logged).
 */
export interface PiiPatternRegex {
  readonly name: string;
  readonly regex?: RegExp;
  readonly validate?: (matchedText: string) => boolean;
  readonly replacement: string;
  readonly detect?: never;
}

export interface PiiPatternDetect {
  readonly name: string;
  readonly detect: (text: string) => PiiMatchSpan[];
  readonly replacement: string;
  readonly regex?: never;
  readonly validate?: never;
}

export type PiiPattern = PiiPatternRegex | PiiPatternDetect;

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
