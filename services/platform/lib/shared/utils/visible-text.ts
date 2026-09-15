/**
 * Whether a text carries anything a reader would see. Blank means nothing
 * but whitespace (Unicode `White_Space` — the NEL and the `Zs` family that
 * `String.prototype.trim` leaves alone included) and the default-ignorable
 * and format code points that render as nothing on their own: zero-width
 * spaces and joiners, bidi marks and isolates, the soft hyphen, variation
 * selectors, tag characters, the BOM. A prompt of two U+200B ZERO WIDTH
 * SPACE characters passed the door's `trim()` and spent a billed model turn
 * that answered "your message came through empty" (2026-09-14 evaluation,
 * h2). A predicate, never a rewrite: a joiner inside an emoji sequence or a
 * bidi mark inside a sentence is content, and the text is stored as sent.
 * Markdown that renders as nothing (an empty code fence) is visible text.
 */
const INVISIBLE = /[\p{White_Space}\p{Default_Ignorable_Code_Point}\p{Cf}]/gu;

export function hasVisibleText(text: string): boolean {
  return text.replace(INVISIBLE, '') !== '';
}
