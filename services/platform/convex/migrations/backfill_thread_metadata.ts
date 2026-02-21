/**
 * Migration: Backfill threadMetadata shadow table from agent component threads.
 *
 * Iterates all users with threads, then for each user fetches their threads
 * and creates shadow records. Idempotent — skips threads that already have
 * shadow records.
 *
 * Usage:
 *   npx convex run migrations/backfill_thread_metadata:backfillThreadMetadata
 */

import { parseJson } from '../../lib/utils/type-cast-helpers';
import { components } from '../_generated/api';
import { internalMutation } from '../_generated/server';

const USERS_PAGE_SIZE = 100;
const THREADS_PAGE_SIZE = 200;

export const backfillThreadMetadata = internalMutation({
  args: {},
  handler: async (ctx) => {
    let created = 0;
    let skipped = 0;

    let userCursor: string | null = null;
    let usersDone = false;

    while (!usersDone) {
      const usersResult: {
        page: string[];
        isDone: boolean;
        continueCursor: string;
      } = await ctx.runQuery(components.agent.users.listUsersWithThreads, {
        paginationOpts: { cursor: userCursor, numItems: USERS_PAGE_SIZE },
      });

      for (const userId of usersResult.page) {
        let threadCursor: string | null = null;
        let threadsDone = false;

        while (!threadsDone) {
          const threadsResult: {
            page: {
              _id: string;
              _creationTime: number;
              status: 'active' | 'archived';
              summary?: string;
              title?: string;
              userId?: string;
            }[];
            isDone: boolean;
            continueCursor: string;
          } = await ctx.runQuery(components.agent.threads.listThreadsByUserId, {
            userId,
            order: 'desc',
            paginationOpts: {
              cursor: threadCursor,
              numItems: THREADS_PAGE_SIZE,
            },
          });

          for (const thread of threadsResult.page) {
            const existing = await ctx.db
              .query('threadMetadata')
              .withIndex('by_threadId', (q) => q.eq('threadId', thread._id))
              .first();

            if (existing) {
              skipped++;
              continue;
            }

            let chatType: 'general' | 'workflow_assistant' | 'agent_test' =
              'general';
            if (thread.summary) {
              try {
                const parsed = parseJson<{ chatType?: string }>(thread.summary);
                if (
                  parsed.chatType === 'workflow_assistant' ||
                  parsed.chatType === 'agent_test'
                ) {
                  chatType = parsed.chatType;
                }
              } catch {
                // Default to general
              }
            }

            await ctx.db.insert('threadMetadata', {
              threadId: thread._id,
              userId: thread.userId ?? userId,
              chatType,
              status: thread.status ?? 'active',
              title: thread.title,
              createdAt: thread._creationTime,
            });
            created++;
          }

          threadCursor = threadsResult.continueCursor;
          threadsDone = threadsResult.isDone;
        }
      }

      userCursor = usersResult.continueCursor;
      usersDone = usersResult.isDone;
    }

    return { created, skipped };
  },
});
