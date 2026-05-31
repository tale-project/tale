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

const MENTION_RE = /(?:^|\s)@([a-zA-Z0-9._-]+)/g;

export type MentionActorType = 'user' | 'agent';

export interface MentionDirectoryEntry {
  type: MentionActorType;
  /** Stable id used as `assigneeId`/`subscriberId` — a userId or agent slug. */
  id: string;
  /** The `@token` handle(s) that resolve to this entry, lowercased. */
  handles: string[];
}

export interface ResolvedMention {
  type: MentionActorType;
  id: string;
}

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
 * Resolve parsed tokens against a directory to `{type,id}` refs. Unknown tokens
 * are dropped; each resolved actor appears at most once (de-duped by type+id).
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
    const key = `${entry.type}:${entry.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ type: entry.type, id: entry.id });
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
