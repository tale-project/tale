'use node';

/**
 * Internal action for triggering workflow completion agent response.
 *
 * Reads the agent config from the JSON file and delegates to the
 * triggerWorkflowCompletionResponse mutation with the full config.
 * This action bridges the filesystem read (requires Node.js) with
 * the transactional mutation that saves messages and schedules generation.
 */

import { v } from 'convex/values';
import { readFile, stat } from 'node:fs/promises';

import { internal } from '../../_generated/api';
import { internalAction } from '../../_generated/server';
import { toSerializableConfig } from '../../agents/config';
import {
  MAX_FILE_SIZE_BYTES,
  parseAgentJson,
  resolveAgentFilePath,
} from '../../agents/file_utils';

const DEFAULT_ORG_SLUG = 'default';

export const triggerCompletionWithAgent = internalAction({
  args: {
    threadId: v.string(),
    organizationId: v.string(),
    agentSlug: v.string(),
    messageContent: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    const filePath = resolveAgentFilePath(DEFAULT_ORG_SLUG, args.agentSlug);
    let content: string;
    try {
      const fileStat = await stat(filePath);
      if (fileStat.size > MAX_FILE_SIZE_BYTES) {
        throw new Error('Agent file too large');
      }
      content = await readFile(filePath, 'utf-8');
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'unknown error';
      throw new Error(`Agent not found: ${args.agentSlug} — ${detail}`, {
        cause: err,
      });
    }
    const config = parseAgentJson(content);

    const binding = await ctx.runQuery(
      internal.agents.internal_queries.getBindingByAgent,
      {
        organizationId: args.organizationId,
        agentSlug: args.agentSlug,
      },
    );

    const agentConfig = toSerializableConfig(
      args.agentSlug,
      config,
      binding
        ? {
            teamId: binding.teamId ?? undefined,
            knowledgeFiles: binding.knowledgeFiles ?? undefined,
          }
        : undefined,
    );

    await ctx.runMutation(
      internal.agent_tools.workflows.internal_mutations
        .triggerWorkflowCompletionResponse,
      {
        threadId: args.threadId,
        organizationId: args.organizationId,
        agentSlug: args.agentSlug,
        messageContent: args.messageContent,
        agentConfig,
      },
    );
  },
});
