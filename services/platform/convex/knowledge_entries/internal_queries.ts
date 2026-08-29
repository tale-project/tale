import { v } from 'convex/values';

import type { Doc } from '../_generated/dataModel';
import { internalQuery } from '../_generated/server';
import {
  cursorPaginationOptsValidator,
  paginateWithFilter,
} from '../lib/pagination';
import { knowledgeEntriesSearchStrategy } from '../lib/search/strategies/knowledge_entries';
import { matchesAnyWord } from '../lib/search/word_match';

export const getEntryById = internalQuery({
  args: {
    entryId: v.id('knowledgeEntries'),
  },
  handler: async (ctx, args): Promise<Doc<'knowledgeEntries'> | null> => {
    return await ctx.db.get(args.entryId);
  },
});

/**
 * The workspace bridge's `knowledge_entry_find`: the LIVE entries only —
 * `active` rows whose chain is not soft-deleted — projected down to what an
 * agent needs. Superseded versions and delete tombstones are audit history,
 * not knowledge; they never leave this module. Access control (membership +
 * role) is the DISPATCHER's duty, like every other internal read here.
 */
export const listEntriesForAgent = internalQuery({
  args: {
    organizationId: v.string(),
    /** Case-insensitive contains-filter on the topic. */
    topic: v.optional(v.string()),
    /**
     * Also match individual WORDS of `topic`, not only the whole phrase. The
     * chat leg passes a question rather than a topic, so the phrase alone
     * matches nothing.
     */
    matchWords: v.optional(v.boolean()),
    paginationOpts: cursorPaginationOptsValidator,
  },
  returns: v.object({
    page: v.array(
      v.object({
        topic: v.string(),
        content: v.string(),
        source: v.union(v.literal('chat'), v.literal('manual')),
        createdAt: v.number(),
      }),
    ),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const topicLower = args.topic?.trim().toLowerCase() || undefined;
    const wordTerm = args.matchWords === true ? args.topic?.trim() : undefined;
    const result = await paginateWithFilter(
      ctx.db
        .query('knowledgeEntries')
        .withIndex('by_organizationId_and_status', (q) =>
          q.eq('organizationId', args.organizationId).eq('status', 'active'),
        )
        .order('desc'),
      {
        numItems: args.paginationOpts.numItems,
        cursor: args.paginationOpts.cursor,
        filter: (entry) =>
          entry.deletedAt === undefined &&
          (topicLower === undefined ||
            // Words first — the phrase checks below still decide on their own.
            (wordTerm !== undefined &&
              matchesAnyWord(
                entry,
                knowledgeEntriesSearchStrategy,
                wordTerm,
              )) ||
            entry.topic.toLowerCase().includes(topicLower) ||
            entry.topicKey.includes(topicLower)),
      },
    );
    return {
      page: result.page.map((entry) => ({
        topic: entry.topic,
        content: entry.content,
        source: entry.source,
        createdAt: entry.createdAt,
      })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});
