import { saveMessage } from '@convex-dev/agent';
import { v } from 'convex/values';

import type { MutationCtx } from '../_generated/server';
import type { SerializableAgentConfig } from '../lib/agent_chat/types';

import { components, internal } from '../_generated/api';
import { persistentStreaming } from '../streaming/helpers';

export const DEFAULT_AGENT_CONFIG: SerializableAgentConfig = {
  name: 'chat-agent',
  instructions: '',
  convexToolNames: [],
  model: 'default',
  knowledgeMode: 'off' as const,
  webSearchMode: 'off' as const,
  includeTeamKnowledge: false,
  includeOrgKnowledge: false,
  knowledgeFileIds: [],
  structuredResponsesEnabled: true,
  timeoutMs: 1_200_000,
};

export const approvalReturnValidator = v.object({
  success: v.boolean(),
  threadId: v.optional(v.string()),
  streamId: v.optional(v.string()),
});

/**
 * Shared handler for triggering agent response after an async operation
 * (integration or workflow) completes. Saves a system message, creates
 * a stream, and schedules agent generation.
 */
export async function triggerCompletionResponseHandler(
  ctx: MutationCtx,
  args: {
    threadId: string;
    organizationId: string;
    agentSlug: string;
    messageContent: string;
    // oxlint-disable-next-line typescript/no-explicit-any -- agentConfig is dynamic, validated downstream
    agentConfig: any;
  },
  debugTag: string,
): Promise<void> {
  const { threadId, organizationId, agentSlug, messageContent, agentConfig } =
    args;

  const threadMeta = await ctx.db
    .query('threadMetadata')
    .withIndex('by_threadId', (q) => q.eq('threadId', threadId))
    .first();

  const thread = await ctx.runQuery(components.agent.threads.getThread, {
    threadId,
  });

  const { messageId: promptMessageId } = await saveMessage(
    ctx,
    components.agent,
    {
      threadId,
      message: { role: 'system', content: messageContent },
    },
  );

  const streamId = await persistentStreaming.createStream(ctx);

  if (threadMeta) {
    await ctx.db.patch(threadMeta._id, {
      generationStatus: 'generating' as const,
      streamId,
    });
  }

  await ctx.scheduler.runAfter(
    0,
    internal.lib.agent_chat.internal_actions.runAgentGeneration,
    {
      agentType: 'custom',
      agentConfig,
      model: agentConfig.model ?? 'default',
      provider: agentConfig.provider,
      debugTag: `[${agentSlug}:${debugTag}]`,
      enableStreaming: true,
      threadId,
      organizationId,
      promptMessage: messageContent,
      streamId,
      promptMessageId,
      maxSteps: 20,
      userId: thread?.userId,
      deadlineMs: Date.now() + (agentConfig.timeoutMs ?? 420_000),
    },
  );
}
