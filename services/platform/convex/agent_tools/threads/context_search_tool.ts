/**
 * Convex Tool: Context Search
 *
 * Search for messages in a thread by similarity to a search query.
 * Uses Fuse.js for fuzzy matching and returns the top 10 most similar messages,
 * along with 1 message before and 1 message after each match for context.
 */

import { z } from 'zod';
import { createTool, type ToolCtx } from '@convex-dev/agent';
import Fuse from 'fuse.js';
import type { ToolDefinition } from '../types';
import { components } from '../../_generated/api';
import { listMessages } from '@convex-dev/agent';

import { createDebugLog } from '../../lib/debug_log';

const debugLog = createDebugLog('DEBUG_AGENT_TOOLS', '[AgentTools]');

interface SearchResultMessage {
  _id: string;
  _creationTime: number;
  role: string;
  content: string;
  score: number;
  isContext?: boolean; // true if this is a surrounding context message, not a direct match
  truncated?: boolean; // true if content was truncated due to global size limits
}

interface ContextSearchResult {
  messages: SearchResultMessage[];
  totalMessagesSearched: number;
  query: string;
}

interface MessageForSearch {
  _id: string;
  _creationTime: number;
  role: string;
  content: string;
  originalIndex: number; // Track original position for context retrieval
}

export const contextSearchTool = {
  name: 'context_search' as const,
  tool: createTool({
    description: `Search for messages in a thread by similarity to a search query.
Retrieves messages from the specified thread and returns the top 10 most similar messages based on text similarity.
Each matched message includes 1 message before and 1 message after for context.
Provide a single, focused keyword or short phrase per call. If you need to search for multiple distinct keywords, call this tool multiple times, once per keyword or phrase, instead of combining them with boolean operators or complex queries such as 
"Apps_with_love_Enhanced_Report_Icons OR 72938217 OR \"Icons Edition\"".
	If an initial search does not return any relevant results (for example, an empty messages array), you MUST proactively try again with 3 to 5 alternative, more focused queries in separate calls before concluding that there is no useful context to retrieve.
	When the user asks to regenerate or modify a specific file, first try searching using that files URL or file name as the query so you can retrieve any prior messages, code snippets, or discussions related to that file.
	Use this tool to find relevant context from previous messages in a conversation thread.`,
    args: z.object({
      threadId: z.string().describe('The thread ID to search messages in.'),
      query: z
        .string()
        .describe('Search query to match against message content'),
    }),
    handler: async (ctx: ToolCtx, args): Promise<ContextSearchResult> => {
      const { threadId, query } = args;
      // We always cap the number of *direct* matches at 10. Even if more
      // messages match the query, only the best 10 are used for subsequent
      // steps (context expansion and content budgeting).
      const maxMatches = 10;
      const MAX_TOTAL_CONTENT_CHARS = 100_000;

      debugLog('tool:context_search start', {
        threadId,
        query,
        maxMatches,
      });

      // Fuse.js options for fuzzy search
      const fuseOptions = {
        keys: ['content'],
        includeScore: true,
        threshold: 0.2, // Lower = more strict matching; 0.2 = very strict (almost exact matches)
        ignoreLocation: true, // Match anywhere in the string
        minMatchCharLength: 10,
      };

      // First, collect all messages to enable context retrieval
      const allMessages: MessageForSearch[] = [];
      let cursor: string | null = null;
      let isDone = false;
      const PAGE_SIZE = 100;

      while (!isDone) {
        const result = await listMessages(ctx, components.agent, {
          threadId,
          paginationOpts: { cursor, numItems: PAGE_SIZE },
        });

        // Transform to searchable format directly from MessageDoc
        for (const doc of result.page) {
          const role = (doc.message?.role as string) || 'unknown';
          // Filter out all user input messages; the agent already has them
          // in the thread, and we only want assistant/tool/content messages
          // as retrievable context here.
          if (role === 'user') continue;

          const rawContent = doc.message?.content;
          let searchableContent: string | null = null;

          if (typeof rawContent === 'string' && rawContent.trim().length > 0) {
            // Regular text message
            searchableContent = rawContent;
          } else if (rawContent && typeof rawContent === 'object') {
            // Object content (arrays, tool results, etc.) - serialize to JSON for searching
            const serialized = JSON.stringify(rawContent);
            if (serialized.length > 2) {
              // More than just "{}" or "[]"
              searchableContent = serialized;
            }
          }

          if (searchableContent) {
            allMessages.push({
              _id: doc._id,
              _creationTime: doc._creationTime,
              role,
              content: searchableContent,
              originalIndex: allMessages.length,
            });
          }
        }

        cursor = result.continueCursor;
        isDone = result.isDone;

        debugLog('tool:context_search page collected', {
          threadId,
          pageSize: result.page.length,
          totalCollected: allMessages.length,
          isDone,
        });
      }

      const totalMessagesSearched = allMessages.length;

      // Search all messages
      const fuse = new Fuse(allMessages, fuseOptions);
      const searchResults = fuse.search(query);

      // Take top matches based on score (hard-capped at 10 direct matches)
      const topMatches = searchResults.slice(0, maxMatches);

      // Collect indices of messages to include (matches + context)
      const indicesToInclude = new Set<number>();
      const matchIndices = new Set<number>();

      for (const res of topMatches) {
        const idx = res.item.originalIndex;
        matchIndices.add(idx);
        indicesToInclude.add(idx);

        // Add previous message (if exists)
        if (idx > 0) {
          indicesToInclude.add(idx - 1);
        }

        // Add next message (if exists)
        if (idx < allMessages.length - 1) {
          indicesToInclude.add(idx + 1);
        }
      }

      // Build result messages with context markers
      const resultMessages: SearchResultMessage[] = [];
      const scoreMap = new Map<number, number>();

      // Map original indices to their scores (higher is better). The
      // surrounding context messages (previous/next) share the exact same
      // score as their matched message, so a match with score 0.9 will
      // give its neighbors a score of 0.9 as well.
      for (const res of topMatches) {
        const idx = res.item.originalIndex;
        const baseScore = 1 - (res.score ?? 1);
        scoreMap.set(idx, baseScore);

        if (idx > 0 && !scoreMap.has(idx - 1)) {
          scoreMap.set(idx - 1, baseScore);
        }
        if (idx < allMessages.length - 1 && !scoreMap.has(idx + 1)) {
          scoreMap.set(idx + 1, baseScore);
        }
      }

      // Sort indices to maintain chronological order within each context group
      const sortedIndices = Array.from(indicesToInclude).sort((a, b) => a - b);

      for (const idx of sortedIndices) {
        const msg = allMessages[idx];
        const isMatch = matchIndices.has(idx);
        resultMessages.push({
          _id: msg._id,
          _creationTime: msg._creationTime,
          role: msg.role,
          content: msg.content,
          score: scoreMap.get(idx) ?? 0,
          isContext: !isMatch,
        });
      }

      // Enforce a global content cap across all returned messages.
      // 1) Sort primarily by semantic match score (higher is better),
      //    and use recency as a tie-breaker when scores are equal.
      const sortedByScoreThenRecency = [...resultMessages].sort((a, b) => {
        const scoreA = a.score ?? 0;
        const scoreB = b.score ?? 0;

        if (scoreA !== scoreB) {
          return scoreB - scoreA;
        }

        return b._creationTime - a._creationTime;
      });

      let totalContentChars = 0;
      const picked: SearchResultMessage[] = [];

      // 2) Walk once, filling the 100k budget in that order.
      for (const msg of sortedByScoreThenRecency) {
        const remaining = MAX_TOTAL_CONTENT_CHARS - totalContentChars;
        if (remaining <= 0) break;

        const content = msg.content ?? '';
        if (content.length <= remaining) {
          totalContentChars += content.length;
          picked.push(msg);
        } else {
          picked.push({
            ...msg,
            content: content.slice(0, remaining),
            truncated: true,
          });
          totalContentChars += remaining;
          break;
        }
      }

      // 3) Keep results in score-prioritized order (best match first,
      //    newest first as a tie-breaker).
      debugLog('tool:context_search complete', {
        threadId,
        query,
        totalSearched: totalMessagesSearched,
        matchesFound: topMatches.length,
        resultsWithContext: picked.length,
        totalContentChars,
      });

      return {
        messages: picked,
        totalMessagesSearched,
        query,
      };
    },
  }),
} as const satisfies ToolDefinition;
