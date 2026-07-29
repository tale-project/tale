/**
 * Trigger detection for the composer's `/` command. Mirrors the server
 * grammar (`lib/skills/slash.ts`): a command is a `/` at character 0
 * followed by slug characters — so the typeahead is open exactly while the
 * caret is still inside that first token, and closes the moment a space
 * follows (the args are ordinary text). The typeahead is a discovery
 * affordance only; the server re-parses the sent text.
 */

export interface SlashTrigger {
  /** What the user typed after the `/`, may be empty. */
  readonly query: string;
  /** Replace range for a completion: always from 0 to `end`. */
  readonly end: number;
}

const SLASH_TOKEN_REGEX = /^\/([a-z0-9-]*)$/;

/** The active trigger, or `null` when the popover must be closed. */
export function detectSlashTrigger(
  value: string,
  caret: number,
): SlashTrigger | null {
  if (!value.startsWith('/')) return null;
  const beforeCaret = value.slice(0, Math.max(caret, 0));
  const match = SLASH_TOKEN_REGEX.exec(beforeCaret);
  if (!match) return null;
  return { query: match[1], end: beforeCaret.length };
}

interface SlashSkillOption {
  readonly slug: string;
  readonly usageMode?: 'chat' | 'agent' | 'all';
}

/**
 * The skills the `/` menu offers for `trigger`: chat-usable (the server
 * already narrows its catalog to the chat surface — this is belt and
 * braces) and prefix-first matching on the slug.
 */
export function filterSlashSkills<T extends SlashSkillOption>(
  skills: readonly T[],
  trigger: SlashTrigger,
): T[] {
  const chatUsable = skills.filter((skill) => {
    const mode = skill.usageMode ?? 'all';
    return mode === 'chat' || mode === 'all';
  });
  const needle = trigger.query.toLowerCase();
  if (needle === '') return [...chatUsable];
  const prefixed = chatUsable.filter((skill) => skill.slug.startsWith(needle));
  const infixed = chatUsable.filter(
    (skill) => !skill.slug.startsWith(needle) && skill.slug.includes(needle),
  );
  return [...prefixed, ...infixed];
}

/** The composer text after completing `trigger` with `slug`. */
export function completeSlashCommand(
  value: string,
  trigger: SlashTrigger,
  slug: string,
): { text: string; caret: number } {
  const completed = `/${slug} `;
  return {
    text: completed + value.slice(trigger.end),
    caret: completed.length,
  };
}
