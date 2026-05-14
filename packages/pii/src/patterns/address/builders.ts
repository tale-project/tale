/**
 * Cross-locale regex primitives for postal-address detection.
 *
 * This file holds ONLY building blocks that are language-independent —
 * Unicode character classes, generic boundary helpers, the house-number
 * shape. Every locale-specific token (street keywords, country names,
 * floor labels, postcode forms, ordinal markers, directional suffixes)
 * lives in `locales/data/<code>.json` and is read by the form composer
 * at `compose.ts`.
 *
 * Why this split: keyword lists are data, not code. Adding a new locale
 * should be a JSON edit; we never want a contributor to think they need
 * to learn the regex composition to add Bulgarian. Putting locale data
 * here would force exactly that.
 */

// -----------------------------------------------------------------------------
// Unicode word-token primitives — apply to every Latin-script locale and
// most non-Latin scripts too (Cyrillic, Greek, Indic) via `\p{L}`.
// -----------------------------------------------------------------------------

/**
 * Word-token character class: Unicode letters + combining marks + digits +
 * apostrophes. Hyphens are intentionally OUT — putting them here with an
 * outer `+` causes catastrophic backtracking on inputs like
 * `1 rue de-la-de-la-…`. Hyphens are joined at the token-join level via a
 * bounded `{0,4}` quantifier.
 */
export const W = String.raw`[\p{L}\p{M}\p{N}_'’]`;

/** A single name token, optionally followed by 1–4 hyphenated continuations. */
export const NAME_TOKEN = String.raw`${W}+(?:-${W}+){0,4}`;

/** A multi-word name phrase: 1–6 name tokens separated by whitespace. */
export const NAME_PHRASE = String.raw`${NAME_TOKEN}(?:\s+${NAME_TOKEN}){0,5}`;

/**
 * Unicode-aware lookahead boundaries. JavaScript `\b` is ASCII-only even
 * under the `/u` flag — `\bétage\b` fails because `é` isn't an ASCII word
 * char. These lookarounds correctly bound on Unicode letter categories.
 */
export const UB = String.raw`(?<![\p{L}\p{M}])`;
export const UA = String.raw`(?![\p{L}\p{M}])`;

/**
 * Explicit Title-Case character class for Latin-script locales. ECMA-262
 * §22.2.2 specifies `\p{Lu}` is canonicalized under `/i` (case-folded), so
 * `\p{Lu}` matches lowercase too inside a regex compiled with `/giu`. This
 * explicit class — Latin-1 uppercase plus the most common Western European
 * accented uppercase — is the FP gate wherever Title-Case actually
 * matters.
 *
 * For Cyrillic / Greek locales, the equivalent classes are computed by the
 * composer from the locale's `scripts` array. This constant is the
 * default for `latn`.
 */
export const EU_UPPER = String.raw`[A-ZÀ-ÖØ-Þ]`;

/**
 * Building number with optional range/slash form (`12-14`, `12/14`) and a
 * single trailing alpha suffix (`12a`). Used by every form that ends in a
 * house number so range notations don't truncate to just the first half —
 * which would leave the postcode + city tail exposed downstream and create
 * a re-identification risk.
 */
export const HOUSE_NUM = String.raw`\d{1,5}(?:\s*[-/]\s*\d{1,5})?[A-Za-z]?`;
