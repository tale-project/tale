/**
 * Where an `@` mention is being typed: the `@` before the caret and what
 * follows it.
 *
 * Names have spaces ("Ada Lovelace", "My Opus Agent #3"), so the query runs
 * across single spaces, up to {@link MENTION_QUERY_MAX_WORDS} words; a field
 * closes its picker once a query that has a space finds nobody. A newline,
 * a second `@` or a doubled space ends it. An `@` inside a word (an email
 * address) opens nothing.
 *
 * Pure, no React.
 */

export interface MentionTrigger {
  /** What was typed after the `@`, possibly empty or ending in a space. */
  query: string;
  /** Where the `@` stands. */
  start: number;
  /** The caret: the end of the query. */
  end: number;
}

/** How many words a query may run across. */
const MENTION_QUERY_MAX_WORDS = 3;

const TRIGGER_RE = new RegExp(
  String.raw`(^|\s)@((?:[^\s@]+ ){0,${MENTION_QUERY_MAX_WORDS - 1}}[^\s@]*)$`,
  'u',
);

export function detectMentionTrigger(
  value: string,
  caret: number,
): MentionTrigger | null {
  const beforeCaret = value.slice(0, Math.max(caret, 0));
  const match = TRIGGER_RE.exec(beforeCaret);
  if (match === null) return null;
  const query = match[2] ?? '';
  return {
    query,
    start: beforeCaret.length - query.length - 1,
    end: beforeCaret.length,
  };
}
