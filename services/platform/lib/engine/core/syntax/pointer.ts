/**
 * RFC 6901 JSON Pointers into an automation document — the one way an issue,
 * an expression source or an editor says WHERE in the document something is.
 *
 * A pointer is a list of reference tokens, each prefixed with `/`; inside a
 * token `~` is written `~0` and `/` is written `~1`, so a key such as
 * `a/b` stays one token. `''` is the whole document.
 */

import { isRecord } from '../../../utils/type-utils';

/** Escape one reference token (a member name or an array index). */
function escapeToken(token: string | number): string {
  return String(token).replaceAll('~', '~0').replaceAll('/', '~1');
}

/** Build a pointer from its tokens: `ptr('nodes', 2, 'input')` →
 * `/nodes/2/input`. */
export function ptr(...tokens: ReadonlyArray<string | number>): string {
  return tokens.map((t) => `/${escapeToken(t)}`).join('');
}

/**
 * A pointer below `base` from an Ajv `instancePath`. Ajv already writes the
 * instance path as an RFC 6901 pointer (`/units`, `/items/0/a~1b`), relative
 * to the validated value, so it appends verbatim.
 */
export function pointerFromAjv(base: string, instancePath: string): string {
  return base + instancePath;
}

/** The unescaped tokens of a pointer; `''` has none. */
export function pointerTokens(pointer: string): string[] {
  if (pointer === '') return [];
  return pointer
    .slice(1)
    .split('/')
    .map((t) => t.replaceAll('~1', '/').replaceAll('~0', '~'));
}

/** The pointer one level up, or `null` for the whole document. */
export function parentPointer(pointer: string): string | null {
  if (pointer === '') return null;
  return pointer.slice(0, pointer.lastIndexOf('/'));
}

/**
 * The value a pointer names inside `doc`, or `{ found: false }` when a token
 * does not resolve (a missing member, an index past the end, or a step into
 * a scalar).
 */
export function resolvePointer(
  doc: unknown,
  pointer: string,
): { found: true; value: unknown } | { found: false } {
  let cur: unknown = doc;
  for (const token of pointerTokens(pointer)) {
    if (Array.isArray(cur)) {
      if (!/^(?:0|[1-9]\d*)$/.test(token)) return { found: false };
      const i = Number(token);
      if (i >= cur.length) return { found: false };
      cur = cur[i];
    } else if (isRecord(cur)) {
      if (!Object.hasOwn(cur, token)) return { found: false };
      cur = cur[token];
    } else {
      return { found: false };
    }
  }
  return { found: true, value: cur };
}
