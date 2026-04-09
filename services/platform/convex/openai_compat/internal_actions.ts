'use node';

/**
 * Internal actions for OpenAI-compatible endpoint.
 *
 * Handles agent config resolution, PII scrubbing, and agent listing.
 */

import { readdir } from 'node:fs/promises';

import { v } from 'convex/values';

import { isRecord, getString } from '../../lib/utils/type-guards';
import { components, internal } from '../_generated/api';
import { internalAction } from '../_generated/server';
import {
  agentNameFromFileName,
  resolveAgentsDir,
  validateAgentName,
} from '../agents/file_utils';
import { scrubPii, type PiiConfig } from '../governance/pii';

// ---------------------------------------------------------------------------
// Chat initiation (agent config + PII scrubbing)
// ---------------------------------------------------------------------------

export const chatViaOpenAI = internalAction({
  args: {
    agentSlug: v.string(),
    organizationId: v.string(),
    userId: v.string(),
    userEmail: v.optional(v.string()),
    userName: v.optional(v.string()),
    message: v.string(),
    threadId: v.optional(v.string()),
    enableStreaming: v.optional(v.boolean()),
  },
  returns: v.object({
    threadId: v.string(),
    streamId: v.string(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ threadId: string; streamId: string }> => {
    // Resolve org slug from organizationId
    const org = await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: 'organization',
      where: [{ field: '_id', value: args.organizationId, operator: 'eq' }],
    });

    const orgRecord = isRecord(org) ? org : undefined;
    const orgSlug = orgRecord ? getString(orgRecord, 'slug') : undefined;
    if (!orgSlug) {
      throw new Error('Organization not found');
    }

    // PII scrubbing (same pattern as unified_chat.ts)
    let message = args.message;
    const piiPolicy = await ctx.runQuery(
      internal.governance.internal_queries.getPiiConfigInternal,
      { organizationId: args.organizationId },
    );

    if (piiPolicy?.enabled && piiPolicy.config) {
      const piiConfig: PiiConfig = {
        enabled: true,
        mode: piiPolicy.config.mode,
        enabledPatterns: piiPolicy.config.enabledPatterns,
        customPatterns: piiPolicy.config.customPatterns,
      };

      const result = scrubPii(message, piiConfig);
      message = result.text;

      if (result.matchCount > 0) {
        await ctx.runMutation(
          internal.audit_logs.internal_mutations.createAuditLog,
          {
            organizationId: args.organizationId,
            actorId: args.userId,
            actorEmail: args.userEmail ?? '',
            actorType: 'api',
            action: 'pii.detected_in_chat',
            category: 'security',
            resourceType: 'chat_message',
            resourceId: 'openai_compat',
            status: 'success',
            metadata: {
              detectedTypes: result.detectedTypes,
              matchCount: result.matchCount,
              mode: piiConfig.mode,
              agentSlug: args.agentSlug,
              source: 'openai_compat',
            },
          },
        );
      }
    }

    // Resolve agent config from filesystem
    const agentConfig = await ctx.runAction(
      internal.agents.file_actions.resolveAgentConfig,
      {
        orgSlug,
        agentSlug: args.agentSlug,
        organizationId: args.organizationId,
      },
    );

    // Start the chat (creates thread, stream, saves message, schedules generation)
    return ctx.runMutation(
      internal.openai_compat.internal_mutations.startOpenAIChat,
      {
        agentSlug: args.agentSlug,
        organizationId: args.organizationId,
        userId: args.userId,
        userEmail: args.userEmail,
        userName: args.userName,
        message,
        threadId: args.threadId,
        enableStreaming: args.enableStreaming,
        agentConfig,
      },
    );
  },
});

// ---------------------------------------------------------------------------
// List visible agents (for /api/v1/models)
// ---------------------------------------------------------------------------

export const listVisibleAgents = internalAction({
  args: {
    orgSlug: v.string(),
  },
  returns: v.any(),
  handler: async (_ctx, args) => {
    const dir = resolveAgentsDir(args.orgSlug);
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return [];
    }

    const jsonFiles = entries.filter(
      (e) => e.endsWith('.json') && !e.startsWith('.'),
    );

    // Dynamic import to avoid circular dependencies with file_actions
    const { readJsonFile } = await import('../lib/file_io');
    const { parseAgentJson, resolveAgentFilePath, MAX_FILE_SIZE_BYTES } =
      await import('../agents/file_utils');

    const results = await Promise.all(
      jsonFiles.map(async (fileName) => {
        const agentName = agentNameFromFileName(fileName);
        if (!validateAgentName(agentName)) return null;

        const filePath = resolveAgentFilePath(args.orgSlug, agentName);
        const result = await readJsonFile(
          filePath,
          MAX_FILE_SIZE_BYTES,
          parseAgentJson,
        );

        if (!result.ok) return null;
        if (!result.data.visibleInChat) return null;

        return {
          name: agentName,
          displayName: result.data.displayName,
          description: result.data.description,
        };
      }),
    );

    return results.filter(Boolean);
  },
});
