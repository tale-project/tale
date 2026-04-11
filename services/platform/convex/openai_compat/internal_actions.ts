'use node';

/**
 * Internal actions for OpenAI-compatible endpoint.
 *
 * Handles agent config resolution, PII scrubbing, agent listing,
 * and direct tool-calling mode.
 */

import { readdir } from 'node:fs/promises';

import { streamText, type ModelMessage } from 'ai';
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

/**
 * Map OpenAI tool_choice to AI SDK toolChoice format.
 * OpenAI: "auto" | "none" | "required" | { type: "function", function: { name: "..." } }
 * AI SDK: "auto" | "none" | "required" | { type: "tool", toolName: "..." }
 */
function mapToolChoice(
  openaiChoice: unknown,
): 'auto' | 'none' | 'required' | { type: 'tool'; toolName: string } {
  if (typeof openaiChoice === 'string') {
    if (openaiChoice === 'required') return 'required';
    if (openaiChoice === 'none') return 'none';
    return 'auto';
  }
  if (
    typeof openaiChoice === 'object' &&
    openaiChoice !== null &&
    'type' in openaiChoice &&
    (openaiChoice as Record<string, unknown>).type === 'function' &&
    'function' in openaiChoice
  ) {
    const fn = (openaiChoice as Record<string, unknown>).function;
    if (typeof fn === 'object' && fn !== null && 'name' in fn) {
      return {
        type: 'tool',
        toolName: String((fn as Record<string, unknown>).name),
      };
    }
  }
  return 'auto';
}

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
    toolChoice: v.optional(v.any()),
    conversationMessages: v.optional(v.any()),
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

    // Fetch mandatory system prompt governance policy
    const systemPromptPolicy = await ctx.runQuery(
      internal.governance.internal_queries.getSystemPromptPolicyInternal,
      { organizationId: args.organizationId },
    );

    // Build system prompt from agent instructions
    let systemPrompt: string =
      String(agentConfig.instructions ?? '') ||
      `You are ${String(agentConfig.name ?? 'assistant')}, a helpful assistant.`;

    // Apply mandatory governance system prompt (non-overridable)
    if (
      systemPromptPolicy?.enabled !== false &&
      isRecord(systemPromptPolicy?.config)
    ) {
      const cfg = systemPromptPolicy.config;
      const prefix =
        typeof cfg.mandatoryPrefixPrompt === 'string'
          ? cfg.mandatoryPrefixPrompt.trim()
          : '';
      const suffix =
        typeof cfg.mandatorySuffixPrompt === 'string'
          ? cfg.mandatorySuffixPrompt.trim()
          : '';
      if (prefix) systemPrompt = prefix + '\n\n' + systemPrompt;
      if (suffix) systemPrompt = systemPrompt + '\n\n' + suffix;
    }

    // Build generation params
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- generationParams is v.any() from Convex validator; shape is controlled by http_actions.ts buildGenerationParams
    const genParams = (args.generationParams ?? {}) as Record<string, unknown>;

    // Direct streamText call with client tools (no auto-execute)
    // Always use messages format for proper tool calling support.
    // For continuation, use the full conversation history from the client.
    const hasConversation =
      args.conversationMessages &&
      Array.isArray(args.conversationMessages) &&
      args.conversationMessages.length > 0;

    const messages: ModelMessage[] = hasConversation
      ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- conversationMessages is built by convertToModelMessages in http_actions.ts; shape matches ModelMessage[]
        (args.conversationMessages as ModelMessage[])
      : [{ role: 'user' as const, content: message }];

    const result = streamText({
      model: resolved.languageModel,
      system: systemPrompt,
      messages,
      tools: aiTools,
      ...(args.toolChoice != null && {
        toolChoice: mapToolChoice(args.toolChoice),
      }),
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

    // Extract tool calls from steps.
    // AI SDK v6 stores tool calls in step.content[] as { type: "tool-call", toolCallId, toolName, input }
    interface ToolCallContent {
      type: string;
      toolCallId?: string;
      toolName?: string;
      input?: unknown;
    }
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- StepResult serialized to extract tool-call content parts; shape is known from AI SDK v6
    const rawSteps = JSON.parse(JSON.stringify(steps)) as Array<{
      content?: ToolCallContent[];
    }>;
    const toolCalls = rawSteps
      .flatMap((step) => step.content ?? [])
      .filter((part): part is ToolCallContent => part.type === 'tool-call')
      .map((tc) => ({
        id: tc.toolCallId ?? generateToolCallId(),
        type: 'function' as const,
        function: {
          name: tc.toolName ?? '',
          arguments: JSON.stringify(tc.input ?? {}),
        },
      }));

    // Track usage for client tool mode (this path bypasses onAgentComplete)
    const usage = await result.usage;
    if (usage && args.organizationId) {
      const { estimateCostCents } =
        await import('../governance/cost_estimation');
      const inputTokens = usage.inputTokens ?? 0;
      const outputTokens = usage.outputTokens ?? 0;
      if (inputTokens > 0 || outputTokens > 0) {
        const costCents = estimateCostCents(modelId, inputTokens, outputTokens);
        await ctx
          .runMutation(
            internal.governance.internal_mutations.incrementUsageLedger,
            {
              organizationId: args.organizationId,
              userId: args.userId ?? 'system',
              inputTokens,
              outputTokens,
              costEstimateCents: costCents,
              timestamp: Date.now(),
            },
          )
          .catch((error) => {
            console.error(
              '[OpenAI-compat:clientTools] Failed to increment usage ledger:',
              error,
            );
          });

        // AI audit log for OpenAI-compat client tool mode
        await ctx
          .runMutation(internal.audit_logs.internal_mutations.createAuditLog, {
            organizationId: args.organizationId,
            actorId: args.userId ?? 'system',
            actorType: 'api' as const,
            action: 'ai.completion',
            category: 'ai' as const,
            resourceType: 'agent_completion',
            resourceId: threadId,
            status: 'success' as const,
            metadata: {
              model: modelId,
              inputTokens,
              outputTokens,
              totalTokens: inputTokens + outputTokens,
              costEstimateCents: costCents,
              threadId,
              agentType: 'openai_compat',
              toolCallCount: toolCalls.length,
            },
          })
          .catch((error) => {
            console.error(
              '[OpenAI-compat:clientTools] Failed to write AI audit log:',
              error,
            );
          });
      }
    }

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
