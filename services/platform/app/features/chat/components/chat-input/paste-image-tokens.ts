/**
 * Pasted-image reference tokens.
 *
 * When a user pastes an image into the composer we insert a short `[N]`
 * reference token at the caret and name the uploaded file `[N].<ext>`. The
 * token stays in the message text the agent receives (so the prose can say
 * "compare [1] with [2]") and the backend's pre-analyzed image section labels
 * the attachment `**Image: [N].<ext>**`, letting the model correlate the two.
 * The `PasteImageOverlay` paints a thumbnail chip over each `[N]` in the
 * textarea. These helpers are the single source of truth for the token shape so
 * the paste handler, the overlay, the tray exclusion and the removal-sync all
 * agree.
 */

/** Matches every `[N]` reference token in message text (global). */
const TOKEN_RE = /\[(\d+)\]/g;

/**
 * Spaces inserted after a `[N]` token. The marker chip is a rectangle (square
 * thumbnail + index) wider than the bare `[N]` text, so it would overlap the
 * following words; these trailing spaces reserve room in the textarea for the
 * chip to sit over. They're invisible (covered by the chip), consumed when the
 * marker is deleted, and collapsed to a single space when the message is sent.
 */
export const MARKER_RESERVE_SPACES = 6;

/** The text inserted for a pasted/dragged image marker: `[N]` + reserve. */
export function buildMarkerToken(id: number): string {
  return `[${id}]${' '.repeat(MARKER_RESERVE_SPACES)}`;
}

/** Collapse the reserve-spaces after every `[N]` token down to one, for the
 *  outgoing message text (the textarea keeps the reserve for chip layout). */
export function collapseMarkerSpaces(value: string): string {
  return value.replace(/(\[\d+\]) +/g, '$1 ');
}

/** Matches a pasted-image file name: `[N].<ext>` (extension-agnostic — the
 *  client compressor may rewrite `.png` → `.jpg`, but the `[N]` base is kept). */
const PASTED_NAME_RE = /^\[(\d+)\]\.\w+/;

/** The id `N` of a pasted-image file name, or `null` if it isn't one. Also
 *  matches the upload-tracking id (`[N].<ext>-<timestamp>`) since that is just
 *  the file name with a suffix. */
export function pastedImageIdFromName(name: string): number | null {
  const match = PASTED_NAME_RE.exec(name);
  return match ? Number(match[1]) : null;
}

/** True for both a pasted-image file name and its upload-tracking id. */
export function isPastedImageRef(name: string): boolean {
  return PASTED_NAME_RE.test(name);
}

/** Every `[N]` id currently present in the message text. */
export function presentTokenIds(value: string): Set<number> {
  const ids = new Set<number>();
  for (const match of value.matchAll(TOKEN_RE)) {
    ids.add(Number(match[1]));
  }
  return ids;
}

export interface TokenSpan {
  id: number;
  /** Index of the opening `[`. */
  start: number;
  /** Index just past the closing `]`. */
  end: number;
}

/**
 * The character span of every `[N]` token. Used to delete a marker atomically
 * (so Backspace can't leave a `[1` fragment behind).
 */
export function tokenSpans(value: string): TokenSpan[] {
  const spans: TokenSpan[] = [];
  for (const match of value.matchAll(TOKEN_RE)) {
    const start = match.index ?? 0;
    spans.push({ id: Number(match[1]), start, end: start + match[0].length });
  }
  return spans;
}

/**
 * The next id to assign to a freshly pasted image: one past the highest `[N]`
 * already in the text. Deriving from the text (rather than a running counter)
 * means numbering restarts at 1 once the composer is cleared on send, never
 * collides with a token the user typed, and survives send-failure rollbacks.
 */
export function nextPasteImageId(value: string): number {
  let max = 0;
  for (const match of value.matchAll(TOKEN_RE)) {
    const id = Number(match[1]);
    if (id > max) max = id;
  }
  return max + 1;
}
