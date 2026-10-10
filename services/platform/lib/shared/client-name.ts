import { sanitizeUntrustedField } from './sanitize-untrusted-field';

/** The most characters (Unicode code points, what Postgres `char_length`
 * counts) a client name is shown and stored with. */
export const CLIENT_NAME_MAX = 80;

let segmenter: Intl.Segmenter | undefined;

function graphemes(text: string): string[] {
  segmenter ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  return Array.from(segmenter.segment(text), (part) => part.segment);
}

function codePoints(text: string): number {
  return Array.from(text).length;
}

/**
 * The name a coding agent's client gave itself (`clientInfo.name` on an MCP
 * `initialize`, later the OAuth client's registered name), made safe to show
 * and store, or null when it names nothing.
 *
 * The name is chosen by whoever wrote the client, so it is untrusted: control
 * characters become spaces, zero-width and bidi-override marks (U+202A–E,
 * U+2066–9 among them) are removed so a name cannot reorder the text around
 * it, whitespace collapses, and the result holds at most
 * {@link CLIENT_NAME_MAX} characters, cut with an ellipsis between two
 * user-perceived characters. Every place that shows or stores a client name
 * reads it through here, so one rule holds for the audit log, the activity
 * record and the connected-agents list.
 */
export function displayClientName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // A hostile name can be megabytes long; four times the limit is more than
  // the clamp below can keep.
  const bounded = Array.from(raw)
    .slice(0, CLIENT_NAME_MAX * 4)
    .join('');
  const clean = sanitizeUntrustedField(bounded, CLIENT_NAME_MAX);
  if (clean === '') return null;
  if (codePoints(clean) <= CLIENT_NAME_MAX) return clean;
  // The clamp counts user-perceived characters; one of them can carry
  // several code points (a flag, a family emoji, combining marks), so a
  // clamped name can still exceed the stored limit. Keep whole characters
  // up to it, ellipsis included.
  const kept: string[] = [];
  let used = 1;
  for (const character of graphemes(clean.replace(/…$/, ''))) {
    const size = codePoints(character);
    if (used + size > CLIENT_NAME_MAX) break;
    kept.push(character);
    used += size;
  }
  return `${kept.join('').trimEnd()}…`;
}
