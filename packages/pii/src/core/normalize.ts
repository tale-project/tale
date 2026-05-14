/**
 * Unicode normalization at the detection entrypoint.
 *
 * macOS clipboard and several IMEs produce NFD-encoded text (combining
 * marks separated from their base letters). Built-in patterns embed
 * precomposed forms (`é` U+00E9, `ß` U+00DF, …); without normalization,
 * pasting `Tél` from a Mac browser into the chat composer slips past the
 * phone-context regex because the matched form is `T` `e` U+0301 `l`,
 * not `Tél`.
 *
 * NFC is idempotent and cheap; apply once at the boundary. The masked
 * output therefore comes back in NFC form too — consistent with the
 * contract that the detector may rewrite the text.
 *
 * For RTL scripts (Arabic / Hebrew / Persian / Urdu) we additionally strip
 * Unicode bidi-control marks (U+200E, U+200F, U+202A–U+202E, U+2066–U+2069).
 * Those marks are invisible but they break Unicode-aware boundary
 * lookarounds inside the regex by interposing a "non-letter" code point
 * between the letter the detector expected and its actual letter neighbor.
 */

// Bidi-control code points that get stripped at the entrypoint.
//
// U+200E LEFT-TO-RIGHT MARK
// U+200F RIGHT-TO-LEFT MARK
// U+202A LEFT-TO-RIGHT EMBEDDING        through
// U+202E RIGHT-TO-LEFT OVERRIDE
// U+2066 LEFT-TO-RIGHT ISOLATE          through
// U+2069 POP DIRECTIONAL ISOLATE
const BIDI_CONTROL_RE = /[‎‏‪-‮⁦-⁩]/g;

/**
 * Normalize text for PII detection: NFC + bidi-control stripping.
 *
 * Idempotent. Safe to call multiple times. The function intentionally does
 * NOT strip control characters or whitespace beyond bidi marks — the
 * detector itself anchors on those (e.g. spaces between street and
 * postcode), and removing them would create false positives.
 */
export function normalizeForDetection(text: string): string {
  return text.normalize('NFC').replace(BIDI_CONTROL_RE, '');
}
