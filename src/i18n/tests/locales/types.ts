/**
 * Type surfaces for per-locale data.
 *
 * Every locale folder (`locales/<locale>/`) assembles one `LocaleConfig`
 * out of five concern-specific configs:
 *
 *   - `style`     — quotes, apostrophes, numbers, dates, currency, dashes,
 *                   ß-policy, allowed-bang contexts.
 *   - `voice`     — marketing-softener strikes + drift patterns.
 *   - `terminology` — half-compound denylist + calque list.
 *   - `grammar`   — noun-gender map (DE only today) + indefinite articles.
 *   - `patterns`  — formal pronouns + status chatter + compound-length limit.
 *
 * The data lives co-located with its planted fixtures under `locales/<id>/`.
 * Check modules dispatch through the `LocaleConfig` rather than importing
 * locale-specific files directly, so adding a new locale plugs into every
 * applicable check without touching any check file.
 */

import type { CheckId } from '../config';

// ---------------------------------------------------------------------------
// Style
// ---------------------------------------------------------------------------

export type QuoteKind =
  | 'ascii' // EN: "..."
  | 'german-low9-high9' // DE: „...“
  | 'french-guillemet' // FR: « ... » with NBSP inside
  | 'swiss-guillemet'; // de-CH: «...» (no NBSP requirement)

export interface QuoteConvention {
  readonly kind: QuoteKind;
  readonly open: string;
  readonly close: string;
  /** FR « text » convention; the check inserts NBSP between guillemet and text. */
  readonly nbspInside?: boolean;
}

export interface ApostropheConvention {
  /**
   * Apostrophe used in PROSE (markdown body). FR prose uses U+2019; everyone
   * else uses ASCII. JSON values always use ASCII regardless — JSON escapes
   * otherwise become a tooling burden.
   */
  readonly proseChar: "'" | '’';
  /** Apostrophe used in JSON values and code blocks. Always ASCII. */
  readonly codeChar: "'";
}

export type DateFormat =
  | 'YYYY-MM-DD'
  | 'DD.MM.YYYY'
  | 'DD/MM/YYYY'
  | 'MM/DD/YYYY'
  | 'Month D, YYYY';

export interface DateConvention {
  readonly preferred: DateFormat;
  readonly accept: ReadonlyArray<DateFormat>;
}

export interface NumberConvention {
  readonly decimal: '.' | ',';
  /**
   * Thousands separator. Use `''` for "no separator" (rare).
   * de-CH uses `'` (apostrophe); FR uses ` ` (narrow no-break space).
   */
  readonly thousands: '.' | ',' | "'" | ' ' | ' ' | ' ' | '';
}

export interface CurrencyConvention {
  readonly preferred: 'CHF' | 'EUR' | 'USD' | 'GBP';
  readonly position: 'prefix' | 'suffix';
  /**
   * Optional symbol forms (`€`, `$`, …) the locale also accepts in prose.
   * The check rejects symbols from OTHER locales' lists. Empty for
   * locales that don't care.
   */
  readonly acceptedSymbols: ReadonlyArray<string>;
}

export interface LocaleStyleConfig {
  readonly quotes: QuoteConvention;
  readonly apostrophe: ApostropheConvention;
  readonly numbers: NumberConvention;
  readonly dates: DateConvention;
  readonly currency: CurrencyConvention;
  /** `false` for de-CH (sharp-s is replaced by `ss`); otherwise `true`. */
  readonly allowSharpS: boolean;
  readonly emDash: 'spaced' | 'unspaced';
  readonly enDashForRanges: boolean;
  /** FR: NBSP required before `:;!?%`. Other locales: undefined. */
  readonly nbspBeforePunctuation?: RegExp;
  /** EN-prose: regex contexts where `!` is allowed (e.g. `!important`, `[!NOTE]`). */
  readonly allowedBangContexts?: ReadonlyArray<RegExp>;
}

// ---------------------------------------------------------------------------
// Voice
// ---------------------------------------------------------------------------

