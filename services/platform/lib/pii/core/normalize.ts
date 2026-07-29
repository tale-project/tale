/**
 * Input normalization at the detection boundary.
 *
 * Two steps, in this order:
 *
 *  1. Strip invisible code points used to break `\w`/`\b` anchors in
 *     evasion payloads: bidi controls (U+200E/200F, U+202A–202E,
 *     U+2066–2069), zero-width/format characters (U+00AD soft hyphen,
 *     U+200B–200D, U+2060 word joiner, U+FEFF), and the Mongolian vowel
 *     separator (U+180E).
 *  2. NFC — macOS clipboards and several IMEs emit NFD text (combining
 *     marks split from their base letters); the composed patterns embed
 *     precomposed forms, so without NFC a pasted `Tél` slips past the
 *     phone-context regex.
 *
 * The strip must run before NFC, which can otherwise recompose around an
 * invisible code point. Homoglyph folding (Cyrillic `а` → Latin `a`) is
 * deliberately NOT done here — it would corrupt legitimate non-Latin text
 * and belongs in a script-mixing heuristic with full context, if anywhere.
 *
 * Idempotent; visible whitespace and control characters are preserved
 * because the address detector anchors on them.
 */

// Composed via `new RegExp` with \u escapes so no literal invisible
// character sits in the source (and the lint rule against zero-width
// characters in character classes stays quiet).
const INVISIBLE_CODE_POINTS = new RegExp(
  '[\\u00AD\\u180E\\u200B-\\u200F\\u202A-\\u202E\\u2060\\u2066-\\u2069\\uFEFF]',
  'g',
);

/** Strip evasion code points, then NFC-normalize. */
export function normalizeForDetection(text: string): string {
  return text.replace(INVISIBLE_CODE_POINTS, '').normalize('NFC');
}
