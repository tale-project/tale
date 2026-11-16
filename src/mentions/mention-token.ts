/**
 * The stored form of a mention: a markdown link whose address names who is
 * mentioned and whose text is how they were called when it was written.
 *
 * ```
 * [@Ada Lovelace](mention:user/Hk9xV2c0wq1NfR6tYb3sLm8aPz4eD7uJ)
 * ```
 *
 * The address is `mention:<kind>/<id>`. Which kinds exist is the caller's
 * business (Tale's are people, agents and automations), so every reader takes
 * the list. A reader that knows no mentions sees "@Ada Lovelace" — a link a
 * markdown renderer leaves without an address — and a plain-text reader sees
 * the name and the id. Tale's renderer shows the person's CURRENT name, so
 * the text inside the brackets is a fallback and a courtesy to other readers.
 *
 * Pure, no React: the platform's backend parses and writes the same tokens.
 */

export const MENTION_URL_PREFIX = 'mention:';

/** The longest id an address carries. */
export const MENTION_ID_MAX = 200;

/** The longest label a token stores; a longer name is cut with an ellipsis. */
export const MENTION_LABEL_MAX = 64;

export interface MentionRef<Kind extends string = string> {
  kind: Kind;
  id: string;
}

export interface MentionTokenParts<
  Kind extends string = string,
> extends MentionRef<Kind> {
  label: string;
}

/** Characters an id keeps as they are in an address; any other is
 * percent-encoded. `/` stays, so a store name such as `billing/dunning`
 * reads as it is: the kind ends at the first `/`. */
const ID_SAFE_RE = /^[A-Za-z0-9\-_.~/]$/u;

/** Whitespace and control characters never belong to an id. */
const ID_FORBIDDEN_RE = /[\s\p{Cc}]/u;

/** Controls, direction marks and overrides, and zero-width characters, which
 * would reorder or hide a name. The zero-width joiner stays: emoji are built
 * with it. */
const INVISIBLE_RE =
  /[\p{Cc}\u00ad\u061c\u200b\u200c\u200e\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/gu;

/** Characters that would turn a label into emphasis, code, an entity or
 * markup, split a table cell, strike it through, open math or close the
 * link: each gets a backslash. */
const LABEL_ESCAPE_RE = /[\\[\]*_`<>&~|$]/g;

/** Percent-encode one character, including the ones `encodeURIComponent`
 * leaves alone (`!'()*`), which would end or confuse a link address. */
function percentEncode(character: string): string {
  const encoded = encodeURIComponent(character);
  return encoded === character
    ? `%${character.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`
    : encoded;
}

export function formatMentionUrl(ref: MentionRef): string {
  let encoded = '';
  for (const character of ref.id) {
    encoded += ID_SAFE_RE.test(character)
      ? character
      : percentEncode(character);
  }
  return `${MENTION_URL_PREFIX}${ref.kind}/${encoded}`;
}

/** The mention an address names, or null when it names none of `kinds`. */
export function parseMentionUrl<Kind extends string>(
  url: string,
  kinds: readonly Kind[],
): MentionRef<Kind> | null {
  if (!url.startsWith(MENTION_URL_PREFIX)) return null;
  const rest = url.slice(MENTION_URL_PREFIX.length);
  const slash = rest.indexOf('/');
  if (slash <= 0) return null;
  const kind = kinds.find((candidate) => candidate === rest.slice(0, slash));
  if (kind === undefined) return null;
  let id: string;
  try {
    id = decodeURIComponent(rest.slice(slash + 1));
  } catch (error) {
    if (error instanceof URIError) return null;
    throw error;
  }
  if (id === '' || id.length > MENTION_ID_MAX || ID_FORBIDDEN_RE.test(id)) {
    return null;
  }
  return { kind, id };
}

/**
 * A name as a token stores it: on one line, without the invisible characters
 * that reorder or hide text (direction overrides, zero-width marks), and at
 * most {@link MENTION_LABEL_MAX} characters.
 */
export function normalizeMentionLabel(name: string): string {
  const visible = name.replace(/\s+/gu, ' ').replace(INVISIBLE_RE, '').trim();
  // Cut between graphemes, so an emoji or an accented letter stays whole.
  const graphemes = Array.from(
    new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(visible),
    (part) => part.segment,
  );
  if (graphemes.length <= MENTION_LABEL_MAX) return visible;
  return `${graphemes
    .slice(0, MENTION_LABEL_MAX - 1)
    .join('')
    .trimEnd()}…`;
}

export function escapeMentionLabel(label: string): string {
  return label.replace(LABEL_ESCAPE_RE, '\\$&');
}

/** The stored token for a mention. */
export function formatMentionToken(parts: MentionTokenParts): string {
  const label = normalizeMentionLabel(parts.label) || parts.id;
  return `[@${escapeMentionLabel(label)}](${formatMentionUrl(parts)})`;
}
