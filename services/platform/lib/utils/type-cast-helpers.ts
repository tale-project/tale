/* oxlint-disable typescript/no-unsafe-type-assertion -- Wrappers for inherently untyped JS built-ins */

/**
 * Typed wrappers for JavaScript built-ins that cannot return typed values.
 *
 * `Response.json()` returns `Promise<any>` and `JSON.parse()` returns `any`.
 * These helpers concentrate the unavoidable assertion in a single place.
 */

/** Parse a `Response` body as typed JSON. */
export async function fetchJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

/** Parse a JSON string to a typed value. */
export function parseJson<T>(json: string): T {
  return JSON.parse(json) as T;
}
