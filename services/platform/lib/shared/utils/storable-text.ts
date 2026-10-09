/**
 * Text as Postgres can keep it in jsonb. A JavaScript string may hold what
 * jsonb refuses — a lone half of a surrogate pair (half an emoji, from a
 * cut or from a program's output) or a NUL character — and one such string
 * fails the whole write it rides in. Runtime-agnostic and pure: the engine's
 * record core and the stores share it.
 */

/** The first `max` UTF-16 units of `text`, one fewer when the cut would
 * split a character that takes two. */
export function cutText(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  const last = head.charCodeAt(head.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? head.slice(0, -1) : head;
}

/** `text` with every lone surrogate and every NUL character replaced by
 * U+FFFD, the mark for a character that could not be kept. */
export function storableText(text: string): string {
  const wellFormed = text.toWellFormed();
  return wellFormed.includes('\u0000')
    ? wellFormed.replaceAll('\u0000', '�')
    : wellFormed;
}

/** A JSON value with every string in it, member names included, made
 * storable; a value that needs no change is returned as it is. */
export function storableJson<T>(value: T): T {
  return fix(value) as T;
}

function needsFix(text: string): boolean {
  return !text.isWellFormed() || text.includes('\u0000');
}

function fix(value: unknown): unknown {
  if (typeof value === 'string') {
    return needsFix(value) ? storableText(value) : value;
  }
  if (Array.isArray(value)) {
    let changed: unknown[] | null = null;
    for (let i = 0; i < value.length; i++) {
      const next = fix(value[i]);
      if (next !== value[i]) {
        changed ??= [...value];
        changed[i] = next;
      }
    }
    return changed ?? value;
  }
  if (value !== null && typeof value === 'object') {
    let changed: Record<string, unknown> | null = null;
    for (const [key, entry] of Object.entries(value)) {
      const nextKey = needsFix(key) ? storableText(key) : key;
      const next = fix(entry);
      if (next !== entry || nextKey !== key) {
        changed ??= { ...value };
        if (nextKey !== key) delete changed[key];
        Object.defineProperty(changed, nextKey, {
          value: next,
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
    }
    return changed ?? value;
  }
  return value;
}
