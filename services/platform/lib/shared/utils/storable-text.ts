/**
 * Text as Postgres can keep it in jsonb. A JavaScript string may hold what
 * jsonb refuses — a lone half of a surrogate pair (half an emoji, from a
 * cut or from a program's output) or a NUL character — and one such string
 * fails the whole write it rides in. Runtime-agnostic and pure: the engine's
 * record core and the stores share it.
 */

/** Why a door refuses a text with a NUL character in it. */
export const NUL_TEXT_PROBLEM = 'must not contain a NUL character (U+0000)';

/** Why a door refuses a text with half a surrogate pair in it. */
export const SURROGATE_TEXT_PROBLEM =
  'must not contain an unpaired UTF-16 surrogate (U+D800–U+DFFF), which cannot be stored';

/** What keeps Postgres from storing `text` as it is — a NUL first, then an
 * unpaired surrogate — or null when it stores it. */
export function unstorableTextProblem(text: string): string | null {
  if (text.includes('\u0000')) return NUL_TEXT_PROBLEM;
  return text.isWellFormed() ? null : SURROGATE_TEXT_PROBLEM;
}

/** One text in a JSON value that Postgres could not store: where (an RFC
 * 6901 pointer, the member's own when its name is the text) and why. */
export interface UnstorableText {
  readonly pointer: string;
  readonly problem: string;
}

/** Every text in a JSON value — a value or a member name — that Postgres
 * could not store, in document order. */
export function unstorableTexts(value: unknown): UnstorableText[] {
  const found: UnstorableText[] = [];
  const walk = (entry: unknown, pointer: string): void => {
    if (typeof entry === 'string') {
      const problem = unstorableTextProblem(entry);
      if (problem !== null) found.push({ pointer, problem });
    } else if (Array.isArray(entry)) {
      entry.forEach((item, index) => walk(item, `${pointer}/${index}`));
    } else if (entry !== null && typeof entry === 'object') {
      for (const [name, item] of Object.entries(entry)) {
        const at = `${pointer}/${name.replaceAll('~', '~0').replaceAll('/', '~1')}`;
        const problem = unstorableTextProblem(name);
        if (problem !== null) found.push({ pointer: at, problem });
        walk(item, at);
      }
    }
  };
  walk(value, '');
  return found;
}

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

/** How many characters of a value a report quotes. */
export const REPORT_CHARS = 200;

/**
 * Text as a test report keeps it: storable, and past `chars` characters cut
 * there with "…" (never through a character that takes two units). It lives
 * here, with the text helpers it is made of, so the wire schemas that cut
 * stored names the same way do not load the value diff.
 */
export function reportText(text: string, chars = REPORT_CHARS): string {
  return text.length > chars
    ? `${storableText(cutText(text, chars))}…`
    : storableText(text);
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
