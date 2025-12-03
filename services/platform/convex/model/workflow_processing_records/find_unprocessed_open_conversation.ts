/**
 * Find unprocessed open conversations with latest message being inbound.
 *
 * This is a specific implementation using the hook mechanism.
 */

import { QueryCtx } from '../../_generated/server';
import { Doc } from '../../_generated/dataModel';
import { findUnprocessedWithCustomQuery } from './helpers/find_unprocessed_with_custom_query';
import { getLatestConversationMessage } from './helpers/get_latest_conversation_message';

export interface FindUnprocessedOpenConversationArgs {
  organizationId: string;
  wfDefinitionId: string;
  backoffHours: number; // Number of hours to look back for processing records
}

export interface FindUnprocessedOpenConversationResult {
  conversations: Array<Doc<'conversations'>>;
  count: number;
}

/**
 * Find unprocessed open conversations where the latest message is inbound.
 *
 * This uses the hook mechanism (findUnprocessedWithCustomQuery) which handles all the boilerplate.
 * You only provide:
 * 1. A query builder function
 * 2. An optional additional filter
 *
 * Benefits:
 * - Less code to write
 * - Less chance of bugs
 * - Consistent behavior
 * - Easy to read and maintain
 */
export async function findUnprocessedOpenConversation(
  ctx: QueryCtx,
  args: FindUnprocessedOpenConversationArgs,
): Promise<FindUnprocessedOpenConversationResult> {
  const { organizationId, wfDefinitionId, backoffHours } = args;

  // Calculate cutoff timestamp from backoffHours
  const cutoffDate = new Date();
  cutoffDate.setHours(cutoffDate.getHours() - backoffHours);
  const cutoffTimestamp = cutoffDate.toISOString();

  const result = await findUnprocessedWithCustomQuery<Doc<'conversations'>>(
    ctx,
    {
      organizationId,
      tableName: 'conversations',
      wfDefinitionId,
      cutoffTimestamp,

      // Hook 1: Build your custom query with the right index
      buildQuery: (resumeFrom) => {
        // Use .gt() directly in the index query for better performance
        // _creationTime is automatically indexed in every Convex index
        return resumeFrom
          ? ctx.db
              .query('conversations')
              .withIndex('by_organizationId_and_status', (q) =>
                q
                  .eq('organizationId', organizationId)
                  .eq('status', 'open')
                  .gt('_creationTime', resumeFrom),
              )
          : ctx.db
              .query('conversations')
              .withIndex('by_organizationId_and_status', (q) =>
                q.eq('organizationId', organizationId).eq('status', 'open'),
              );
      },

      // Hook 2: Apply additional custom filter
      additionalFilter: async (conv) => {
        const latestMsg = await getLatestConversationMessage(ctx, conv._id);
        return latestMsg?.direction === 'inbound';
      },
    },
  );

  return {
    conversations: result.documents,
    count: result.count,
  };
}
