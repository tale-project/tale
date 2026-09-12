/**
 * HTTP entity tags and the two conditional-request preconditions built on
 * them, per RFC 9110 §8.8.3 (the field) and §13.1.1 / §13.1.2 (`If-Match`,
 * `If-None-Match`). ONE parser and ONE pair of comparison functions for
 * every door that issues or honours a validator — the skills REST family,
 * the WebDAV methods, a static server — so no door invents a third reading
 * of "weak" or splits a list on a comma an opaque tag may itself contain.
 *
 *   entity-tag = [ weak ] opaque-tag
 *   weak       = %s"W/"                      (case-sensitive)
 *   opaque-tag = DQUOTE *etagc DQUOTE
 *   etagc      = %x21 / %x23-7E / obs-text   (any visible byte but DQUOTE)
 *
 * A field value is either `*` or a comma-separated list of entity tags
 * (`#entity-tag`: empty elements and optional whitespace tolerated). A value
 * that is neither parses as `malformed`, which the preconditions treat as
 * "matches nothing" — `If-Match` then fails (412, nothing written) and
 * `If-None-Match` then holds (the write goes ahead), the safe reading in
 * both directions.
 *
 * Layer A: no imports, runs anywhere a string does.
 */

/** One entity tag: the opaque value without its quotes, and its weakness. */
export interface EntityTag {
  readonly weak: boolean;
  readonly opaque: string;
}

/** A parsed `If-Match` / `If-None-Match` field value. */
export type EntityTagList =
  | { readonly kind: 'any' }
  | { readonly kind: 'tags'; readonly tags: readonly EntityTag[] }
  | { readonly kind: 'malformed' };

/** `etagc`: every visible byte except DQUOTE, plus obs-text (a header
 * value reaches JavaScript as one code unit per byte, so obs-text is
 * U+0080..U+00FF here). */
const ETAGC = /^[\x21\x23-\x7e\x80-\xff]*$/;

/** The tag `text` spells (`"abc"`, `W/"abc"`), or null for anything else. */
export function parseEntityTag(text: string): EntityTag | null {
  const trimmed = text.trim();
  const weak = trimmed.startsWith('W/');
  const quoted = weak ? trimmed.slice(2) : trimmed;
  if (quoted.length < 2 || !quoted.startsWith('"') || !quoted.endsWith('"')) {
    return null;
  }
  const opaque = quoted.slice(1, -1);
  return ETAGC.test(opaque) ? { weak, opaque } : null;
}

/** The wire spelling of `tag`. */
export function formatEntityTag(tag: EntityTag): string {
  return `${tag.weak ? 'W/' : ''}"${tag.opaque}"`;
}

/** A strong validator for `opaque` — the tag a door issues for a
 * representation it can identify byte-for-byte. */
export function strongEntityTag(opaque: string): EntityTag {
  return { weak: false, opaque };
}

/**
 * Parse an `If-Match` / `If-None-Match` field value. Walks the value rather
 * than splitting on commas: an opaque tag may contain a comma, and a bare
 * word or an unclosed quote is a malformed list, never a tag.
 */
export function parseEntityTagList(header: string): EntityTagList {
  const value = header.trim();
  if (value === '*') return { kind: 'any' };
  const tags: EntityTag[] = [];
  let index = 0;
  while (index < value.length) {
    const char = value[index];
    // OWS and empty list elements (`,,`) are permitted between tags.
    if (char === ' ' || char === '\t' || char === ',') {
      index += 1;
      continue;
    }
    let weak = false;
    if (value.startsWith('W/', index)) {
      weak = true;
      index += 2;
    }
    if (value[index] !== '"') return { kind: 'malformed' };
    const close = value.indexOf('"', index + 1);
    if (close === -1) return { kind: 'malformed' };
    const opaque = value.slice(index + 1, close);
    if (!ETAGC.test(opaque)) return { kind: 'malformed' };
    tags.push({ weak, opaque });
    index = close + 1;
    // After a tag only OWS, a comma or the end may follow.
    while (value[index] === ' ' || value[index] === '\t') index += 1;
    if (index < value.length && value[index] !== ',') {
      return { kind: 'malformed' };
    }
  }
  return tags.length === 0 ? { kind: 'malformed' } : { kind: 'tags', tags };
}

/** RFC 9110 §8.8.3.2 strong comparison: both tags strong, opaque equal. */
export function strongMatch(a: EntityTag, b: EntityTag): boolean {
  return !a.weak && !b.weak && a.opaque === b.opaque;
}

/** RFC 9110 §8.8.3.2 weak comparison: opaque equal, weakness ignored. */
export function weakMatch(a: EntityTag, b: EntityTag): boolean {
  return a.opaque === b.opaque;
}

/**
 * Whether an `If-Match` precondition holds (§13.1.1) — the request may
 * proceed — against `current`, the tag of the selected representation, or
 * null when there is none. `*` holds when a representation exists; a list
 * holds when one of its tags STRONGLY matches (a weak tag never does); a
 * malformed value never holds.
 */
export function ifMatchHolds(
  list: EntityTagList,
  current: EntityTag | null,
): boolean {
  if (current === null) return false;
  if (list.kind === 'any') return true;
  if (list.kind === 'malformed') return false;
  return list.tags.some((tag) => strongMatch(tag, current));
}

/**
 * Whether an `If-None-Match` precondition holds (§13.1.2) — the request may
 * proceed — against `current`. `*` holds only when no representation
 * exists; a list holds when none of its tags WEAKLY matches; a malformed
 * value matches nothing and so holds. When it does not hold, a GET answers
 * 304 and any other method 412.
 */
export function ifNoneMatchHolds(
  list: EntityTagList,
  current: EntityTag | null,
): boolean {
  if (current === null) return true;
  if (list.kind === 'any') return false;
  if (list.kind === 'malformed') return true;
  return !list.tags.some((tag) => weakMatch(tag, current));
}
