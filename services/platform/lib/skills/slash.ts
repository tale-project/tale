/**
 * The chat composer's `/` command, parsed the way Claude Code parses one: a
 * message whose FIRST character is `/` followed by a skill slug invokes that
 * skill for that single message, and everything after the slug is the
 * skill's arguments.
 *
 * There is deliberately no escape syntax. A message that does not match the
 * grammar — `//`, `/Not-a-slug`, a leading space, a slug no visible skill
 * answers to — is ordinary text and is sent verbatim; that fallthrough IS
 * the escape hatch. The server re-parses the stored message text with this
 * same function, so the composer's typeahead is a discovery affordance, never
 * a protocol.
 *
 * Layer A discipline: pure string work over the shared slug rules, safe to
 * import from the browser, V8 Convex, and `'use node'` alike.
 */

import { isValidSkillSlug } from '../shared/schemas/skills';

/** A recognized `/slug args` message. */
export interface SlashInvocation {
  /** The invoked skill's slug, already shape- and reserved-checked. */
  readonly slug: string;
  /** Whatever followed the slug, trimmed; `''` when nothing did. */
  readonly args: string;
}

/**
 * Matches `/slug` at character 0 — no leading whitespace (a pasted snippet
 * indented with spaces is prose, not a command) — with optional arguments
 * after the first whitespace, which may span lines.
 */
const SLASH_INVOCATION_REGEX = /^\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:\s([\s\S]*))?$/;

/**
 * Parse a raw, untrimmed message into a slash invocation, or `null` when the
 * message is ordinary text. A `null` never means an error — it means "send
 * it as it is".
 */
export function parseSlashInvocation(text: string): SlashInvocation | null {
  const match = SLASH_INVOCATION_REGEX.exec(text);
  if (match === null) return null;
  const slug = match[1];
  // The regex admits shapes the slug rules refuse (over-long, reserved);
  // those read as prose too.
  if (!isValidSkillSlug(slug)) return null;
  return { slug, args: (match[2] ?? '').trim() };
}
