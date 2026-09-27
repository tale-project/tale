/**
 * Plain-text `@mention` parsing for task comments.
 *
 * Pure functions — the mutation layer supplies the directory of resolvable
 * actors so this stays unit-testable without a DB. Tokens that don't resolve
 * to a known member or agent are silently dropped (no notification fires for
 * them); duplicates are de-duped.
 *
 * The token regex requires a whitespace/string-start boundary before `@` so it
 * does NOT match email addresses (`user@example.com`) or decorators (`@dec`)
 * embedded in a word.
 */

const MENTION_RE = /(?:^|\s)@([a-zA-Z0-9._/-]+)/g;

export type MentionActorType = 'user' | 'agent' | 'automation';

export interface MentionDirectoryEntry {
  type: MentionActorType;
  /** Stable id used as `assigneeId`/`subscriberId` — a userId, an agent
   *  instance id, or an automation's store name. */
  id: string;
  /** The `@token` handle(s) that resolve to this entry, lowercased. */
  handles: string[];
}

export interface ResolvedMention {
  type: MentionActorType;
  id: string;
}

/** Which text named the agent on a `mention` kick or steer: a posted
 * comment, whose body the run carries as its feedback, or the task
 * description, which the turn reads as it stands when it starts. */
export type MentionSource = 'comment' | 'description';

/**
 * Extract raw `@token` handles from a comment body (without the leading `@`),
 * de-duped and lowercased, preserving first-seen order.
 */
export function parseMentionTokens(body: string): string[] {
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const match of body.matchAll(MENTION_RE)) {
    const token = match[1].toLowerCase();
    if (!seen.has(token)) {
      seen.add(token);
      tokens.push(token);
    }
  }
  return tokens;
}

/**
 * Resolve parsed tokens against a directory to `{type,id}` refs. Unknown
 * tokens are dropped. Each resolved actor appears at most once (de-duped by
 * type+id).
 */
export function resolveMentions(
  tokens: string[],
  directory: MentionDirectoryEntry[],
): ResolvedMention[] {
  if (tokens.length === 0) return [];

  const handleToEntry = new Map<string, MentionDirectoryEntry>();
  for (const entry of directory) {
    for (const handle of entry.handles) {
      handleToEntry.set(handle.toLowerCase(), entry);
    }
  }

  const result: ResolvedMention[] = [];
  const seen = new Set<string>();
  for (const token of tokens) {
    const entry = handleToEntry.get(token);
    if (!entry) continue;
    const resolved: ResolvedMention = { type: entry.type, id: entry.id };
    const key = `${resolved.type}:${resolved.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(resolved);
  }
  return result;
}

/** Convenience: parse + resolve in one call. */
export function extractMentions(
  body: string,
  directory: MentionDirectoryEntry[],
): ResolvedMention[] {
  return resolveMentions(parseMentionTokens(body), directory);
}

/** `@tokens` present in the body that did not resolve against the directory. */
export function findUnresolvedMentionTokens(
  body: string,
  directory: MentionDirectoryEntry[],
): string[] {
  const handleToEntry = new Map<string, MentionDirectoryEntry>();
  for (const entry of directory) {
    for (const handle of entry.handles) {
      handleToEntry.set(handle.toLowerCase(), entry);
    }
  }
  const unresolved: string[] = [];
  for (const token of parseMentionTokens(body)) {
    if (!handleToEntry.has(token)) unresolved.push(token);
  }
  return unresolved;
}

/**
 * Mentions present in `next` but not `previous` — what a description or
 * comment EDIT newly introduces. Editing prose around an existing `@mention`
 * must not re-notify (or re-trigger) the actors already mentioned before the
 * edit.
 */
export function addedMentions(
  previous: ResolvedMention[],
  next: ResolvedMention[],
): ResolvedMention[] {
  const seen = new Set(previous.map((m) => `${m.type}:${m.id}`));
  return next.filter((m) => !seen.has(`${m.type}:${m.id}`));
}
