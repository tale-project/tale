import type { BodyIssue } from './invalid-body-response.ts';

/**
 * Strings Postgres cannot store, found before they reach it.
 *
 * A U+0000 in any text or jsonb value is refused by the database (`22021`).
 * An unpaired UTF-16 surrogate is rewritten to U+FFFD by Node's UTF-8
 * encoder on its way into a text column, but reaches a jsonb one as the
 * `\ud800` escape `JSON.stringify` writes, which Postgres refuses
 * (`22P02`). The REST door (`readJsonBody`), whose callers are programs,
 * refuses both as a 400 naming the field. The app door (`appJsonBody`)
 * refuses a NUL the same way and stores an unpaired surrogate as U+FFFD
 * whatever the column (`toWellFormedJson`).
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
 * Rewrite, in place, every unpaired surrogate in a parsed JSON body's
 * strings — values and object keys — to U+FFFD, what a text column would
 * have stored. A body without one is left untouched; a bare string body is
 * left as it is (no handler stores one). Iterative, like the search above.
 */
export function toWellFormedJson(value: unknown): void {
  if (findStringPath(value, (text) => !text.isWellFormed()) === null) return;
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (Array.isArray(current)) {
      current.forEach((item: unknown, index) => {
        if (typeof item === 'string') current[index] = item.toWellFormed();
        else stack.push(item);
      });
      continue;
    }
    if (current === null || typeof current !== 'object') continue;
    const entries: [string, unknown][] = Object.entries(current);
    // A renamed key must keep its place, so every key is set again in order.
    const rekey = entries.some(([key]) => !key.isWellFormed());
    for (const [key, item] of entries) {
      if (typeof item !== 'string') stack.push(item);
      const fixed = typeof item === 'string' ? item.toWellFormed() : item;
      if (rekey) Reflect.deleteProperty(current, key);
      if (rekey || fixed !== item) {
        // Defined, never assigned: a `__proto__` key stays a plain key.
        Object.defineProperty(current, key.toWellFormed(), {
          value: fixed,
          writable: true,
          enumerable: true,
          configurable: true,
        });
      }
    }
  }
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
