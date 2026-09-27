export interface MentionTrigger {
  /** Text typed after the `@` (may be empty right after typing `@`). */
  query: string;
  /** Index of the `@` character in the textarea value. */
  start: number;
  /** Caret position — end of the query. */
  end: number;
}

/**
 * Caret-based `@` trigger detection: the token between the last
 * `@` (at a word boundary) and the caret, with no whitespace in between.
 * Mid-word `@` (e.g. an email address) does not trigger.
 */
export function detectMentionTrigger(
  value: string,
  caret: number,
): MentionTrigger | null {
  const beforeCaret = value.slice(0, Math.max(caret, 0));
  const match = /(^|\s)@(\S*)$/.exec(beforeCaret);
  if (!match) return null;
  const query = match[2];
  return {
    query,
    start: beforeCaret.length - query.length - 1,
    end: beforeCaret.length,
  };
}
