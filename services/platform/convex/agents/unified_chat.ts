'use node';

/**
 * Unified Chat Action
 *
 * Single entry point for chatting with any agent.
 * Reads agent config directly from the filesystem (inlined to eliminate
 * the resolveAgentConfig action hop) and starts the chat via an internal
 * mutation.
 *
 * TTFT optimizations (issue #1219):
 * - PII policy query and agent config resolution run in parallel
 * - resolveAgentConfig logic inlined to avoid extra Convex action scheduling
 */

import { v } from 'convex/values';

import { internal } from '../_generated/api';
import { action, type ActionCtx } from '../_generated/server';
import { scrubPii, type PiiConfig } from '../governance/pii';
import type { SerializableAgentConfig } from '../lib/agent_chat/types';
import { readJsonFile } from '../lib/file_io';
import { applyModelOverride, toSerializableConfig } from './config';
import {
  resolveAgentFilePath,
  parseAgentJson,
  MAX_FILE_SIZE_BYTES,
  type AgentJsonConfig,
} from './file_utils';
import type { KnowledgeFile } from './schema';

export const chatWithAgent = action({
  args: {
    agentSlug: v.string(),
    threadId: v.string(),
    organizationId: v.string(),
    orgSlug: v.string(),
    message: v.string(),
    maxSteps: v.optional(v.number()),
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
    modelId: v.optional(v.string()),
    /**
     * Per-message capability bindings — integration slugs the user has toggled
     * ON in the composer. Merged into the active agent's integrationBindings
     * for this call only. Any integration whose config declares
     * `exposeAsCapability` is eligible.
     */
    capabilityBindings: v.optional(v.array(v.string())),
    additionalContext: v.optional(v.record(v.string(), v.string())),
    userContext: v.optional(
      v.object({
        timezone: v.string(),
        language: v.string(),
      }),
    ),
  },
  returns: v.object({
    messageAlreadyExists: v.boolean(),
    streamId: v.string(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ messageAlreadyExists: boolean; streamId: string }> => {
    // Mark as generating IMMEDIATELY so the Convex subscription delivers
    // isGenerating=true to the client with minimal delay. This mutation
    // commits before the slower PII/config/budget checks below.
    // Also performs auth + thread ownership check (saves a round trip).
    // If anything fails later, we roll back via clearGenerationStatus.
    console.log(
      `[chatWithAgent] START threadId=${args.threadId} agentSlug=${args.agentSlug}`,
    );
    const {
      streamId: preAllocatedStreamId,
      userId: authUserId,
      userEmail: authUserEmail,
      userName: authUserName,
    } = await ctx.runMutation(
      internal.threads.internal_mutations.markGenerating,
      { threadId: args.threadId, agentSlug: args.agentSlug },
    );
    console.log(
      `[chatWithAgent] markGenerating OK threadId=${args.threadId} streamId=${preAllocatedStreamId} userId=${authUserId}`,
    );

    // PII query, governance default model resolution, and agent config
    // resolution are independent — run them in parallel to reduce TTFT.
    // Agent config is read directly from the filesystem (inlined) instead of
    // dispatching a separate resolveAgentConfig action, saving ~100-300ms.
    const [piiPolicy, governanceDefault, configResult] = await Promise.all([
      ctx.runQuery(internal.governance.internal_queries.getPiiConfigInternal, {
        organizationId: args.organizationId,
      }),
      !args.modelId
        ? ctx.runQuery(
            internal.governance.internal_queries.resolveDefaultModelInternal,
            {
              organizationId: args.organizationId,
              userId: authUserId,
              userEmail: authUserEmail,
              userName: authUserName,
            },
          )
        : null,
      resolveAgentConfigInline(ctx, {
        orgSlug: args.orgSlug,
        agentSlug: args.agentSlug,
        organizationId: args.organizationId,
        modelId: args.modelId,
      }),
    ]);

    const agentConfig = configResult.config;

    // Apply governance default model when no explicit model was requested.
    // Same supportedModels gate as the explicit modelId path — silently
    // ignored if the governance model isn't in the agent's supported list.
    if (!args.modelId && governanceDefault?.modelId) {
      applyModelOverride(
        agentConfig,
        governanceDefault.modelId,
        configResult.supportedModels,
      );
    }

    // Helper to roll back generationStatus if we need to abort before startChat
    const rollbackGenerating = () =>
      ctx.runMutation(
        internal.threads.internal_mutations.clearGenerationStatus,
        { threadId: args.threadId, streamId: preAllocatedStreamId },
      );

    // PII scrubbing must still happen before startChat (modifies message)
    let message = args.message;
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
            actorId: authUserId,
            actorEmail: authUserEmail,
            actorType: 'user',
            action: 'pii.detected_in_chat',
            category: 'security',
            resourceType: 'chat_message',
            resourceId: args.threadId,
            status: 'success',
            metadata: {
              detectedTypes: result.detectedTypes,
              matchCount: result.matchCount,
              mode: piiConfig.mode,
              agentSlug: args.agentSlug,
            },
          },
        );
      }
    }

    // Model access RBAC: check if the user is allowed to use the requested model
    if (args.modelId) {
      const accessCheck = await ctx.runQuery(
        internal.governance.internal_queries.checkModelAccessInternal,
        {
          organizationId: args.organizationId,
          userId: authUserId,
          modelId: args.modelId,
        },
      );
      if (!accessCheck.allowed) {
        await rollbackGenerating();
        throw new Error(
          accessCheck.reason ?? 'You do not have access to the selected model.',
        );
      }
    }

    // Delegate to the internal mutation for transactional chat start.
    // Pass preAllocatedStreamId so startAgentChat reuses the stream
    // created by markGenerating (avoids redundant stream + status patch).
    console.log(`[chatWithAgent] calling startChat threadId=${args.threadId}`);
    const result = await ctx.runMutation(internal.agents.start_chat.startChat, {
      threadId: args.threadId,
      organizationId: args.organizationId,
      userId: authUserId,
      userEmail: authUserEmail,
      userName: authUserName,
      message,
      maxSteps: args.maxSteps,
      attachments: args.attachments,
      additionalContext: args.additionalContext,
      userContext: args.userContext,
      agentConfig,
      agentSlug: args.agentSlug,
      preAllocatedStreamId,
      capabilityBindings: args.capabilityBindings,
    });
    console.log(
      `[chatWithAgent] DONE threadId=${args.threadId} messageAlreadyExists=${result.messageAlreadyExists}`,
    );
    return result;
  },
});

