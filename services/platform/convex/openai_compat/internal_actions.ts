'use node';

/**
 * Internal actions for OpenAI-compatible endpoint.
 *
 * Handles agent config resolution, PII scrubbing, agent listing,
 * and direct tool-calling mode.
 */

import { streamText, type ModelMessage } from 'ai';
import { v } from 'convex/values';

import { stripModelRefQualifier } from '../../lib/shared/utils/model-ref';
import { isRecord } from '../../lib/utils/type-utils';
import { internal } from '../_generated/api';
import type { ActionCtx } from '../_generated/server';
import { internalAction } from '../_generated/server';
import type { GeneratedImageBlob } from '../agents/image_generation/generate_image_blobs';
import {
  loadGuardrailsSnapshot,
  sanitizeMessage,
} from '../governance/sanitize';
import { buildReasoningOptions } from '../lib/agent_response/reasoning/build_reasoning_options';
import { reasoningScopeKey } from '../lib/agent_response/reasoning/scope';
import { buildCallProviderOptions } from '../lib/provider_options';
import { resolveOrgSlug } from '../organizations/resolve_org_slug';
import { resolveLanguageModelWithFallback } from '../providers/failover';
import { buildAiUserContent } from './content';
import {
  type ApiImageResult,
  extractDataUriImages,
  generateApiImages,
} from './image_generation';
import type { OpenAIChatImage } from './response_format';
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
  if (isRecord(openaiChoice) && openaiChoice.type === 'function') {
    const fn = openaiChoice.function;
    if (isRecord(fn) && 'name' in fn) {
      return { type: 'tool', toolName: String(fn.name) };
    }
  }
  return 'auto';
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function sanitizeUserMessage(
  ctx: ActionCtx,
  message: string,
  organizationId: string,
  orgSlug: string,
  userId: string,
  userEmail: string,
  agentSlug: string,
): Promise<string> {
  const snapshot = await loadGuardrailsSnapshot(ctx, organizationId);
  const result = await sanitizeMessage(ctx, message, 'input', snapshot, {
    organizationId,
    orgSlug,
    threadId: 'openai_compat',
    agentSlug,
    actorId: userId,
    actorEmail: userEmail,
    actorType: 'api',
  });
  return result.text;
}

/**
 * Write an AI audit-log row for a direct-model request. Status is derived from
 * the real outcome — a `failure` row is written when inference throws — so the
 * audit trail can't systematically under-report failures (it previously only
 * ever wrote `status: 'success'`, leaving real failures with no record at all).
 * Best-effort: a telemetry write must never mask the underlying result/error.
 */
async function writeAiAudit(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    userId?: string;
    userEmail?: string;
    action: string;
    resourceType: string;
    requestId: string;
    status: 'success' | 'failure';
    errorMessage?: string;
    metadata: Record<string, unknown>;
  },
): Promise<void> {
  await ctx
    .runMutation(internal.audit_logs.internal_mutations.createAuditLog, {
      organizationId: args.organizationId,
      actorId: args.userId ?? 'system',
      actorEmail: args.userEmail,
      actorType: 'api' as const,
      action: args.action,
      category: 'ai' as const,
      resourceType: args.resourceType,
      resourceId: args.requestId,
      status: args.status,
      ...(args.errorMessage ? { errorMessage: args.errorMessage } : {}),
      metadata: { requestId: args.requestId, ...args.metadata },
    })
    .catch((error) => {
      console.error('[OpenAI-compat] Failed to write AI audit log:', error);
    });
}

/**
 * Shared pre-flight for direct-model requests: per-org budget ceiling, then
 * model-access RBAC (writing a `denied` audit row and throwing on refusal).
 * Shared by chat completions and image generation so the two endpoints enforce
 * the same governance.
 */
