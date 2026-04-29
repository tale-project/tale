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

import { stripModelRefQualifier } from '../../lib/shared/utils/model-ref';
import { internal } from '../_generated/api';
import { action, type ActionCtx } from '../_generated/server';
import {
  loadGuardrailsSnapshot,
  sanitizeMessage,
} from '../governance/sanitize';
import type { SerializableAgentConfig } from '../lib/agent_chat/types';
import { readJsonFile } from '../lib/file_io';
import { resolveOrgSlug } from '../organizations/resolve_org_slug';
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

    const orgSlug = await resolveOrgSlug(ctx, args.organizationId);

    // PII query, governance default model resolution, and agent config
    // resolution are independent — run them in parallel to reduce TTFT.
    // Agent config is read directly from the filesystem (inlined) instead of
    // dispatching a separate resolveAgentConfig action, saving ~100-300ms.
    const [guardrails, governanceDefault, configResult] = await Promise.all([
      loadGuardrailsSnapshot(ctx, args.organizationId),
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
        orgSlug,
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
      // Reconstruct a qualified ref so the governance-specified provider flows
      // through to parseModelRef downstream. applyModelOverride's matching is
      // qualifier-insensitive, so matching against supportedModels still works
      // whether entries are qualified or plain.
      const qualifiedRef = governanceDefault.providerName
        ? `${governanceDefault.providerName}:${governanceDefault.modelId}`
        : governanceDefault.modelId;
      applyModelOverride(
        agentConfig,
        qualifiedRef,
        configResult.supportedModels,
      );
    }

    // Enforce the model_access policy on the resolved default model AND on
    // the fallback chain. The explicit-modelId path is already checked below;
    // the implicit paths (governance default, supportedModels[0]) would
    // otherwise bypass the allowlist, letting users invoke blocked models as
    // long as they didn't pick one in the UI. Also filters fallbackModels so
    // SDK retry can't silently hit a blocked model.
    if (!args.modelId) {
      const accessiblePlain = await ctx.runQuery(
        internal.governance.internal_queries.getAccessibleModelsInternal,
        {
          organizationId: args.organizationId,
          userId: authUserId,
          modelIds: configResult.supportedModels.map(stripModelRefQualifier),
        },
      );
      const accessibleSet = new Set(accessiblePlain);
      const accessibleRefs = configResult.supportedModels.filter((ref) =>
        accessibleSet.has(stripModelRefQualifier(ref)),
      );
      if (accessibleRefs.length === 0) {
        await ctx.runMutation(
          internal.threads.internal_mutations.clearGenerationStatus,
          { threadId: args.threadId, streamId: preAllocatedStreamId },
        );
        throw new Error(
          "No model in this agent is permitted by your organization's model access policy.",
        );
      }
      const currentPlain = agentConfig.model
        ? stripModelRefQualifier(agentConfig.model)
        : null;
      const chosenRef =
        currentPlain && accessibleSet.has(currentPlain) && agentConfig.model
          ? agentConfig.model
          : accessibleRefs[0];
      agentConfig.model = chosenRef;
      const chosenPlain = stripModelRefQualifier(chosenRef);
      const fallbacks = accessibleRefs.filter(
        (ref) => stripModelRefQualifier(ref) !== chosenPlain,
      );
      agentConfig.fallbackModels = fallbacks.length > 0 ? fallbacks : undefined;
    }

    // Helper to roll back generationStatus if we need to abort before startChat
    const rollbackGenerating = () =>
      ctx.runMutation(
        internal.threads.internal_mutations.clearGenerationStatus,
        { threadId: args.threadId, streamId: preAllocatedStreamId },
      );

    // Guardrails: chat_filter → PII → moderation_provider (see sanitize.ts).
    // Blocked outcomes throw ConvexError with structured `data` for the UI
    // and a legacy substring in `.message` for older client bundles.
    // Roll back the generating flag on any throw so the spinner doesn't
    // strand for ~35 min (the isThreadGenerating stale threshold).
    let sanitized;
    try {
      sanitized = await sanitizeMessage(
        ctx,
        args.message,
        'input',
        guardrails,
        {
          organizationId: args.organizationId,
          orgSlug,
          threadId: args.threadId,
          agentSlug: args.agentSlug,
          actorId: authUserId,
          actorEmail: authUserEmail,
          actorType: 'user',
        },
      );
    } catch (err) {
      await rollbackGenerating();
      throw err;
    }
    const message = sanitized.text;

    // Model access RBAC: check if the user is allowed to use the requested model.
    // Strip any provider qualifier so governance policies (which store plain
    // model ids) match regardless of routing.
    if (args.modelId) {
      const accessCheck = await ctx.runQuery(
        internal.governance.internal_queries.checkModelAccessInternal,
        {
          organizationId: args.organizationId,
          userId: authUserId,
          modelId: stripModelRefQualifier(args.modelId),
        },
      );
      if (!accessCheck.allowed) {
        await ctx.runMutation(
          internal.audit_logs.internal_mutations.createAuditLog,
          {
            organizationId: args.organizationId,
            actorId: authUserId,
            actorEmail: authUserEmail,
            actorType: 'user',
            action: 'model_access.denied',
            category: 'ai',
            resourceType: 'chat_message',
            resourceId: args.threadId,
            status: 'denied',
            metadata: {
              requestedModelId: args.modelId,
              reason: accessCheck.reason ?? null,
              agentSlug: args.agentSlug,
            },
          },
        );
        await rollbackGenerating();
        throw new Error(
          accessCheck.reason ?? 'You do not have access to the selected model.',
        );
      }
    }

    // Delegate to the internal mutation for transactional chat start.
    // Pass preAllocatedStreamId so startAgentChat reuses the stream
    // created by markGenerating (avoids redundant stream + status patch).
    // Roll back the generating flag if startChat throws (thread not found,
    // etc.) so the spinner doesn't strand for ~35 min.
    console.log(`[chatWithAgent] calling startChat threadId=${args.threadId}`);
    let result;
    try {
      result = await ctx.runMutation(internal.agents.start_chat.startChat, {
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
    } catch (err) {
      await rollbackGenerating();
      throw err;
    }
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
): Promise<InlineConfigResult & { orgLocale: string }> {
  const filePath = resolveAgentFilePath(args.orgSlug, args.agentSlug);

  // Parallelize JSON read, binding lookup, and org-locale lookup to preserve
  // the TTFT savings the inlined path was designed for.
  const [result, binding, orgLocale] = await Promise.all([
    readJsonFile<AgentJsonConfig>(
      filePath,
      MAX_FILE_SIZE_BYTES,
      parseAgentJson,
    ),
    ctx.runQuery(internal.agents.internal_queries.getBindingByAgent, {
      organizationId: args.organizationId,
      agentSlug: args.agentSlug,
    }),
    ctx.runQuery(
      internal.organizations.internal_queries.getOrganizationDefaultLocale,
      { organizationId: args.organizationId },
    ),
  ]);
  if (!result.ok) {
    throw new Error(`Agent not found: ${args.agentSlug} — ${result.message}`);
  }

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
    orgLocale,
  );

  if (args.modelId) {
    applyModelOverride(config, args.modelId, result.data.supportedModels);
  }

  return { config, supportedModels: result.data.supportedModels, orgLocale };
}
