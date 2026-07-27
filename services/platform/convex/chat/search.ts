/**
 * Chat search for the ⌘K palette — a bounded, recency-biased scan.
 *
 * Full-text search indexes are disabled repo-wide (see the
 * `TODO(search-index-disabled)` doctrine in `convex/lib/search/`), so this
 * walks the caller's newest ACTIVE threads and, per thread, their newest
 * messages, AND-matching lowercased tokens. The caps mirror the retired
 * implementation's budget: recent conversations are where searches land, and
 * a bounded miss beats an unbounded walk.
 */

import { v } from 'convex/values';

import { query } from '../_generated/server';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';

/** Newest threads scanned per search. */
const SCAN_THREADS = 40;
/** Newest messages scanned per thread. */
const SCAN_MESSAGES = 30;
/** Results returned at most. */
const MAX_RESULTS = 25;
/** Snippet budget — enough context, never a whole essay. */
const SNIPPET_MAX_CHARS = 600;

/** The text surface of a message's parts, lowercase-matched below. */
function textOfParts(parts: unknown): string {
  if (!Array.isArray(parts)) return '';
  let out = '';
  for (const part of parts) {
    if (
      part !== null &&
      typeof part === 'object' &&
      'type' in part &&
      part.type === 'text' &&
      'text' in part &&
      typeof part.text === 'string'
    ) {
      out += `${part.text} `;
    }
  }
  return out;
}

function matchesEveryToken(
  haystack: string,
  tokens: readonly string[],
): boolean {
  return tokens.every((token) => haystack.includes(token));
}

export const searchChats = query({
  args: { organizationId: v.string(), query: v.string() },
  returns: v.array(
    v.object({
      threadId: v.id('threads'),
      title: v.optional(v.string()),
      snippet: v.string(),
      updatedAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new Error('Unauthenticated');
    await getOrganizationMember(ctx, args.organizationId, authUser);

    const tokens = args.query
      .toLowerCase()
      .split(/\s+/)
      .filter((token) => token.length > 0);
    if (tokens.length === 0) return [];

    const threads = await ctx.db
      .query('threads')
      .withIndex('by_user_list', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('userId', authUser.userId)
          .eq('archived', false)
          .eq('lifecycleStatus', undefined)
          .eq('hidden', undefined),
      )
      .order('desc')
      .take(SCAN_THREADS);

    const results: Array<{
      threadId: (typeof threads)[number]['_id'];
      title?: string;
      snippet: string;
      updatedAt: number;
    }> = [];

    for (const thread of threads) {
      if (results.length >= MAX_RESULTS) break;

      const titleMatches = matchesEveryToken(
        (thread.title ?? '').toLowerCase(),
        tokens,
      );
      const recent = await ctx.db
        .query('messages')
        .withIndex('by_thread_sequence', (q) =>
          q.eq('threadId', String(thread._id)),
        )
        .order('desc')
        .take(SCAN_MESSAGES);
      const matchingMessage = recent.find((message) =>
        matchesEveryToken(textOfParts(message.parts).toLowerCase(), tokens),
      );

      if (!titleMatches && matchingMessage === undefined) continue;

      const snippetSource =
        matchingMessage !== undefined
          ? textOfParts(matchingMessage.parts)
          : textOfParts(recent[0]?.parts);
      results.push({
        threadId: thread._id,
        title: thread.title,
        snippet: snippetSource.trim().slice(0, SNIPPET_MAX_CHARS),
        updatedAt: thread.updatedAt,
      });
    }

    return results;
  },
});
