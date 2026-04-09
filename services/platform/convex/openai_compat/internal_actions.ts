'use node';

/**
 * Internal actions for OpenAI-compatible endpoint.
 *
 * Handles agent config resolution, PII scrubbing, agent listing,
 * and direct tool-calling mode.
 */

import { readdir } from 'node:fs/promises';

import { streamText } from 'ai';
import { v } from 'convex/values';

import { isRecord, getString } from '../../lib/utils/type-guards';
import { components, internal } from '../_generated/api';
import type { ActionCtx } from '../_generated/server';
import { internalAction } from '../_generated/server';
import {
  agentNameFromFileName,
  resolveAgentsDir,
  validateAgentName,
} from '../agents/file_utils';
import { scrubPii, type PiiConfig } from '../governance/pii';
import { resolveLanguageModelWithFallback } from '../providers/failover';
import { convertOpenAITools, generateToolCallId } from './tool_conversion';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function resolveOrgSlug(
  ctx: ActionCtx,
  organizationId: string,
): Promise<string> {
  const org = await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: 'organization',
    where: [{ field: '_id', value: organizationId, operator: 'eq' }],
  });
  const orgRecord = isRecord(org) ? org : undefined;
  const slug = orgRecord ? getString(orgRecord, 'slug') : undefined;
  if (!slug) throw new Error('Organization not found');
  return slug;
}

async function scrubMessagePii(
  ctx: ActionCtx,
  message: string,
  organizationId: string,
  userId: string,
  userEmail: string,
  agentSlug: string,
): Promise<string> {
  const piiPolicy = await ctx.runQuery(
    internal.governance.internal_queries.getPiiConfigInternal,
    { organizationId },
  );

  if (!piiPolicy?.enabled || !piiPolicy.config) return message;

  const piiConfig: PiiConfig = {
    enabled: true,
    mode: piiPolicy.config.mode,
    enabledPatterns: piiPolicy.config.enabledPatterns,
    customPatterns: piiPolicy.config.customPatterns,
  };

  const result = scrubPii(message, piiConfig);

  if (result.matchCount > 0) {
    await ctx.runMutation(
      internal.audit_logs.internal_mutations.createAuditLog,
      {
        organizationId,
        actorId: userId,
        actorEmail: userEmail,
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
          agentSlug,
          source: 'openai_compat',
        },
      },
    );
  }

  return result.text;
}

// ---------------------------------------------------------------------------
// Agent mode: chat via scheduled generation (no client tools)
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
    generationParams: v.optional(v.any()),
    responseFormat: v.optional(v.string()),
  },
  returns: v.object({
    threadId: v.string(),
    streamId: v.string(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ threadId: string; streamId: string }> => {
    const orgSlug = await resolveOrgSlug(ctx, args.organizationId);

    const message = await scrubMessagePii(
      ctx,
      args.message,
      args.organizationId,
      args.userId,
      args.userEmail ?? '',
      args.agentSlug,
    );

    const agentConfig = await ctx.runAction(
      internal.agents.file_actions.resolveAgentConfig,
      {
        orgSlug,
        agentSlug: args.agentSlug,
        organizationId: args.organizationId,
      },
    );

    // Apply response_format override
    if (args.responseFormat === 'json_object') {
      agentConfig.outputFormat = 'json';
    }

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
        generationParams: args.generationParams,
      },
    );
  },
});

// ---------------------------------------------------------------------------
// Client tool mode: direct streamText with client-defined tools
// ---------------------------------------------------------------------------

interface ToolCallResult {
  threadId: string;
  text: string | null;
  toolCalls: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }> | null;
  finishReason: string;
}

