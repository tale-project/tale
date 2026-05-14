/**
 * Unicode normalization at the detection entrypoint.
 *
 * macOS clipboard and several IMEs produce NFD-encoded text (combining
 * marks separated from their base letters). Built-in patterns embed
 * precomposed forms; without normalization, pasting `Tél` from a Mac
 * browser into the chat composer slips past the phone-context regex
 * because the matched form is `T` `e` U+0301 `l`, not `Tél`.
 *
 * NFC is idempotent and cheap; apply once at the boundary. The masked
 * output therefore comes back in NFC form too.
 *
 * Before NFC we strip two families of invisible code points used for
 * boundary-evasion against `\w`/`\b`-based detectors:
 *
 *  1. Bidi-control marks (U+200E, U+200F, U+202A-U+202E, U+2066-U+2069).
 *  2. Zero-width / format chars (U+00AD soft hyphen, U+200B ZWSP,
 *     U+200C ZWNJ, U+200D ZWJ, U+2060 WORD JOINER, U+FEFF BOM/ZWNBSP).
 *
 * Order matters: NFC can decompose-then-recompose around an invisible
 * code point, so the strip has to run first.
 */

// Built via `new RegExp` with explicit \u escapes — keeps the source
// readable and dodges oxlint's "no literal zero-width chars inside a
// character class" rule that a regex literal would trigger.
const INVISIBLE_CHARS_RE = new RegExp(
  '[\\u00AD\\u200B-\\u200F\\u202A-\\u202E\\u2060\\u2066-\\u2069\\uFEFF]',
  'g',
);

/**
 * Normalize text for PII detection: invisible-character stripping then NFC.
 *
 * Idempotent. Safe to call multiple times. Intentionally does NOT strip
 * control characters or visible whitespace — the detector itself anchors
 * on those (e.g. spaces between street and postcode), and removing them
 * would create false positives.
 */
export function normalizeForDetection(text: string): string {
  return text.replace(INVISIBLE_CHARS_RE, '').normalize('NFC');
}