export interface StrikeEntry {
  readonly pattern: RegExp;
  /** Stable rule subtag (`de-strike-einfach`, `fr-marketing-decouvrez`). */
  readonly rule: string;
  /** Optional concrete fix hint. */
  readonly suggest?: string;
  /** Surfaces this strike applies to. */
  readonly applyTo: ReadonlyArray<'json' | 'markdown'>;
}

export interface DriftRule {
  readonly pattern: RegExp;
  readonly rule: string;
  readonly suggest?: string;
  readonly applyTo: ReadonlyArray<'json' | 'markdown'>;
  /**
   * If `'whole-value'`, the rule fires only when the entire fragment text
   * matches the pattern. Use for whole-value status messages like
   * `^Wird\s+\w+[\s.…!?]*$` — keeps the rule from firing on legit
   * declarative-passive multi-clause sentences.
   */
  readonly valueShape?: 'whole-value' | 'sentence' | 'phrase';
}

export interface LocaleVoiceConfig {
  readonly strikes: ReadonlyArray<StrikeEntry>;
  readonly drift: ReadonlyArray<DriftRule>;
}

// ---------------------------------------------------------------------------
// Terminology
// ---------------------------------------------------------------------------

export interface HalfCompoundRule {
  readonly pattern: RegExp;
  /** What the writer should have written instead. */
  readonly correct: string;
  readonly rule: string;
}

export interface CalqueEntry {
  readonly word: string;
  readonly target: string;
}

export interface LocaleTerminologyConfig {
  readonly halfCompounds: ReadonlyArray<HalfCompoundRule>;
  readonly calques: ReadonlyArray<CalqueEntry>;
}

// ---------------------------------------------------------------------------
// Grammar
// ---------------------------------------------------------------------------

export type Gender = 'm' | 'f' | 'n';

export interface NounGenderEntry {
  readonly noun: string;
  readonly gender: Gender;
}

export interface IndefiniteArticleForms {
  readonly nom: string;
  readonly acc: string;
  readonly dat: string;
}

export interface LocaleGrammarConfig {
  /** Closed list of high-frequency nouns with their grammatical gender. */
  readonly nounGenders: ReadonlyArray<NounGenderEntry>;
  /** Indefinite-article forms by gender — `m`: ein/einen/einem etc. */
  readonly indefiniteArticles: Record<Gender, IndefiniteArticleForms>;
}

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

export interface LocalePatternsConfig {
  /** Formal-pronoun denylist (`Sie`, `Ihnen`, `vous`, `votre`, …). */
  readonly formalPronouns: ReadonlyArray<RegExp>;
  /** Status-chatter prefixes for this locale. */
  readonly statusChatter: ReadonlyArray<RegExp>;
  /** Soft length cap for single compound words (DE: ~25 chars). */
  readonly maxCompoundLength?: number;
}

// ---------------------------------------------------------------------------
// LocaleConfig
// ---------------------------------------------------------------------------

export interface LocaleConfig {
  /** Stable id matching the locale filename (`en` / `de` / `de-CH`). */
  readonly id: string;
  /** Display name surfaced in failure output. */
  readonly displayName: string;
  /**
   * Fallback chain for terminology + style resolution.
   * `['de-CH', 'de', 'en']` for de-CH; `['de', 'en']` for de; etc.
   */
  readonly fallback: ReadonlyArray<string>;
  /** True for regional locales (sparse override; partial parity). */
  readonly regional: boolean;

  readonly style: LocaleStyleConfig;
  readonly voice: LocaleVoiceConfig;
  readonly terminology: LocaleTerminologyConfig;
  readonly grammar: LocaleGrammarConfig;
  readonly patterns: LocalePatternsConfig;

  /** Pointer to the doctrine file; surfaced in failure messages. */
  readonly doctrine: string;

  /**
   * Optional per-check mode overrides at the locale level. Used sparingly —
   * e.g. a locale can opt out of `style-currency` if its doctrine permits
   * multiple currencies. Service-level overrides still win.
   */
  readonly checkOverrides?: Partial<
    Record<CheckId, 'enforce' | 'report' | 'off'>
  >;
}