async function enforceBudgetAndAccess(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    userId: string;
    userEmail?: string;
    modelId: string;
    // Better Auth `apikey._id` that authenticated the request — enables the
    // per-API-key budget scope. Undefined only for callers without a key.
    apiKeyId?: string;
  },
): Promise<void> {
  const budgetResult = await ctx.runQuery(
    internal.governance.internal_queries.checkBudgetForRequest,
    {
      organizationId: args.organizationId,
      userId: args.userId,
      ...(args.apiKeyId !== undefined ? { apiKeyId: args.apiKeyId } : {}),
    },
  );
  if (!budgetResult.allowed) {
    throw new Error(
      budgetResult.reason ??
        'Usage limit reached for this period. Contact your administrator.',
    );
  }

  // Strip provider qualifier so governance policies (which store plain model
  // ids) match regardless of routing.
  const accessCheck = await ctx.runQuery(
    internal.governance.internal_queries.checkModelAccessInternal,
    {
      organizationId: args.organizationId,
      userId: args.userId,
      modelId: stripModelRefQualifier(args.modelId),
    },
  );
  if (!accessCheck.allowed) {
    await ctx.runMutation(
      internal.audit_logs.internal_mutations.createAuditLog,
      {
        organizationId: args.organizationId,
        actorId: args.userId,
        actorEmail: args.userEmail,
        actorType: 'api',
        action: 'model_access.denied',
        category: 'ai',
        resourceType: 'openai_compat_request',
        status: 'denied',
        metadata: {
          requestedModelId: args.modelId,
          reason: accessCheck.reason ?? null,
        },
      },
    );
    throw new Error(
      accessCheck.reason ?? 'You do not have access to the selected model.',
    );
  }
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
  /** Generated images (image-generation models), surfaced as chat images. */
  images: OpenAIChatImage[] | null;
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
    // Better Auth `apikey._id` that authenticated the request (openai-compat).
    // Threaded into the budget gate (per-key scope) and the usage-ledger write.
    apiKeyId: v.optional(v.string()),
    message: v.string(),
    /**
     * Structured last-user-message content (OpenAI `content` parts: text +
     * image_url). When present, drives multimodal/vision input; `message`
     * carries the joined text for sanitization signals and back-compat.
     */
    userContent: v.optional(v.any()),
    tools: v.optional(v.any()),
    toolChoice: v.optional(v.any()),
    conversationMessages: v.optional(v.any()),
    generationParams: v.optional(v.any()),
    responseFormat: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<DirectModelResult> => {
    // Per-org budget ceiling + per-API-key budget + model-access RBAC (shared
    // with the chat/workflow paths and the image endpoint).
    await enforceBudgetAndAccess(ctx, {
      organizationId: args.organizationId,
      userId: args.userId,
      userEmail: args.userEmail,
      modelId: args.modelId,
      apiKeyId: args.apiKeyId,
    });

    // Resolve model directly — no agent config. Pass orgSlug so each org
    // uses its own provider files / API keys.
    const orgSlug = await resolveOrgSlug(ctx, args.organizationId);
    const sanitizedText = await sanitizeUserMessage(
      ctx,
      args.message,
      args.organizationId,
      orgSlug,
      args.userId,
      args.userEmail ?? '',
      args.modelId,
    );
    // Build AI SDK user content. With multimodal `userContent` (vision), keep
    // the image parts and substitute the PII-sanitized text; otherwise it's the
    // sanitized string unchanged.
    const userMessageContent = args.userContent
      ? buildAiUserContent(args.userContent, sanitizedText)
      : sanitizedText;
    const resolved = await resolveLanguageModelWithFallback(ctx, {
      modelId: args.modelId,
      tag: 'chat',
      organizationId: args.organizationId,
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

    const hasConversation =
      args.conversationMessages &&
      Array.isArray(args.conversationMessages) &&
      args.conversationMessages.length > 0;

    // Image-generation models produce image bytes, not text. `streamText` reads
    // only `result.text`, so routing them through the text path drops the image
    // while still billing tokens. Detect the `image-generation` tag and route to
    // the shared image core so the image is returned (and billed once, against a
    // real deliverable). An attached `data:` image turns this into an edit (the
    // model must carry the `image-edit` tag). Tool-continuation turns can't be
    // image turns.
    if (
      resolved.modelData.tags.includes('image-generation') &&
      !hasConversation
    ) {
      return await runChatImageGeneration(ctx, {
        requestId,
        modelRef: `${resolved.modelData.providerName}:${resolved.modelData.modelId}`,
        prompt: sanitizedText,
        attachmentBytes: extractDataUriImages(args.userContent),
        organizationId: args.organizationId,
        userId: args.userId,
        userEmail: args.userEmail,
        apiKeyId: args.apiKeyId,
      });
    }

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

    // Build messages — use full conversation if provided, otherwise the single
    // (possibly multimodal) user turn.
    const messages: ModelMessage[] = hasConversation
      ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- conversationMessages is built by convertToModelMessages in http_actions.ts; shape matches ModelMessage[]
        (args.conversationMessages as ModelMessage[])
      : [{ role: 'user', content: userMessageContent }];

    // Adaptive Reasoning Governor: scale reasoning + temperature to the
    // request's difficulty. The stateless API path has no per-thread state, but
    // it warm-starts from the org+model profile that chat turns accumulate.
    // An explicit per-request temperature still wins.
    const reasoningProfile = await ctx
      .runQuery(internal.threads.internal_queries.getReasoningProfile, {
        organizationId: args.organizationId,
        // Stateless API turns share the 'chat' agent-type scope.
        scopeKey: reasoningScopeKey(resolved.modelData.modelId),
      })
      .catch(() => null);
    const reasoningDecision = buildReasoningOptions({
      modelData: resolved.modelData,
      baseProviderOptions: buildCallProviderOptions(resolved.modelData),
      signals: {
        kind: 'chat',
        promptText: sanitizedText,
        toolCount: aiTools ? Object.keys(aiTools).length : 0,
      },
      profile: reasoningProfile ?? undefined,
    });
    const callProviderOptions = reasoningDecision.providerOptions;
    const effectiveTemperature =
      genParams.temperature != null
        ? Number(genParams.temperature)
        : reasoningDecision.temperature;
    // Run inference. Any provider/inference failure is recorded as a `failure`
    // audit row before re-throwing — otherwise real failures leave no audit
    // trail at all (the success row below is unreachable once this throws).
    let text: string;
    let finishReason: string;
    let steps: Awaited<ReturnType<typeof streamText>['steps']>;
    let usage: Awaited<ReturnType<typeof streamText>['usage']>;
    try {
      const result = streamText({
        model: resolved.languageModel,
        system: systemPrompt,
        messages,
        ...(callProviderOptions
          ? { providerOptions: callProviderOptions }
          : {}),
        ...(aiTools && { tools: aiTools }),
        ...(args.toolChoice != null && {
          toolChoice: mapToolChoice(args.toolChoice),
        }),
        ...(effectiveTemperature != null && {
          temperature: effectiveTemperature,
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

      text = await result.text;
      finishReason = await result.finishReason;
      steps = await result.steps;
      usage = await result.usage;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      await writeAiAudit(ctx, {
        organizationId: args.organizationId,
        userId: args.userId,
        userEmail: args.userEmail,
        action: 'ai.completion',
        resourceType: 'agent_completion',
        requestId,
        status: 'failure',
        errorMessage,
        metadata: {
          model: resolved.modelData.modelId,
          provider: resolved.modelData.providerName,
          agentType: 'direct_model',
        },
      });
      throw error;
    }

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
    const inputTokens = usage?.inputTokens ?? 0;
    const outputTokens = usage?.outputTokens ?? 0;
    const totalTokens = inputTokens + outputTokens;

    let costCents: number | undefined;
    if (args.organizationId && (inputTokens > 0 || outputTokens > 0)) {
      const { estimateCostCents } =
        await import('../governance/cost_estimation');
      costCents = estimateCostCents(
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
            // No agentSlug — direct model API is not agent-bound.
            model: resolved.modelData.modelId,
            provider: resolved.modelData.providerName,
            // Attribute this request's usage to the authenticating API key so
            // the per-API-key budget scope can measure and enforce against it.
            ...(args.apiKeyId !== undefined ? { apiKeyId: args.apiKeyId } : {}),
          },
        )
        .catch((error) => {
          console.error(
            '[OpenAI-compat:directModel] Failed to increment usage ledger:',
            error,
          );
        });
    }

    // Audit every completed request — status reflects the real outcome.
    await writeAiAudit(ctx, {
      organizationId: args.organizationId,
      userId: args.userId,
      userEmail: args.userEmail,
      action: 'ai.completion',
      resourceType: 'agent_completion',
      requestId,
      status: 'success',
      metadata: {
        model: resolved.modelData.modelId,
        provider: resolved.modelData.providerName,
        inputTokens,
        outputTokens,
        totalTokens,
        costEstimateCents: costCents ?? null,
        finishReason,
        agentType: 'direct_model',
        toolCallCount: toolCalls.length,
      },
    });

    return {
      requestId,
      text: text || null,
      toolCalls: toolCalls.length > 0 ? toolCalls : null,
      images: null,
      finishReason,
      inputTokens,
      outputTokens,
      totalTokens,
      resolvedModel: resolved.modelData.modelId,
    };
  },
});

// ---------------------------------------------------------------------------
// Image generation
// ---------------------------------------------------------------------------

/**
 * Ledger + success audit for a completed image generation. Best-effort.
 *
 * The ledger row is written for every generation that carries an org, even when
 * the model reports no cost and zero tokens: for an image request the request
 * itself is the billable unit, so the row must land to increment `requestCount`
 * — otherwise a per-API-key `maxRequests` (or `maxCostCents`) budget could never
 * cap an unpriced image model. Image models legitimately report `{0,0,0}` tokens,
 * so a token budget still does not bound them; that is expected.
 */
export async function recordImageUsageAndAudit(
  ctx: ActionCtx,
  opts: {
    requestId: string;
    action: string;
    organizationId: string;
    userId?: string;
    userEmail?: string;
    apiKeyId?: string;
    img: ApiImageResult;
  },
): Promise<void> {
  const { img } = opts;
  if (opts.organizationId) {
    await ctx
      .runMutation(
        internal.governance.internal_mutations.incrementUsageLedger,
        {
          organizationId: opts.organizationId,
          userId: opts.userId ?? 'system',
          inputTokens: img.usage.inputTokens,
          outputTokens: img.usage.outputTokens,
          costEstimateCents: img.costCents ?? 0,
          timestamp: Date.now(),
          model: img.modelId,
          provider: img.providerName,
          ...(opts.apiKeyId !== undefined ? { apiKeyId: opts.apiKeyId } : {}),
        },
      )
      .catch((error) => {
        console.error(
          '[OpenAI-compat:image] Failed to increment usage ledger:',
          error,
        );
      });
  }
  await writeAiAudit(ctx, {
    organizationId: opts.organizationId,
    userId: opts.userId,
    userEmail: opts.userEmail,
    action: opts.action,
    resourceType: 'image_generation',
    requestId: opts.requestId,
    status: 'success',
    metadata: {
      model: img.modelId,
      provider: img.providerName,
      imageCount: img.persisted.length,
      inputTokens: img.usage.inputTokens,
      outputTokens: img.usage.outputTokens,
      costEstimateCents: img.costCents ?? null,
      clamped: img.clamped,
    },
  });
}

/**
 * Generate image(s) for an `image-generation`-tagged model requested via
 * `/chat/completions`, returning them as chat `message.images[]`. Budget + RBAC
 * have already run in the caller. A failure is audited before re-throwing.
 */
async function runChatImageGeneration(
  ctx: ActionCtx,
  opts: {
    requestId: string;
    modelRef: string;
    prompt: string;
    attachmentBytes?: GeneratedImageBlob[];
    organizationId: string;
    userId: string;
    userEmail?: string;
    apiKeyId?: string;
  },
): Promise<DirectModelResult> {
  try {
    const img = await generateApiImages(ctx, {
      modelRef: opts.modelRef,
      prompt: opts.prompt,
      n: 1,
      organizationId: opts.organizationId,
      namePrefix: 'openai-chat-image',
      attachmentBytes: opts.attachmentBytes,
    });
    await recordImageUsageAndAudit(ctx, {
      requestId: opts.requestId,
      action: 'ai.image_generation',
      organizationId: opts.organizationId,
      userId: opts.userId,
      userEmail: opts.userEmail,
      apiKeyId: opts.apiKeyId,
      img,
    });
    return {
      requestId: opts.requestId,
      text: null,
      toolCalls: null,
      images: img.persisted.map((p) => ({
        type: 'image_url' as const,
        image_url: { url: p.downloadUrl },
      })),
      finishReason: 'stop',
      inputTokens: img.usage.inputTokens,
      outputTokens: img.usage.outputTokens,
      totalTokens: img.usage.totalTokens,
      resolvedModel: img.modelId,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await writeAiAudit(ctx, {
      organizationId: opts.organizationId,
      userId: opts.userId,
      userEmail: opts.userEmail,
      action: 'ai.image_generation',
      resourceType: 'image_generation',
      requestId: opts.requestId,
      status: 'failure',
      errorMessage,
      metadata: { modelRef: opts.modelRef },
    });
    throw error;
  }
}

interface ImagesGenerateResult {
  requestId: string;
  model: string;
  data: Array<{ url?: string; b64_json?: string }>;
  /** Whether `n` was clamped to the per-request ceiling. */
  clamped: boolean;
}

/**
 * `POST /api/v1/images/generations` backend. Reuses the shared image core, so
 * it behaves identically to the in-product image agent. Enforces the same
 * budget + RBAC as chat, sanitizes the prompt, and audits success/failure.
 */
export const imagesGenerateDirect = internalAction({
  args: {
    modelId: v.string(),
    organizationId: v.string(),
    userId: v.string(),
    userEmail: v.optional(v.string()),
    userName: v.optional(v.string()),
    apiKeyId: v.optional(v.string()),
    prompt: v.string(),
    n: v.optional(v.number()),
    responseFormat: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<ImagesGenerateResult> => {
    await enforceBudgetAndAccess(ctx, {
      organizationId: args.organizationId,
      userId: args.userId,
      userEmail: args.userEmail,
      modelId: args.modelId,
      apiKeyId: args.apiKeyId,
    });

    const orgSlug = await resolveOrgSlug(ctx, args.organizationId);
    const prompt = await sanitizeUserMessage(
      ctx,
      args.prompt,
      args.organizationId,
      orgSlug,
      args.userId,
      args.userEmail ?? '',
      args.modelId,
    );

    const requestId = `img-${Date.now().toString(36)}`;
    try {
      const img = await generateApiImages(ctx, {
        modelRef: args.modelId,
        prompt,
        n: args.n,
        organizationId: args.organizationId,
        namePrefix: 'openai-image',
      });
      await recordImageUsageAndAudit(ctx, {
        requestId,
        action: 'ai.image_generation',
        organizationId: args.organizationId,
        userId: args.userId,
        userEmail: args.userEmail,
        apiKeyId: args.apiKeyId,
        img,
      });
      const data =
        args.responseFormat === 'b64_json'
          ? img.blobs.map((b) => ({
              b64_json: Buffer.from(b.bytes).toString('base64'),
            }))
          : img.persisted.map((p) => ({ url: p.downloadUrl }));
      return { requestId, model: img.modelId, data, clamped: img.clamped };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      await writeAiAudit(ctx, {
        organizationId: args.organizationId,
        userId: args.userId,
        userEmail: args.userEmail,
        action: 'ai.image_generation',
        resourceType: 'image_generation',
        requestId,
        status: 'failure',
        errorMessage,
        metadata: { model: args.modelId },
      });
      throw error;
    }
  },
});
