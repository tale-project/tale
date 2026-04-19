'use node';

/**
 * Internal actions for OpenAI-compatible endpoint.
 *
 * Handles agent config resolution, PII scrubbing, agent listing,
 * and direct tool-calling mode.
 */

import { streamText, type ModelMessage } from 'ai';
import { v } from 'convex/values';

import { isRecord } from '../../lib/utils/type-guards';
import { internal } from '../_generated/api';
import type { ActionCtx } from '../_generated/server';
import { internalAction } from '../_generated/server';
import { scrubPii, type PiiConfig } from '../governance/pii';
import { resolveOrgSlug } from '../organizations/resolve_org_slug';
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
// Result type for direct model completions
// ---------------------------------------------------------------------------

interface DirectModelResult {
  requestId: string;
  text: string | null;
  toolCalls: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }> | null;
  finishReason: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  resolvedModel: string;
}

// ---------------------------------------------------------------------------
// Direct model mode: bypass agent pipeline, route to provider directly
// ---------------------------------------------------------------------------

export const chatDirectModel = internalAction({
  args: {
    modelId: v.string(),
    organizationId: v.string(),
    userId: v.string(),
    userEmail: v.optional(v.string()),
    userName: v.optional(v.string()),
    message: v.string(),
    tools: v.optional(v.any()),
    toolChoice: v.optional(v.any()),
    conversationMessages: v.optional(v.any()),
    generationParams: v.optional(v.any()),
    responseFormat: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<DirectModelResult> => {
    // Pre-call budget enforcement. Matches chat/workflow paths so the
    // OpenAI-compat endpoint shares the same per-org budget ceiling.
    const budgetResult = await ctx.runQuery(
      internal.governance.internal_queries.checkBudgetForRequest,
      {
        organizationId: args.organizationId,
        userId: args.userId,
      },
    );
    if (!budgetResult.allowed) {
      throw new Error(
        budgetResult.reason ??
          'Usage limit reached for this period. Contact your administrator.',
      );
    }

    const message = await scrubMessagePii(
      ctx,
      args.message,
      args.organizationId,
      args.userId,
      args.userEmail ?? '',
      args.modelId,
    );

    // Resolve model directly — no agent config. Pass orgSlug so each org
    // uses its own provider files / API keys.
    const orgSlug = await resolveOrgSlug(ctx, args.organizationId);
    const resolved = await resolveLanguageModelWithFallback(ctx, {
      modelId: args.modelId,
      tag: 'chat',
      orgSlug,
    });

    // Convert client tools to AI SDK format if provided
    /* oxlint-disable typescript/no-unsafe-type-assertion -- Tool definitions are dynamically converted from OpenAI format; the ToolSet branded type requires exact static shape */
    const aiTools = args.tools
      ? (convertOpenAITools(args.tools) as unknown as Parameters<
          typeof streamText
        >[0]['tools'])
      : undefined;
    /* oxlint-enable typescript/no-unsafe-type-assertion */

    // Direct model mode is stateless — no thread/message persistence.
    // Transient ID for audit log correlation only.
    const requestId = `direct-${Date.now().toString(36)}`;

    // Fetch mandatory system prompt governance policy
    const systemPromptPolicy = await ctx.runQuery(
      internal.governance.internal_queries.getSystemPromptPolicyInternal,
      { organizationId: args.organizationId },
    );

    // Build system prompt — no agent instructions, only governance
    let systemPrompt = 'You are a helpful assistant.';
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

    // Build messages — use full conversation if provided, otherwise single message
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
      ...(aiTools && { tools: aiTools }),
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

    // Extract tool calls from steps
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

    // Track usage
    const usage = await result.usage;
    const inputTokens = usage?.inputTokens ?? 0;
    const outputTokens = usage?.outputTokens ?? 0;
    const totalTokens = inputTokens + outputTokens;

    if (args.organizationId && (inputTokens > 0 || outputTokens > 0)) {
      const { estimateCostCents } =
        await import('../governance/cost_estimation');
      const costCents = estimateCostCents(
        resolved.modelData.modelId,
        inputTokens,
        outputTokens,
      );
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
            '[OpenAI-compat:directModel] Failed to increment usage ledger:',
            error,
          );
        });

      await ctx
        .runMutation(internal.audit_logs.internal_mutations.createAuditLog, {
          organizationId: args.organizationId,
          actorId: args.userId ?? 'system',
          actorType: 'api' as const,
          action: 'ai.completion',
          category: 'ai' as const,
          resourceType: 'agent_completion',
          resourceId: requestId,
          status: 'success' as const,
          metadata: {
            model: resolved.modelData.modelId,
            inputTokens,
            outputTokens,
            totalTokens,
            costEstimateCents: costCents,
            requestId,
            agentType: 'direct_model',
            toolCallCount: toolCalls.length,
          },
        })
        .catch((error) => {
          console.error(
            '[OpenAI-compat:directModel] Failed to write AI audit log:',
            error,
          );
        });
    }

    return {
      requestId,
      text: text || null,
      toolCalls: toolCalls.length > 0 ? toolCalls : null,
      finishReason,
      inputTokens,
      outputTokens,
      totalTokens,
      resolvedModel: resolved.modelData.modelId,
    };
  },
});
