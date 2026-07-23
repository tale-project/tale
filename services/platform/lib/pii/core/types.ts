/**
 * Engine-facing types for the pii library. The data-file shapes
 * (`LocaleConfig`, `PiiPatternFile`) live in `../schema.ts` as Zod
 * inferences; this module holds the runtime pattern contract the detector
 * executes.
 */

import type { LocaleConfig } from '../schema';

/**
 * BCP 47 locale code for the locale-aware patterns. Deliberately open
 * (`string`, not a closed union) so adding a locale dataset is never a
 * breaking type change; unknown codes fail at runtime resolution.
 */
export type LocaleCode = string;

/**
 * One span of detected PII. Offsets are UTF-16 code units against the
 * NFC-normalized input (`String.prototype.slice` semantics).
 */
export interface PiiMatchSpan {
  start: number;
  end: number;
  matchedText: string;
}

/** A span enriched with its pattern's name and replacement token. */
export interface PiiMatch {
  patternName: string;
  start: number;
  end: number;
  matchedText: string;
  replacement: string;
}

/**
 * A runtime pattern, discriminated so no value can carry both `regex` and
 * `detect`:
 *
 *  - `PiiPatternRegex`: classical shape, executed under the wall-clock
 *    budget. The optional `validate` post-filter accepts or rejects each
 *    candidate (Luhn, mod-97, checksum math) — it eliminates false-positive
 *    classes pure regex cannot.
 *  - `PiiPatternDetect`: function shape for libraries with their own
 *    scanner (libphonenumber). Owns its own performance contract, so the
 *    regex budget does not apply.
 *
 * `regex` stays optional on the regex variant so the detector's defensive
 * log-and-skip branch narrows cleanly; the discriminator is `detect`, not
 * `regex` presence. `validate` runs inside a try/catch in the detector — a
 * thrown exception never carries matched text into a log line.
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
 * Pattern factory — every registered pattern is a factory from the enabled
 * locale set to the patterns it contributes:
 *
 *  - universal patterns (email, iban, …) ignore `locales`, return one;
 *  - locale-composed patterns (phone, cvc, address, dateOfBirth) build
 *    their regex from the union of the locale vocabularies, return one or
 *    a few;
 *  - per-spec patterns (nationalId) return one pattern per locale spec.
 *
 * `[]` is a valid result: "nothing to contribute for this locale set".
 */
export type PiiPatternFactory = (
  locales: ReadonlyArray<LocaleConfig>,
) => PiiPattern[];
