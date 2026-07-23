/**
 * Language-independent regex building blocks for postal-address detection.
 * Everything locale-specific — street keywords, country names, floor
 * labels, postcode forms, ordinal markers — is data in the locale files;
 * this module owns only the Unicode word-token shapes and the house-number
 * form the composers weave that data into.
 */

/**
 * Word-token character class: Unicode letters, combining marks, digits,
 * underscores, apostrophes. Hyphens are deliberately excluded — inside a
 * `+`-quantified class they cause catastrophic backtracking on inputs
 * like `1 rue de-la-de-la-…`; hyphenated continuations are joined at the
 * token level with a bounded quantifier instead.
 */
export const W = String.raw`[\p{L}\p{M}\p{N}_'’]`;

/** One name token with up to 4 hyphenated continuations. */
export const NAME_TOKEN = String.raw`${W}+(?:-${W}+){0,4}`;

/**
 * A multi-word name phrase, up to 6 words — covers the longest common
 * street names ("Avenue du Général de Gaulle", "Martin Luther King Jr
 * Boulevard"); going wider buys false positives, not recall.
 */
export const NAME_PHRASE = String.raw`${NAME_TOKEN}(?:\s+${NAME_TOKEN}){0,5}`;

/**
 * Unicode-aware lookahead boundary. JS `\b` is ASCII-only even under `/u`
 * — `\bétage\b` fails on the accented letter; this bounds on the Unicode
 * letter/mark categories instead.
 */
export const UA = String.raw`(?![\p{L}\p{M}])`;

/**
 * House number with optional range/slash form (`12-14`, `12/14`) and one
 * trailing letter suffix (`12a`). Ranges must be captured whole — cutting
 * a range in half leaves the postcode + city tail exposed downstream.
 * Locale ordinal markers after the number (`bis`, `ter`) are composed in
 * the form composers, gated by the locale's own data.
 */
export const HOUSE_NUM = String.raw`\d{1,5}(?:\s*[-/]\s*\d{1,5})?[A-Za-z]?`;