interface InlineConfigResult {
  config: SerializableAgentConfig;
  supportedModels: string[];
}

/**
 * Resolve agent config directly from the filesystem, eliminating the
 * separate resolveAgentConfig internalAction hop (~100-300ms savings).
 *
 * Returns the config and the raw supportedModels list so the caller can
 * apply governance default model overrides with the same supportedModels
 * check that the explicit modelId path uses.
 */
async function resolveAgentConfigInline(
  ctx: ActionCtx,
  args: {
    orgSlug: string;
    agentSlug: string;
    organizationId: string;
    modelId?: string;
  },
): Promise<InlineConfigResult> {
  const filePath = resolveAgentFilePath(args.orgSlug, args.agentSlug);
  const result = await readJsonFile<AgentJsonConfig>(
    filePath,
    MAX_FILE_SIZE_BYTES,
    parseAgentJson,
  );
  if (!result.ok) {
    throw new Error(`Agent not found: ${args.agentSlug} — ${result.message}`);
  }

  const binding = await ctx.runQuery(
    internal.agents.internal_queries.getBindingByAgent,
    {
      organizationId: args.organizationId,
      agentSlug: args.agentSlug,
    },
  );

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- binding shape guaranteed by getBindingByAgent query; returns v.any()
  const typedBinding = binding as {
    teamId?: string;
    sharedWithTeamIds?: string[];
    knowledgeFiles?: KnowledgeFile[];
  } | null;

  const config = toSerializableConfig(
    args.agentSlug,
    result.data,
    typedBinding
      ? {
          teamId: typedBinding.teamId ?? undefined,
          sharedWithTeamIds: typedBinding.sharedWithTeamIds ?? undefined,
          knowledgeFiles: typedBinding.knowledgeFiles ?? undefined,
        }
      : undefined,
  );

  if (args.modelId) {
    applyModelOverride(config, args.modelId, result.data.supportedModels);
  }

  return { config, supportedModels: result.data.supportedModels };
}
