/**
 * Message-content search for the chat command palette.
 *
 * The chat list previously searched thread *titles* only. This query searches
 * the actual message text so "find the chat where we talked about X" works,
 * returning the chat title plus the matched message as the result snippet.
 *
 * There is no full-text index on messages (they live in the Agent component),
 * so this is a BOUNDED SCAN: the caller's most-recent threads, each with their
 * most-recent messages, substring-matched against the (AND-combined) query
 * tokens. The caps keep a single keystroke within Convex's per-query read
 * budget; threads / messages beyond the caps are intentionally not searched
 * (a deliberate recency bias, not silent truncation of an unbounded scan).
 */

import { listMessages, toUIMessages } from '@convex-dev/agent';
import { v } from 'convex/values';

import { components } from '../_generated/api';
import { query } from '../_generated/server';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';

const THREAD_SCAN_CAP = 40;
const MESSAGES_PER_THREAD = 30;
const RESULT_CAP = 25;
const SNIPPET_MAX = 600;

export const searchThreadMessages = query({
  args: {
    organizationId: v.string(),
    query: v.string(),
    teamId: v.optional(v.string()),
  },
  returns: v.array(
    v.object({
      threadId: v.string(),
      title: v.optional(v.string()),
      snippet: v.string(),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const identity = await getAuthUserIdentity(ctx);
    if (!identity) return [];

    const tokens = args.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return [];

    // Same recency-ordered, org/team-scoped slice the sidebar list uses.
    const threads = await ctx.db
      .query('threadMetadata')
      .withIndex('by_userId_chatType_status_updated', (q) =>
        q
          .eq('userId', identity.userId)
          .eq('chatType', 'general')
          .eq('status', 'active'),
      )
      .filter((q) => {
        let expr = q.neq(q.field('isBranch'), true);
        if (args.teamId) {
          expr = q.and(expr, q.eq(q.field('teamId'), args.teamId));
        }
        if (args.organizationId) {
          expr = q.and(
            expr,
            q.eq(q.field('organizationId'), args.organizationId),
          );
        }
        return expr;
      })
      .order('desc')
      .take(THREAD_SCAN_CAP);

    const results: {
      threadId: string;
      title?: string;
      snippet: string;
      createdAt: number;
    }[] = [];

    const matchesAll = (text: string): boolean => {
      const lower = text.toLowerCase();
      return tokens.every((tok) => lower.includes(tok));
    };

    for (const t of threads) {
      const titleMatches = !!t.title && matchesAll(t.title);

      const page = await listMessages(ctx, components.agent, {
        threadId: t.threadId,
        paginationOpts: { cursor: null, numItems: MESSAGES_PER_THREAD },
        excludeToolMessages: true,
      });
      // Reverse to chronological to match the rest of the app's toUIMessages
      // usage (it combines parts assuming chronological order).
      const uiMessages = toUIMessages(page.page.toReversed()).filter(
        (m) => m.role === 'user' || m.role === 'assistant',
      );

      // Prefer a matching message as the snippet; show the most recent match.
      let snippet: string | null = null;
      for (let i = uiMessages.length - 1; i >= 0; i--) {
        const text = uiMessages[i]?.text ?? '';
        if (text && matchesAll(text)) {
          snippet = text.slice(0, SNIPPET_MAX);
          break;
        }
      }

      if (snippet) {
        results.push({
          threadId: t.threadId,
          title: t.title,
          snippet,
          createdAt: t.updatedAt ?? t.createdAt,
        });
      } else if (titleMatches) {
        // Title matched but no scanned message did — keep the chat and preview
        // its most recent message as the description.
        const recent = uiMessages.at(-1);
        results.push({
          threadId: t.threadId,
          title: t.title,
          snippet: (recent?.text ?? '').slice(0, SNIPPET_MAX),
          createdAt: t.updatedAt ?? t.createdAt,
        });
      }

      if (results.length >= RESULT_CAP) break;
    }

    return results;
  },
});
