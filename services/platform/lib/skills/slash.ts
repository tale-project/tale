/**
 * The skills a message chooses by naming them at its start — `/docx Write
 * the cover letter`, or `/xlsx /brand-voice` for two.
 *
 * One grammar for every door that carries a message: the composer's `/`
 * typeahead writes it, a REST caller types it in `content`, and the turn
 * reads it back from the stored text. The words stay the person's own — the
 * message keeps them as written, and a name that is no skill the person can
 * use is simply text.
 *
 * Layer A: pure.
 */

/** The most skills one reply reads because the person chose them — as many
 * as one program can use at once (`RUN_CODE_MAX_SKILLS`). */
export const CHOSEN_SKILLS_MAX = 4;

/** A skill's name as its folder spells it (`backend/core/skills`). */
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SKILL_NAME_MAX_CHARS = 64;

/** One `/name` token at the start of what is left, followed by whitespace
 * or the end. */
const LEADING_TOKEN = /^\s*\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$)/;

/** How many leading tokens are read at most — a long run of slashes is
 * text, not a pick. */
const LEADING_TOKENS_READ = 10;

/** Whether `name` is spelled as a skill's name. */
export function isSkillName(name: string): boolean {
  return name.length <= SKILL_NAME_MAX_CHARS && SKILL_NAME.test(name);
}

/**
 * The skill names `text` starts with, in order and once each:
 * `"/docx /pdf Make it"` → `["docx", "pdf"]`. A token must be followed by
 * whitespace or the end — `/etc/hosts` names nothing.
 */
export function leadingSkillNames(text: string): string[] {
  const names: string[] = [];
  let rest = text;
  for (let read = 0; read < LEADING_TOKENS_READ; read += 1) {
    const match = LEADING_TOKEN.exec(rest);
    const name = match?.[1];
    if (match === null || name === undefined) break;
    if (isSkillName(name) && !names.includes(name)) names.push(name);
    rest = rest.slice(match[0].length);
  }
  return names;
}

/**
 * What `text` says after the skill names it starts with — the words that
 * name the conversation: `"/xlsx Make a table"` → `"Make a table"`. A
 * message that is nothing but names stays as it is.
 */
export function withoutLeadingSkillNames(text: string): string {
  let rest = text;
  for (let read = 0; read < LEADING_TOKENS_READ; read += 1) {
    const match = LEADING_TOKEN.exec(rest);
    const name = match?.[1];
    if (match === null || name === undefined || !isSkillName(name)) break;
    rest = rest.slice(match[0].length);
  }
  const words = rest.trim();
  return words.length > 0 ? words : text;
}

/**
 * The skills a reply reads because the person chose them: those the message
 * names at its start, then those the conversation uses, once each, kept to
 * the ones `available` holds — the person's own library as a turn sees it —
 * and at most {@link CHOSEN_SKILLS_MAX}.
 */
export function chosenSkills(
  messageText: string,
  conversationSkills: readonly string[],
  available: ReadonlySet<string>,
): string[] {
  const chosen: string[] = [];
  for (const name of [
    ...leadingSkillNames(messageText),
    ...conversationSkills,
  ]) {
    if (chosen.length >= CHOSEN_SKILLS_MAX) break;
    if (available.has(name) && !chosen.includes(name)) chosen.push(name);
  }
  return chosen;
}
