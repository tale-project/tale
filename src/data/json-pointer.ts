/**
 * JSON Pointers (RFC 6901) for paths into a value: `/items/0/name` for
 * `['items', 0, 'name']`. `~` is written `~0` and `/` is written `~1`, so a
 * key holding either survives the round trip.
 */

/** The pointer for `path`; the empty path is the whole value, `''`. */
export function pointerOf(path: readonly (string | number)[]): string {
  return path.map((segment) => `/${escapeSegment(String(segment))}`).join('');
}

/**
 * The path `pointer` names. A segment written as a canonical non-negative
 * integer (`0`, `12`, never `012`) reads as a number, the way a list index is
 * written; every other segment is a key. Throws on a pointer that does not
 * start with `/` (other than `''`) or holds a `~` it cannot read.
 */
export function pathOf(pointer: string): (string | number)[] {
  if (pointer === '') return [];
  if (!pointer.startsWith('/')) {
    throw new Error(
      `"${pointer}" is not a JSON pointer: it must start with "/"`,
    );
  }
  return pointer
    .slice(1)
    .split('/')
    .map((raw) => {
      const segment = unescapeSegment(raw, pointer);
      return INDEX.test(segment) ? Number(segment) : segment;
    });
}

/** Whether `pointer` is `ancestor` or lies inside it. */
export function isWithin(pointer: string, ancestor: string): boolean {
  return (
    ancestor === '' ||
    pointer === ancestor ||
    pointer.startsWith(`${ancestor}/`)
  );
}

const INDEX = /^(0|[1-9][0-9]*)$/;

function escapeSegment(segment: string): string {
  return segment.replaceAll('~', '~0').replaceAll('/', '~1');
}

function unescapeSegment(segment: string, pointer: string): string {
  if (/~(?![01])/.test(segment)) {
    throw new Error(
      `"${pointer}" is not a JSON pointer: "~" must be written "~0" or "~1"`,
    );
  }
  return segment.replaceAll('~1', '/').replaceAll('~0', '~');
}
