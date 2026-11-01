/**
 * Who a mention picker offers, and which of them a query finds.
 *
 * Pure, no React (an option's avatar is the caller's node).
 */

import type { ReactNode } from 'react';

import type { MentionRef } from './mention-token';

export interface MentionOption<
  Kind extends string = string,
> extends MentionRef<Kind> {
  /** What the mention reads as once picked. */
  name: string;
  /** A second line: a handle, an email, what kind of actor it is. */
  caption?: string;
  /** Other words the option is found by: its handle, an email address. */
  keywords?: readonly string[];
  avatar?: ReactNode;
}

/** How many options a picker lists at most. */
export const MENTION_OPTIONS_MAX = 8;

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/gu, ' ');
}

/**
 * The options a query finds, best first: one whose name, a word of its name
 * or a keyword starts with the query, then any that contains it. A query
 * with spaces finds handles with hyphens too ("my opus" finds
 * `my-opus-agent-3`).
 */
export function filterMentionOptions<Option extends MentionOption>(
  options: readonly Option[],
  query: string,
  max: number = MENTION_OPTIONS_MAX,
): Option[] {
  const q = normalize(query);
  if (q === '') return options.slice(0, max);
  const hyphenated = q.replaceAll(' ', '-');
  const scored: { option: Option; score: number; order: number }[] = [];
  options.forEach((option, order) => {
    const name = normalize(option.name);
    const keywords = (option.keywords ?? []).map(normalize);
    const words = [name, ...keywords];
    const starts =
      words.some((word) => word.startsWith(q) || word.startsWith(hyphenated)) ||
      name.split(' ').some((part) => part.startsWith(q));
    const contains =
      starts ||
      words.some((word) => word.includes(q) || word.includes(hyphenated));
    if (contains) scored.push({ option, score: starts ? 0 : 1, order });
  });
  return scored
    .toSorted((a, b) => a.score - b.score || a.order - b.order)
    .slice(0, max)
    .map((entry) => entry.option);
}
