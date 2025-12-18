/**
 * Find and claim a single unprocessed open conversation where the latest message is inbound.
 */

import { MutationCtx } from '../../_generated/server';
import { Doc } from '../../_generated/dataModel';
import { findAndClaimUnprocessed } from './find_and_claim_unprocessed';
import { getLatestConversationMessage } from './get_latest_conversation_message';

export interface FindUnprocessedOpenConversationArgs {
  organizationId: string;
  wfDefinitionId: string;
  backoffHours: number;
}

export interface FindUnprocessedOpenConversationResult {
  conversation: Doc<'conversations'> | null;
}

export async function findUnprocessedOpenConversation(
  ctx: MutationCtx,
  args: FindUnprocessedOpenConversationArgs,
): Promise<FindUnprocessedOpenConversationResult> {
  const { organizationId, wfDefinitionId, backoffHours } = args;

  const cutoffDate = new Date();
  cutoffDate.setHours(cutoffDate.getHours() - backoffHours);
  const cutoffTimestamp = cutoffDate.toISOString();

  const result = await findAndClaimUnprocessed<Doc<'conversations'>>(ctx, {
    organizationId,
    tableName: 'conversations',
    wfDefinitionId,
    cutoffTimestamp,
    buildQuery: (resumeFrom) =>
      resumeFrom
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
            ),
    additionalFilter: async (conv) => {
      const latestMsg = await getLatestConversationMessage(ctx, conv._id);
      return latestMsg?.direction === 'inbound';
    },
  });

  return { conversation: result.document };
}
