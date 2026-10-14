/**
 * The composer's side of choosing skills: which `/name` the caret is typing
 * at the start of the message, how a pick completes it, which skills match
 * what was typed, and which skills a conversation row uses.
 *
 * The grammar itself — what a turn reads as a chosen skill — is
 * `lib/skills/slash.ts`; this module only helps a person write it.
 *
 * Pure, so the typeahead's rules are tested without a browser.
 */

import { isSkillName } from '@/lib/skills/slash';
import { isRecord } from '@/lib/utils/type-utils';

/** The `/name` being typed: where it sits in the text and what is typed of
 * the name so far. */
export interface SkillToken {
  /** Index of the `/`. */
  readonly start: number;
  /** Index just past the last character typed of the name. */
  readonly end: number;
  readonly query: string;
}

/**
 * The `/name` the caret is typing, when it types one at the start of the
 * message — `/do|` or `/docx /x|` — and nothing when the caret is anywhere
 * else: in the message's words, or after a name already followed by a space.
 */
export function skillTokenAtCaret(
  text: string,
  caret: number,
): SkillToken | null {
  const before = text.slice(0, caret);
  // Name by name, never one pattern over the whole run: a pattern free to
  // split the spaces between names more than one way backtracks for seconds
  // on a pasted list of paths, and this runs on every keystroke.
  const whole = /\s*\/[a-z0-9]+(?:-[a-z0-9]+)*\s+/y;
  let at = 0;
  while (whole.exec(before) !== null) at = whole.lastIndex;
  const typed = /\s*\/([a-z0-9-]*)$/y;
  typed.lastIndex = at;
  const match = typed.exec(before);
  const query = match?.[1];
  if (match === null || query === undefined) return null;
  // The name goes on past the caret until whitespace: replacing a token
  // replaces all of it.
  const after = /^[a-z0-9-]*/.exec(text.slice(caret))?.[0] ?? '';
  return {
    start: caret - query.length - 1,
    end: caret + after.length,
    query,
  };
}

/** The text with `token` replaced by `/name ` — one space after it, never
 * two — and where the caret goes: right after that space. */
export function completeSkillToken(
  text: string,
  token: SkillToken,
  name: string,
): { text: string; caret: number } {
  const rest = text.slice(token.end).replace(/^[ \t]+/, '');
  const head = `${text.slice(0, token.start)}/${name} `;
  return { text: head + rest, caret: head.length };
}

/** The text with a `/` to type a skill's name in: at the start of the
 * message, after any names it already starts with, so the typeahead opens. */
export function insertSkillSlash(text: string): {
  text: string;
  caret: number;
} {
  const leading = /^(?:\s*\/[a-z0-9]+(?:-[a-z0-9]+)*(?=\s|$))*/.exec(text);
  const end = leading?.[0].length ?? 0;
  const head = text.slice(0, end);
  const tail = text.slice(end).replace(/^[ \t]+/, '');
  const separator = head.length > 0 ? ' ' : '';
  const before = `${head}${separator}/`;
  return {
    text: tail.length > 0 ? `${before} ${tail}` : before,
    caret: before.length,
  };
}

/** The skills whose name matches what was typed: names that start with it
 * first, then names that contain it, each in the order given. */
export function matchSkills<T extends { readonly slug: string }>(
  skills: readonly T[],
  query: string,
): T[] {
  const needle = query.toLowerCase();
  if (needle.length === 0) return [...skills];
  const starts = skills.filter((skill) => skill.slug.startsWith(needle));
  const contains = skills.filter(
    (skill) => !skill.slug.startsWith(needle) && skill.slug.includes(needle),
  );
  return [...starts, ...contains];
}

/** The skills a conversation row uses (`capabilities.skills`), read
 * structurally: anything that is not a skill's name is left out. */
export function conversationSkillsOf(capabilities: unknown): string[] {
  if (!isRecord(capabilities) || !Array.isArray(capabilities.skills)) {
    return [];
  }
  return capabilities.skills.filter(
    (name): name is string => typeof name === 'string' && isSkillName(name),
  );
}
