/**
 * Field paths a refusal names. A path holds keys and indexes, never values,
 * so it tells the operator where an input is wrong without quoting it.
 */

const MAX_NAMED_PLACES = 5;

/** A key as a log-safe path segment: plain keys as written, any other key
 * quoted and bounded so it cannot break or flood a log line. */
export function pathSegment(key: string): string {
  return /^[A-Za-z0-9_-]{1,64}$/.test(key)
    ? key
    : JSON.stringify(key.slice(0, 64));
}

/** Keys and indexes as one field path (`configs[0].project`); the value
 * itself is `(root)`. */
export function fieldPath(segments: readonly PropertyKey[]): string {
  let path = '';
  for (const segment of segments) {
    if (typeof segment === 'number') path += `[${segment}]`;
    else {
      const key = pathSegment(String(segment));
      path = path === '' ? key : `${path}.${key}`;
    }
  }
  return path || '(root)';
}

/** The first places and a count of the rest, so a refusal names enough to
 * act on and stays one line. */
export function namePlaces(places: readonly string[]): string {
  const named = places.slice(0, MAX_NAMED_PLACES).join(', ');
  const more =
    places.length > MAX_NAMED_PLACES
      ? ` and ${places.length - MAX_NAMED_PLACES} more`
      : '';
  return `${named}${more}`;
}
