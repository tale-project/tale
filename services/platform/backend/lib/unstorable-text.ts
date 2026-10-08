import type { BodyIssue } from './invalid-body-response.ts';

/**
 * Strings Postgres cannot store, found before they reach it.
 *
 * A U+0000 in any text or jsonb value is refused by the database (`22021`),
 * and an unpaired UTF-16 surrogate is silently rewritten to U+FFFD by
 * Node's UTF-8 encoder on the way to the driver — one turned a client's
 * mistake into a 500, the other stored a different string than the client
 * sent. Both request doors (the app's `appJsonBody` and the REST door's
 * `readJsonBody`) refuse such a body as a 400 naming the field instead.
 */

/**
 * The dotted path of the first string — a value or an object key — in a
 * parsed JSON body for which `test` holds, or null when none does.
 * Iterative, so a deeply nested body cannot exhaust the stack.
 */
function findStringPath(
  value: unknown,
  test: (text: string) => boolean,
): string | null {
  const stack: { value: unknown; path: string }[] = [{ value, path: '' }];
  while (stack.length > 0) {
    const item = stack.pop();
    if (item === undefined) break;
    const current = item.value;
    if (typeof current === 'string') {
      if (test(current)) return item.path;
      continue;
    }
    if (Array.isArray(current)) {
      for (let index = current.length - 1; index >= 0; index -= 1) {
        stack.push({
          value: current[index],
          path: item.path === '' ? String(index) : `${item.path}.${index}`,
        });
      }
      continue;
    }
    if (current !== null && typeof current === 'object') {
      const entries = Object.entries(current);
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        const entry = entries[index];
        if (entry === undefined) continue;
        const [key, child] = entry;
        const path = item.path === '' ? key : `${item.path}.${key}`;
        if (test(key)) return path;
        stack.push({ value: child, path });
      }
    }
  }
  return null;
}

/**
 * The dotted path of the first string — a value or an object key — that
 * carries a U+0000, or null when none does. Postgres refuses a NUL in any
 * text or jsonb value (`22021`), so a body that carries one can never be
 * stored; letting it reach the driver turned a client mistake into a
 * text/plain 500.
 */
export function findNulByte(value: unknown): string | null {
  return findStringPath(value, (text) => text.includes('\0'));
}

/**
 * The first string a body carries that Postgres could not store, as the
 * issue a refusal names: a NUL first, then an unpaired surrogate. Null for
 * a body that is safe to store.
 */
export function findUnstorableText(value: unknown): BodyIssue | null {
  const nul = findNulByte(value);
  if (nul !== null) {
    return { path: nul, message: 'must not contain a NUL character (U+0000)' };
  }
  const surrogate = findStringPath(value, (text) => !text.isWellFormed());
  if (surrogate !== null) {
    return {
      path: surrogate,
      message:
        'must not contain an unpaired UTF-16 surrogate (U+D800–U+DFFF), which cannot be stored',
    };
  }
  return null;
}