export const chatViaOpenAIWithTools = internalAction({
  args: {
    agentSlug: v.string(),
    organizationId: v.string(),
    userId: v.string(),
    userEmail: v.optional(v.string()),
    userName: v.optional(v.string()),
    message: v.string(),
    threadId: v.optional(v.string()),
    tools: v.any(),
    toolMessages: v.optional(v.any()),
    generationParams: v.optional(v.any()),
    responseFormat: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<ToolCallResult> => {
    const orgSlug = await resolveOrgSlug(ctx, args.organizationId);

    const message = await scrubMessagePii(
      ctx,
      args.message,
      args.organizationId,
      args.userId,
      args.userEmail ?? '',
      args.agentSlug,
    );

    // Resolve agent config (for system prompt + model)
    // oxlint-disable-next-line typescript/no-explicit-any -- resolveAgentConfig returns v.any(); fields accessed dynamically
    const agentConfig: any = await ctx.runAction(
      internal.agents.file_actions.resolveAgentConfig,
      {
        orgSlug,
        agentSlug: args.agentSlug,
        organizationId: args.organizationId,
      },
    );

    if (args.responseFormat === 'json_object') {
      agentConfig.outputFormat = 'json';
    }

    // Resolve language model
    const modelId = String(agentConfig.model ?? 'default');
    const providerName = agentConfig.provider
      ? String(agentConfig.provider)
      : undefined;
    const resolved = await resolveLanguageModelWithFallback(ctx, {
      modelId,
      providerName,
      tag: 'chat',
    });

    // Convert client tools to AI SDK format (no execute functions)
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Tool definitions are dynamically converted from OpenAI format; the ToolSet branded type requires exact static shape
    const aiTools = convertOpenAITools(
      args.tools ?? [],
    ) as unknown as Parameters<typeof streamText>[0]['tools'];

    // Create or reuse thread, save user message
    const threadId: string = await ctx.runMutation(
      internal.openai_compat.internal_mutations.createThreadAndSaveMessage,
      {
        organizationId: args.organizationId,
        userId: args.userId,
        userEmail: args.userEmail,
        userName: args.userName,
        threadId: args.threadId,
        message,
      },
    );

    // If continuation: save tool result messages to thread
    if (args.toolMessages && Array.isArray(args.toolMessages)) {
      await ctx.runMutation(
        internal.openai_compat.internal_mutations.saveToolMessages,
        {
          threadId,
          messages: args.toolMessages,
        },
      );
    }

    // Build system prompt from agent instructions
    const systemPrompt: string =
      String(agentConfig.instructions ?? '') ||
      `You are ${String(agentConfig.name ?? 'assistant')}, a helpful assistant.`;

    // Build generation params
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- generationParams is v.any() from Convex validator; shape is controlled by http_actions.ts buildGenerationParams
    const genParams = (args.generationParams ?? {}) as Record<string, unknown>;

    // Direct streamText call with client tools (no auto-execute)
    const result = streamText({
      model: resolved.languageModel,
      system: systemPrompt,
      prompt: message,
      tools: aiTools,
      ...(genParams.temperature != null && {
        temperature: Number(genParams.temperature),
      }),
      ...(genParams.maxTokens != null && {
        maxTokens: Number(genParams.maxTokens),
      }),
      ...(genParams.topP != null && { topP: Number(genParams.topP) }),
      ...(genParams.frequencyPenalty != null && {
        frequencyPenalty: Number(genParams.frequencyPenalty),
      }),
      ...(genParams.presencePenalty != null && {
        presencePenalty: Number(genParams.presencePenalty),
      }),
      ...(Array.isArray(genParams.stopSequences) && {
        stopSequences: genParams.stopSequences,
      }),
    });

    const text: string = await result.text;
    const finishReason: string = await result.finishReason;
    const steps = await result.steps;

    // Extract tool calls from steps
    interface StepWithToolCalls {
      toolCalls?: Array<{ toolName: string; args: unknown }>;
    }
    const typedSteps: StepWithToolCalls[] = Array.isArray(steps) ? steps : [];
    const toolCalls = typedSteps
      .flatMap((step) => step.toolCalls ?? [])
      .map((tc) => ({
        id: generateToolCallId(),
        type: 'function' as const,
        function: {
          name: tc.toolName,
          arguments: JSON.stringify(tc.args ?? {}),
        },
      }));

    return {
      threadId,
      text: text || null,
      toolCalls: toolCalls.length > 0 ? toolCalls : null,
      finishReason,
    };
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
