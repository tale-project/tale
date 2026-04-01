'use node';

import { v } from 'convex/values';
import { stat, readFile } from 'node:fs/promises';

import { isRecord, getString } from '../../../lib/utils/type-guards';
import { components, internal } from '../../_generated/api';
import { internalAction } from '../../_generated/server';
import { toSerializableConfig } from '../config';
import {
  MAX_FILE_SIZE_BYTES,
  parseAgentJson,
  resolveAgentFilePath,
} from '../file_utils';

export const chatViaWebhook = internalAction({
  args: {
    agentSlug: v.string(),
    organizationId: v.string(),
    webhookId: v.id('agentWebhooks'),
    message: v.string(),
    threadId: v.optional(v.string()),
    enableStreaming: v.optional(v.boolean()),
    attachments: v.optional(
      v.array(
        v.object({
          fileId: v.id('_storage'),
          fileName: v.string(),
          fileType: v.string(),
          fileSize: v.number(),
        }),
      ),
    ),
  },
  returns: v.object({
    threadId: v.string(),
    streamId: v.string(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ threadId: string; streamId: string }> => {
    const org = await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: 'organization',
      where: [{ field: '_id', value: args.organizationId, operator: 'eq' }],
    });

    const orgRecord = isRecord(org) ? org : undefined;
    const orgSlug = orgRecord ? getString(orgRecord, 'slug') : undefined;
    if (!orgSlug) {
      throw new Error('Organization not found');
    }

    const filePath = resolveAgentFilePath(orgSlug, args.agentSlug);
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

    return ctx.runMutation(
      internal.agents.webhooks.internal_mutations.startWebhookChat,
      {
        agentSlug: args.agentSlug,
        organizationId: args.organizationId,
        webhookId: args.webhookId,
        message: args.message,
        threadId: args.threadId,
        enableStreaming: args.enableStreaming,
        attachments: args.attachments,
        agentConfig,
      },
    );
  },
});
