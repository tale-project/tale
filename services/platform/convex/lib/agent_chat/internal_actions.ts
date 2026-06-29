'use node';

import {
  Agent,
  listMessages,
  saveMessage,
  type MessageDoc,
} from '@convex-dev/agent';
import type { ModelMessage } from 'ai';
import { type ObjectType, v } from 'convex/values';

import {
  buildHumanErrorSentence,
  classifyChatErrorCode,
  encodeChatError,
} from '../../../lib/shared/chat-errors';
import {
  formatModelFallbackBody,
  SYSTEM_MSG_TAG,
} from '../../../lib/shared/constants/system-message-tags';
import { parseModelRef } from '../../../lib/shared/utils/model-ref';
import {
  isRecord,
  getString,
  narrowStringUnion,
} from '../../../lib/utils/type-utils';
import { components, internal } from '../../_generated/api';
import { internalAction, type ActionCtx } from '../../_generated/server';
import { TOOL_NAMES, type ToolName } from '../../agent_tools/tool_names';
import { routeSeedValidator, routeTuningValidator } from '../../agents/schema';
import { resolveOrgSlug } from '../../organizations/resolve_org_slug';
import { recordFailure } from '../../providers/circuit_breaker';
import {
  classifyFailureScope,
  isTransientProviderError,
} from '../../providers/errors';
import { resolveLanguageModelWithFallback } from '../../providers/failover';
import {
  isModelScopeRetired,
  retiredScopeKey,
} from '../../providers/failure_scope';
// Node-only fast-path resolver — in-process, skips the ~340ms runAction hop
// that resolve_model.ts uses to stay V8-importable.
import { resolveLanguageModelByIdNode } from '../../providers/resolve_model_node';
import { autoRouteReasonValidator } from '../../streaming/validators';
import { generateAgentResponse } from '../agent_response';
import { routeModelOrder } from '../agent_response/model_routing/route_model';
import { resolvePromptCaching } from '../agent_response/prompt_caching/strategy';
import type { GenerateResponseHooks } from '../agent_response/types';
import { userContextValidator } from '../agent_response/validators';
import { buildInlineMultiModalPrompt } from '../attachments/build_inline_multi_modal_prompt';
import {
  estimateTokens,
  DEFAULT_MODEL_CONTEXT_LIMIT,
  CONTEXT_SAFETY_MARGIN,
  SYSTEM_INSTRUCTIONS_TOKENS,
  OUTPUT_RESERVE,
} from '../context_management';
import {
  AGENT_CONTEXT_CONFIGS,
  type AgentType,
} from '../context_management/constants';
import { createAgentConfig } from '../create_agent_config';
import { createDebugLog } from '../debug_log';
import { NonRetryableError } from '../error_classification';
import { buildCallProviderOptions } from '../provider_options';
import { buildHooksFromConfig } from './build_hooks';
import {
  buildIntegrationTools,
  buildDelegationTools,
  buildWorkflowTools,
  buildMcpTools,
  buildToolsSummary,
} from './build_tools';
import { fetchGovernanceSystemPrompt } from './governance_prompt';
import { buildSkillContext } from './skills_runtime';
import {
  buildTodosPromptAugmentation,
  collectUniqueSources,
  prettifyUrl,
} from './todos_reminder';

const debugLog = createDebugLog('DEBUG_CHAT_AGENT', '[runAgentGeneration]');

const serializableAgentConfigValidator = v.object({
  name: v.string(),
  /**
   * Root behavior the agent runs. Chat is the default; image-generation
   * is forked out before `runAgentGeneration` so this field is informational
   * here, but the mapper emits it and the validator is strict — keep it
   * declared so historical configs and image agents do not crash arg
   * validation.
   */
  primaryBehavior: v.optional(
    v.union(
      v.literal('chat'),
      v.literal('image-generation'),
      v.literal('external-agent'),
    ),
  ),
  /** External agent runtime when primaryBehavior is 'external-agent'.
   * Informational here (external-agent forks out before runAgentGeneration);
   * declared so the strict validator accepts external-agent configs. */
  agentKind: v.optional(
    v.union(v.literal('claude-code'), v.literal('opencode')),
  ),
  instructions: v.string(),
  convexToolNames: v.optional(v.array(v.string())),
  integrationBindings: v.optional(v.array(v.string())),
  workflowBindings: v.optional(v.array(v.string())),
  model: v.optional(v.string()),
  provider: v.optional(v.string()),
  maxSteps: v.optional(v.number()),
  outputFormat: v.optional(v.union(v.literal('text'), v.literal('json'))),
  knowledgeMode: v.optional(
    v.union(
      v.literal('off'),
      v.literal('tool'),
      v.literal('context'),
      v.literal('both'),
    ),
  ),
  webSearchMode: v.optional(
    v.union(
      v.literal('off'),
      v.literal('tool'),
      v.literal('context'),
      v.literal('both'),
    ),
  ),
  includeTeamKnowledge: v.optional(v.boolean()),
  includeOrgKnowledge: v.optional(v.boolean()),
  agentTeamId: v.optional(v.string()),
  agentTeamIds: v.optional(v.array(v.string())),
  knowledgeFileIds: v.optional(v.array(v.string())),
  /**
   * Projects feature: project IDs whose RAG-indexed files should be
   * unioned into the agent's file scope (chat happens inside a project).
   */
  agentProjectIds: v.optional(v.array(v.string())),
  delegationDisabled: v.optional(v.boolean()),
  runtime: v.optional(
    v.object({
      adapterType: v.string(),
      daemonId: v.optional(v.string()),
      permissionMode: v.union(
        v.literal('safe'),
        v.literal('auto_edits'),
        v.literal('full_auto'),
      ),
      workspaceKey: v.optional(v.string()),
    }),
  ),
  skillBindings: v.optional(v.array(v.string())),
  structuredResponsesEnabled: v.optional(v.boolean()),
  timeoutMs: v.optional(v.number()),
  outputReserve: v.optional(v.number()),
  fallbackModels: v.optional(v.array(v.string())),
  personalizationMode: v.optional(v.union(v.literal('on'), v.literal('off'))),
  /** Prose-level style/verbosity the Auto router advised (Auto mode only). */
  responseStyle: v.optional(routeTuningValidator),
  /** Coarse reasoning seed (effort/creativity) the Auto router advised, fed to
   *  the governor as a prior (Auto mode only). */
  routeSeed: v.optional(routeSeedValidator),
  /** Advisory reply-language hint from the Auto router (feeds the language
   *  directive's fallback only). See `SerializableAgentConfig.replyLocaleHint`. */
  replyLocaleHint: v.optional(v.string()),
  routing: v.optional(
    v.object({
      modelSelection: v.optional(
        v.union(v.literal('config'), v.literal('auto')),
      ),
      cascade: v.optional(v.boolean()),
      cascadeDraftModel: v.optional(v.string()),
      // Orchestration policy lives on the router agent; included here so the
      // whole `routing` object validates when it rides along on any agent.
      orchestration: v.optional(
        v.union(
          v.literal('single'),
          v.literal('orchestrate'),
          v.literal('auto'),
        ),
      ),
      maxOrchestrationSteps: v.optional(v.number()),
    }),
  ),
  /** Monthly spend guardrail (mirrors `SerializableAgentConfig.budget`). */
  budget: v.optional(
    v.object({
      monthlyCents: v.number(),
      warnPct: v.optional(v.number()),
      pausePct: v.optional(v.number()),
    }),
  ),
  /** Per-agent concurrency cap (mirrors `SerializableAgentConfig`). */
  maxConcurrentTasks: v.optional(v.number()),
});

const hooksConfigValidator = v.object({
  beforeContext: v.optional(v.string()),
  beforeGenerate: v.optional(v.string()),
  afterGenerate: v.optional(v.string()),
});

const runGenerationArgs = {
  agentType: v.string(),
  agentConfig: serializableAgentConfigValidator,
  model: v.string(),
  provider: v.optional(v.string()),
  debugTag: v.string(),
  enableStreaming: v.optional(v.boolean()),
  hooks: v.optional(hooksConfigValidator),
  threadId: v.string(),
  organizationId: v.string(),
  userId: v.optional(v.string()),
  agentSlug: v.optional(v.string()),
  autoRouteReason: v.optional(autoRouteReasonValidator),
  promptMessage: v.string(),
  /**
   * Un-augmented user text (without the attachment markdown that
   * `buildMessageWithAttachments` appends to `promptMessage`). Used as the
   * text part when building a multimodal prompt for vision-capable models,
   * so PDF/audio references aren't duplicated.
   */
  originalUserText: v.optional(v.string()),
  additionalContext: v.optional(v.record(v.string(), v.string())),
  userContext: v.optional(userContextValidator),
  parentThreadId: v.optional(v.string()),
  agentOptions: v.optional(v.any()),
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
  streamId: v.optional(v.string()),
  promptMessageId: v.optional(v.string()),
  maxSteps: v.optional(v.number()),
  deadlineMs: v.optional(v.number()),
  generationParams: v.optional(v.any()),
  maxContextTokens: v.optional(v.number()),
  threadTeamId: v.optional(v.string()),
  /**
   * Storage IDs of knowledge-base documents the user `@`-mentioned on this
   * turn (already access-validated by chatWithAgentTurn). When present, the
   * per-turn auto-RAG context is forced on and scoped to exactly these files
   * — see generate_response.ts.
   */
  pinnedFileIds: v.optional(v.array(v.string())),
  // Server-stamped turn-start (chatWithAgent entry) for TTFT measurement.
  // Optional so jobs scheduled before this field existed still validate
  // during a rolling deploy (the consumer falls back to the action start).
  requestStartMs: v.optional(v.number()),
  // PERF (diagnostic): wall-clock when startAgentChat scheduled this action.
  // Lets us isolate the scheduler dispatch + module-import hop in isolation.
  scheduledAtMs: v.optional(v.number()),
  /** Cache pre-warm: build the real tools + stable system prefix and issue a
   * single throwaway priming call, then return — no persistence/streaming. */
  prewarm: v.optional(v.boolean()),
};
type RunGenerationArgs = ObjectType<typeof runGenerationArgs>;

/**
 * Durable scheduled-action wrapper. Kept for callers that schedule generation
 * across the V8↔node boundary (fork/edit/openai/webhooks). The chat path calls
 * `runGenerationCore` IN-PROCESS instead (no node→backend runAction hop).
 */
export const runAgentGeneration = internalAction({
  args: runGenerationArgs,
  handler: (ctx, args) => runGenerationCore(ctx, args),
});

/**
 * Generation core: tool build → model resolution (fallback loop) →
 * generateAgentResponse → result/retry handling. Call this directly from a
 * node action to run generation in-process (the chat path); or via the
 * `runAgentGeneration` scheduled wrapper for durable cross-boundary callers.
 */
export async function runGenerationCore(
  ctx: ActionCtx,
  args: RunGenerationArgs,
) {
  const actionStartTime = Date.now();
  debugLog('ACTION_START', {
    threadId: args.threadId,
    timestamp: new Date(actionStartTime).toISOString(),
    // Send → this action's start: the upstream work (auto-route,
    // markGenerating, startChat) PLUS the Convex scheduler dequeue hop —
    // the single biggest pre-stream segment the pipeline can target.
    // Undefined for jobs scheduled before requestStartMs existed.
    sinceRequestStartMs: args.requestStartMs
      ? actionStartTime - args.requestStartMs
      : undefined,
    // PERF: pure scheduler dispatch + module-import latency. A large value
    // here that SHRINKS on the 2nd warm send = cold module re-import after a
    // `convex dev` push, not steady-state cost. Diagnostic.
    scheduleHopMs: args.scheduledAtMs
      ? actionStartTime - args.scheduledAtMs
      : undefined,
  });

  const {
    agentType: agentTypeStr,
    agentConfig,
    model,
    provider: _provider,
    debugTag,
    enableStreaming,
    hooks: hooksConfig,
    threadId,
    organizationId,
    userId,
    promptMessage,
    originalUserText,
    additionalContext,
    userContext,
    parentThreadId,
    agentOptions,
    attachments,
    streamId,
    promptMessageId,
    maxSteps,
    deadlineMs,
    generationParams,
    maxContextTokens,
  } = args;

  const agentType = narrowStringUnion(
    agentTypeStr,
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Object.keys loses literal types; keys are known AgentType values
    Object.keys(AGENT_CONTEXT_CONFIGS) as AgentType[],
  );
  if (!agentType) {
    throw new Error(`Invalid agent type: ${agentTypeStr}`);
  }

  // Tracked across the fallback loop so the final catch-all can build an
  // accurate, provider-specific error envelope (which model/provider failed
  // last, and how many were attempted).
  let lastResolvedProvider: string | undefined;
  let lastResolvedModelId: string | undefined;
  let attemptedCount = 0;

  try {
    const toolBuildStart = Date.now();

    // Flatten the tool-build round-trips into ONE awaited set instead of a
    // serial resolveOrgSlug + two stage barriers. The org-id-only resources
    // (locale, governance, MCP, integrations) start immediately; the
    // orgSlug/orgLocale-dependent builders (skill, delegation, workflow)
    // chain off those promises so they begin the moment their input resolves.
    // `buildSkillContext` short-circuits to the empty snapshot when the
    // agent's `skillBindings` allowlist is empty (no disk reads, no
    // `expand_skill` tool). Arg passing is byte-identical to the prior two
    // stages — only the concurrency shape changed.
    const effectiveConfig = agentConfig;
    const orgSlugPromise = resolveOrgSlug(ctx, organizationId);
    const orgLocalePromise = ctx.runQuery(
      internal.organizations.internal_queries.getOrganizationDefaultLocale,
      { organizationId },
    );
    const [
      governanceResult,
      mcpExtraTools,
      integrationExtraTools,
      skillSnapshot,
      delegationResult,
      workflowExtraTools,
    ] = await Promise.all([
      fetchGovernanceSystemPrompt(ctx, organizationId, parentThreadId),
      buildMcpTools(ctx, organizationId),
      buildIntegrationTools(ctx, effectiveConfig, organizationId),
      // orgSlug/orgLocale are awaited transitively via these dependent
      // builders (so resolveOrgSlug errors still surface); not needed
      // standalone after the block.
      orgSlugPromise.then((s) =>
        buildSkillContext(ctx, s, agentConfig.skillBindings),
      ),
      Promise.all([orgSlugPromise, orgLocalePromise]).then(([s, l]) =>
        buildDelegationTools(ctx, effectiveConfig, organizationId, s, l),
      ),
      orgSlugPromise.then((s) => buildWorkflowTools(ctx, effectiveConfig, s)),
    ]);

    // Extract delegation tools and instructions append
    let delegationExtraTools: Record<string, unknown> | undefined;
    let delegationInstructionsAppend = '';
    if (delegationResult) {
      delegationExtraTools = delegationResult.tools;
      delegationInstructionsAppend = delegationResult.instructionsAppend;
      debugLog('Built delegation tools', {
        names: Object.keys(delegationExtraTools),
      });
    }

    if (workflowExtraTools) {
      debugLog('Built bound workflow tools', {
        names: Object.keys(workflowExtraTools),
      });
    }

    // Extract governance prompt prefixes/suffixes
    const { mandatoryPrefix, mandatorySuffix } = governanceResult;

    const toolBuildMs = Date.now() - toolBuildStart;
    debugLog('PERF_TOOL_BUILD', {
      durationMs: toolBuildMs,
      hasIntegrations: !!integrationExtraTools,
      hasDelegation: !!delegationExtraTools,
      hasWorkflows: !!workflowExtraTools,
      hasMcp: !!mcpExtraTools,
      hasGovernance: !!(mandatoryPrefix || mandatorySuffix),
    });

    // Merge all extra tools. Skill built-ins (`expand_skill`,
    // `read_skill_file`) are spliced in last so they cannot be shadowed by
    // an integration / workflow / delegation tool sharing the same
    // reserved name — defense-in-depth for the reserved-name set.
    const hasAnyExtra =
      integrationExtraTools ||
      delegationExtraTools ||
      workflowExtraTools ||
      mcpExtraTools ||
      Object.keys(skillSnapshot.builtInTools).length > 0;
    const allExtraTools: Record<string, unknown> | undefined = hasAnyExtra
      ? {
          ...integrationExtraTools,
          ...delegationExtraTools,
          ...workflowExtraTools,
          ...mcpExtraTools,
          ...skillSnapshot.builtInTools,
        }
      : undefined;

    // Combine instructions with delegation agent descriptions
    let finalInstructions = delegationInstructionsAppend
      ? agentConfig.instructions + delegationInstructionsAppend
      : agentConfig.instructions;

    // Wrap with mandatory governance system prompt (non-overridable)
    if (mandatoryPrefix) {
      finalInstructions = mandatoryPrefix + '\n\n' + finalInstructions;
    }
    if (mandatorySuffix) {
      finalInstructions = finalInstructions + '\n\n' + mandatorySuffix;
    }
    // Append the "Available Skills" suffix AFTER governance so the
    // governance/persona prefix stays cache-stable across skill edits
    // (plan Phase 5 ordering). Empty string when no skills bound.
    if (skillSnapshot.systemPromptAppend) {
      finalInstructions = finalInstructions + skillSnapshot.systemPromptAppend;
    }

    // Build hooks object from FunctionHandle strings
    const hooks: GenerateResponseHooks | undefined = hooksConfig
      ? buildHooksFromConfig(hooksConfig)
      : undefined;

    // Build tools summary for context window display.
    // Read from effectiveConfig — agentConfig predates the skill merge
    // and would omit skill-declared convex tools.
    const toolsSummary = buildToolsSummary(
      effectiveConfig.convexToolNames,
      allExtraTools,
    );

    // Build ordered list of models to try: primary + fallbacks.
    const primaryModelId = model === 'default' ? undefined : model;
    let modelsToTry: Array<string | undefined> = [
      primaryModelId,
      ...(agentConfig.fallbackModels ?? []),
    ];

    // Complexity-based model routing (opt-in per agent): reorder the concrete
    // refs so the tier-appropriate model is tried first. Skips the `default`-tag
    // entry (undefined) and prewarm; fails safe to config order.
    if (
      agentConfig.routing?.modelSelection === 'auto' &&
      !args.prewarm &&
      primaryModelId
    ) {
      const concreteRefs = modelsToTry.filter(
        (r): r is string => typeof r === 'string',
      );
      if (concreteRefs.length > 1) {
        modelsToTry = await routeModelOrder(ctx, {
          organizationId,
          supportedModels: concreteRefs,
          promptText: promptMessage,
          // Only IMAGE attachments require a vision-capable model. A
          // PDF/CSV/text attachment must not narrow the routing pool to vision
          // models (and away from the strongest text model) — mirror the
          // `image/*` filter used for the multimodal branch below.
          requiresVision:
            attachments?.some((a) => a.fileType.startsWith('image/')) ?? false,
        });
      }
    }

    // Fallback retry loop — try each model in order until one succeeds.
    //
    // A model that fails with a DETERMINISTIC provider-level error retires the
    // failing *resource* — the credential (provider + API key) for funds/auth,
    // or the endpoint (provider + baseUrl) for an unreachable host — and every
    // later model sharing that resource is skipped instead of waiting on a
    // doomed request. Keying by credential (not provider name) means a sibling
    // model with its own `secretsEnv` key is still tried after another key dies.
    // An out-of-funds (credit) failure is the one exception that does NOT doom
    // every sibling: a zero-cost model on the same credential (`:free` / priced
    // at 0) draws no credits, so `isModelScopeRetired` still attempts it (#1454).
    let lastFallbackError: unknown;
    const deadScopes = new Set<string>();

    // RESOLUTION (no HTTP) is memoized per model index so the catch can look
    // ahead for the next attemptable model without paying for it twice. A
    // model/provider that is not configured or wrongly configured — missing
    // provider/model, unresolvable key, malformed baseURL — resolves to an
    // error here, and we move on WITHOUT a doomed request or a circuit-breaker
    // record (config problem, not provider flakiness). Per-entry provider
    // qualifier ("openrouter:foo") takes precedence over the agent's.
    type Resolution =
      | {
          ok: true;
          resolved: Awaited<ReturnType<typeof resolveLanguageModelByIdNode>>;
        }
      | { ok: false; error: unknown };
    const resolutionCache = new Map<number, Resolution>();
    const resolveAt = async (index: number): Promise<Resolution> => {
      const cached = resolutionCache.get(index);
      if (cached) return cached;
      const ref = modelsToTry[index];
      let result: Resolution;
      try {
        const parsed = ref ? parseModelRef(ref) : undefined;
        const resolved = parsed
          ? await resolveLanguageModelByIdNode(ctx, {
              modelId: parsed.modelId,
              providerName: parsed.providerName ?? agentConfig.provider,
              organizationId,
            })
          : await resolveLanguageModelWithFallback(ctx, {
              providerName: agentConfig.provider,
              tag: 'chat',
              organizationId,
            });
        result = { ok: true, resolved };
      } catch (error) {
        result = { ok: false, error };
      }
      resolutionCache.set(index, result);
      return result;
    };
    // First index ≥ `from` that resolves to a configured model on a live scope.
    const findNextAttemptable = async (from: number): Promise<number> => {
      for (let i = from; i < modelsToTry.length; i++) {
        const r = await resolveAt(i);
        if (r.ok && !isModelScopeRetired(r.resolved.modelData, deadScopes)) {
          return i;
        }
      }
      return -1;
    };

    for (let attempt = 0; attempt < modelsToTry.length; attempt++) {
      const currentModelId = modelsToTry[attempt];

      const resolution = await resolveAt(attempt);
      if (!resolution.ok) {
        lastFallbackError = resolution.error;
        if (attempt < modelsToTry.length - 1) {
          debugLog('SKIP_UNCONFIGURED_MODEL', {
            model: currentModelId ?? 'default',
            nextModel: modelsToTry[attempt + 1] ?? 'default',
            reason:
              resolution.error instanceof Error
                ? resolution.error.message
                : String(resolution.error),
          });
          continue;
        }
        throw resolution.error;
      }
      const resolved = resolution.resolved;

      // Skip a resource already retired this turn — no HTTP call, no
      // circuit-breaker record, no fallback notice. If it's the last entry the
      // loop falls through to the throw below, carrying the real cause.
      if (isModelScopeRetired(resolved.modelData, deadScopes)) {
        debugLog('SKIP_DEAD_SCOPE', {
          model: resolved.modelData.modelId,
          provider: resolved.modelData.providerName,
        });
        if (attempt < modelsToTry.length - 1) continue;
        break;
      }

      try {
        const { languageModel, modelData } = resolved;
        const resolvedProvider = modelData.providerName;
        const resolvedModelId = modelData.modelId;
        lastResolvedProvider = resolvedProvider;
        lastResolvedModelId = resolvedModelId;
        attemptedCount += 1;

        // Prewarm only pays off when there is a cache to warm. For a model whose
        // caching strategy resolves to 'none' (unknown family, no operator
        // override), the priming generation would write nothing and hit nothing
        // on the real turn — a wasted billed input-token call on every composer
        // focus. Skip it. 'auto-server' (OpenAI/DeepSeek) and
        // 'explicit-breakpoints' (Anthropic/Gemini) still warm.
        if (
          args.prewarm &&
          resolvePromptCaching({
            modelId: resolvedModelId,
            promptCaching: modelData.promptCaching,
          }).mode === 'none'
        ) {
          debugLog('PREWARM_SKIP_NO_CACHE', { model: resolvedModelId });
          return {
            threadId,
            text: '',
            finishReason: 'prewarm-skip',
            durationMs: 0,
          };
        }

        // Vision branch: when the resolved chat model has the `vision`
        // tag and the turn carries image attachments, inline the images
        // as multimodal content and drop the `image` tool for this
        // attempt. Failover to a non-vision model on the next attempt
        // re-evaluates and reverts to the markdown + image-tool path.
        const imageAttachments =
          attachments?.filter((a) => a.fileType.startsWith('image/')) ?? [];
        const isVisionCapable = modelData.tags.includes('vision');
        const useMultiModal = isVisionCapable && imageAttachments.length > 0;

        let multiModalPrompt: ModelMessage[] | undefined;
        if (useMultiModal) {
          const built = await buildInlineMultiModalPrompt(ctx, {
            userText: originalUserText ?? promptMessage,
            imageAttachments,
          });
          multiModalPrompt = built.prompt;
          debugLog('MULTIMODAL_BRANCH', {
            modelId: resolvedModelId,
            inlinedImageCount: built.inlinedImageCount,
            skippedImages: built.skippedImages,
          });
        }

        // Read+write symmetry: only attach `propose_memory` when the
        // memories gate is on (org `user_memories` policy,
        // `prefs.memoriesEnabled === true`, and no thread veto). The
        // agent-level `personalizationMode === 'off'` short-circuits
        // before we hit the DB and disables BOTH features.
        const personalizationActive =
          userId && organizationId && agentConfig.personalizationMode !== 'off'
            ? ((
                await ctx.runQuery(
                  internal.personalization.internal_queries
                    .isPersonalizationActiveForChat,
                  { userId, organizationId, threadId },
                )
              )?.memories ?? false)
            : false;

        // Create agent factory function from serializable config
        const createAgent = () => {
          // Filter tools: exclude rag_search/web when their retrieval mode
          // is 'context' or 'off' (tool should only be available in 'tool'/'both').
          // Drop `image` when the chat model handles images natively.
          const knowledgeMode = agentConfig.knowledgeMode ?? 'off';
          const webSearchMode = agentConfig.webSearchMode ?? 'off';
          // Read from effectiveConfig so skill-declared convex tools
          // (post-mergeSkillDependencies) actually reach the LLM.
          const baseToolList = effectiveConfig.convexToolNames ?? [];
          const autoInjected: string[] = [...baseToolList];
          // `propose_memory` is offered only while personalization is active.
          if (
            personalizationActive &&
            !autoInjected.includes('propose_memory')
          ) {
            autoInjected.push('propose_memory');
          }
          // `generate_image` is always available to chat agents so any
          // assistant — including whichever one the Auto router picks — can
          // satisfy an explicit "create an image" request. It degrades
          // gracefully (the tool reports unavailable) when the workspace has no
          // image-generation model configured. Image-generation agents never
          // reach this path (they bypass the tool loop), but guard anyway.
          if (
            agentConfig.primaryBehavior !== 'image-generation' &&
            !autoInjected.includes('generate_image')
          ) {
            autoInjected.push('generate_image');
          }
          const filteredToolNames = autoInjected.filter((n): n is ToolName => {
            if (!(TOOL_NAMES as readonly string[]).includes(n)) return false;
            if (n === 'propose_memory' && !personalizationActive) return false;
            if (
              n === 'rag_search' &&
              knowledgeMode !== 'tool' &&
              knowledgeMode !== 'both'
            )
              return false;
            if (
              n === 'web' &&
              webSearchMode !== 'tool' &&
              webSearchMode !== 'both'
            )
              return false;
            if (n === 'image' && useMultiModal) return false;
            return true;
          });
          const config = createAgentConfig({
            name: agentConfig.name,
            instructions: finalInstructions,
            languageModel,
            modelMaxOutputTokens: modelData.maxOutputTokens,
            convexToolNames:
              filteredToolNames.length > 0 ? filteredToolNames : undefined,
            extraTools: allExtraTools,
            maxSteps: agentConfig.maxSteps,
          });
          return new Agent(components.agent, config);
        };

        // PERF: ms from this action's entry to the generateAgentResponse
        // hand-off — i.e. the tool-build + model-resolution setup inside
        // runAgentGeneration. Diagnostic.
        debugLog('PERF_RUNGEN_SETUP', {
          threadId: args.threadId,
          runAgentGenSetupMs: Date.now() - actionStartTime,
          sinceSendMs: args.requestStartMs
            ? Date.now() - args.requestStartMs
            : undefined,
        });

        // Is another model still worth trying if this one fails? (Resolution is
        // memoized, so this lookahead is reused by the catch's failover.)
        const hasNextAttemptable =
          (await findNextAttemptable(attempt + 1)) !== -1;

        const result = await generateAgentResponse(
          {
            agentType,
            createAgent,
            model: resolvedModelId,
            provider: resolvedProvider,
            debugTag,
            enableStreaming,
            hooks,
            convexToolNames: effectiveConfig.convexToolNames,
            knowledgeMode: agentConfig.knowledgeMode,
            webSearchMode: agentConfig.webSearchMode,
            includeTeamKnowledge: agentConfig.includeTeamKnowledge,
            includeOrgKnowledge: agentConfig.includeOrgKnowledge,
            agentTeamId: agentConfig.agentTeamId,
            agentTeamIds: agentConfig.agentTeamIds,
            knowledgeFileIds: agentConfig.knowledgeFileIds,
            agentProjectIds: agentConfig.agentProjectIds,
            structuredResponsesEnabled: agentConfig.structuredResponsesEnabled,
            maxContextTokens,
            instructions: finalInstructions,
            toolsSummary,
            personalizationMode: agentConfig.personalizationMode,
            providerOptions: buildCallProviderOptions(modelData),
            modelMaxOutputTokens: modelData.maxOutputTokens,
            modelContextWindow: modelData.contextWindow,
            reasoningCapability: modelData.reasoning,
            responseStyle: agentConfig.responseStyle,
            routeSeed: agentConfig.routeSeed,
            replyLocaleHint: agentConfig.replyLocaleHint,
          },
          {
            ctx,
            threadId,
            organizationId,
            userId,
            agentSlug: args.agentSlug,
            autoRouteReason: args.autoRouteReason,
            teamIds: args.threadTeamId ? [args.threadTeamId] : undefined,
            providerCost:
              modelData.inputCentsPerMillion != null
                ? {
                    inputCentsPerMillion: modelData.inputCentsPerMillion,
                    outputCentsPerMillion: modelData.outputCentsPerMillion ?? 0,
                  }
                : undefined,
            promptMessage,
            additionalContext,
            userContext,
            parentThreadId,
            agentOptions,
            attachments,
            multiModalPrompt,
            streamId,
            promptMessageId,
            maxSteps,
            deadlineMs,
            generationParams,
            pinnedFileIds: args.pinnedFileIds,
            requestStartMs: args.requestStartMs,
            // Suppress error cleanup (stream error, generation status clear,
            // failed message) when there is another model still worth trying.
            // The fallback loop handles cleanup itself; the final catch-all
            // owns it when nothing attemptable remains.
            suppressErrorCleanup: hasNextAttemptable,
            prewarm: args.prewarm,
          },
        );

        // Prewarm: the priming call is done (cache written). Return before the
        // empty-text guard below — a prewarm result is intentionally empty.
        if (args.prewarm) {
          return result;
        }

        // User cancelled — cancelGeneration already handled message state
        if (result.finishReason === 'cancelled') {
          return result;
        }

        // Validate response — save a failed message so the client exits loading
        if (!result.text?.trim()) {
          try {
            await saveMessage(ctx, components.agent, {
              threadId,
              message: {
                role: 'assistant',
                content:
                  'I was unable to generate a response. Please try again.',
              },
              metadata: {
                status: 'failed',
                error: 'Agent returned empty response',
              },
            });
          } catch (saveError) {
            console.error(
              '[runAgentGeneration] Failed to save failed message:',
              saveError,
            );
          }
          throw new Error(
            `Agent returned empty response: ${JSON.stringify({
              model: result.model,
              usage: result.usage,
            })}`,
          );
        }

        return result;
      } catch (fallbackError) {
        lastFallbackError = fallbackError;

        const scope = classifyFailureScope(fallbackError);

        // Terminal: would fail on ANY model (content policy, context length,
        // no provider configured). Don't walk the chain at all.
        if (scope === 'terminal') throw fallbackError;

        const failedRef = currentModelId ?? model;
        const reasonCode = classifyChatErrorCode(fallbackError);

        // Deterministic provider-level failure (out of funds / invalid key /
        // host down): retire the failing RESOURCE — the credential (provider +
        // key) for funds/auth, the endpoint for an unreachable host — so its
        // siblings are skipped, but a sibling with its OWN key is still tried.
        const retired = retiredScopeKey(reasonCode, resolved.modelData);
        if (retired) deadScopes.add(retired);

        // Record a circuit-breaker failure only for transient errors (429,
        // 5xx, timeouts) — config/account issues aren't provider flakiness.
        if (
          currentModelId &&
          agentConfig.provider &&
          isTransientProviderError(fallbackError)
        ) {
          recordFailure(agentConfig.provider, currentModelId);
        }

        // The next model still worth attempting (skips retired resources).
        const nextIndex = await findNextAttemptable(attempt + 1);
        const outOfTime = deadlineMs != null && Date.now() >= deadlineMs - 5000;

        // Nothing attemptable left, or no time budget — surface the cause.
        if (nextIndex === -1 || outOfTime) {
          if (outOfTime) {
            debugLog('FALLBACK_SKIP_DEADLINE', {
              failedModel: failedRef,
              remainingMs:
                deadlineMs != null ? deadlineMs - Date.now() : undefined,
            });
          }
          throw fallbackError;
        }

        const nextRef = modelsToTry[nextIndex] ?? 'default';
        // Machine-readable body — the chat UI renders a localized line and the
        // model auto-switch reads `to`.
        const fallbackBody = `${SYSTEM_MSG_TAG.MODEL_FALLBACK} ${formatModelFallbackBody(
          { from: failedRef, to: nextRef, reason: reasonCode },
        )}`;

        debugLog('MODEL_FALLBACK', {
          attempt: attempt + 1,
          failedModel: failedRef,
          nextModel: nextRef,
          scope,
          reason: reasonCode,
        });

        // Save a structured system message so the user sees the fallback.
        try {
          await saveMessage(ctx, components.agent, {
            threadId,
            message: { role: 'system', content: fallbackBody },
          });
        } catch (msgError) {
          console.error(
            '[runAgentGeneration] Failed to save fallback message:',
            msgError,
          );
        }

        // Convert any stale failed/pending assistant message from this attempt
        // (suppressErrorCleanup left it untouched) into the same structured
        // fallback note so the thread doesn't show an orphaned error bubble.
        try {
          const msgs = await listMessages(ctx, components.agent, {
            threadId,
            paginationOpts: { cursor: null, numItems: 5 },
            excludeToolMessages: true,
          });
          const staleAssistants = msgs.page.filter(
            (m: MessageDoc) =>
              m.message?.role === 'assistant' &&
              (m.status === 'failed' || m.status === 'pending'),
          );
          for (const stale of staleAssistants) {
            await ctx.runMutation(components.agent.messages.updateMessage, {
              messageId: stale._id,
              patch: {
                status: 'success',
                message: { role: 'system', content: fallbackBody },
              },
            });
          }
        } catch (cleanupError) {
          debugLog('FALLBACK_CLEANUP_ERROR', { error: cleanupError });
        }

        // Advance to the next model; the dead-provider guard at the top of the
        // loop skips any retired-provider entries before `nextRef` cheaply
        // (resolution only, no request).
        continue;
      }
    }

    // Should not reach here, but satisfy TypeScript
    throw lastFallbackError ?? new Error('No model could be resolved');
  } catch (error) {
    // Log full error details for debugging
    const err = isRecord(error) ? error : { message: String(error) };
    console.error('[runAgentGeneration] Full error details:', {
      name: getString(err, 'name'),
      message: getString(err, 'message'),
      code: getString(err, 'code'),
      status: err['status'],
      statusCode: err['statusCode'],
      cause: err['cause'],
      stack: getString(err, 'stack'),
      error: JSON.stringify(
        error,
        isRecord(error) ? Object.getOwnPropertyNames(error) : [],
        2,
      ),
    });

    // generateAgentResponse's own catch terminalizes the stream for failures
    // raised inside it. Failures BEFORE it runs (tool building, model
    // resolution) reach here with the stream still 'pending'/'streaming',
    // which would leave non-streaming pollers (e.g. the Slack processor)
    // hanging until their own timeout. Mark it errored here too — idempotent
    // if it was already terminalized.
    if (streamId) {
      try {
        await ctx.runMutation(
          internal.streaming.internal_mutations.errorStream,
          { streamId },
        );
      } catch (streamError) {
        console.error(
          '[runAgentGeneration] Failed to error stream:',
          streamError,
        );
      }
      // Clear generation status so the UI stops showing "Thinking..."
      try {
        await ctx.runMutation(
          internal.threads.internal_mutations.clearGenerationStatus,
          { threadId, streamId },
        );
      } catch (clearError) {
        console.error(
          '[runAgentGeneration] Failed to clear generation status:',
          clearError,
        );
      }
    }

    // Prewarm is contractually invisible (no spinner, no saved message). A
    // failure BEFORE generateAgentResponse runs (model resolution, tool
    // building) still reaches this catch-all, so the failed-message save must be
    // skipped for prewarm — otherwise a misconfigured model would inject a
    // spurious "failed" assistant bubble into the user's real thread on every
    // composer focus. The error is still logged above and rethrown below.
    if (!args.prewarm) {
      try {
        const msgs = await listMessages(ctx, components.agent, {
          threadId,
          paginationOpts: { cursor: null, numItems: 5 },
          excludeToolMessages: true,
        });
        const newestAssistant = msgs.page.find(
          (m: MessageDoc) => m.message?.role === 'assistant',
        );
        // Structured, machine-readable error: the chat UI decodes it into an
        // authoritative, localized, provider-specific message; non-chat
        // surfaces fall back to the human sentence in `content`.
        const code = classifyChatErrorCode(error);
        const failedContent = buildHumanErrorSentence(code, {
          provider: lastResolvedProvider,
          model: lastResolvedModelId,
        });
        const failedError = encodeChatError({
          code,
          provider: lastResolvedProvider,
          model: lastResolvedModelId,
          triedCount: attemptedCount > 0 ? attemptedCount : undefined,
          raw: getString(err, 'message') ?? 'Unknown error',
        });

        if (newestAssistant?.status === 'failed') {
          // Already failed (generateAgentResponse saved it with its own
          // envelope) — leave it.
        } else if (newestAssistant?.status === 'pending') {
          // Zombie pending message — the SDK created it but generation threw
          // before finalize. Update in place so the user sees the error
          // instead of a perpetual spinner.
          await ctx.runMutation(components.agent.messages.updateMessage, {
            messageId: newestAssistant._id,
            patch: {
              status: 'failed',
              error: failedError,
              message: { role: 'assistant' as const, content: failedContent },
            },
          });
        } else {
          await saveMessage(ctx, components.agent, {
            threadId,
            message: { role: 'assistant', content: failedContent },
            metadata: { status: 'failed', error: failedError },
          });
        }
      } catch (saveError) {
        console.error(
          '[runAgentGeneration] Failed to save failed message:',
          saveError,
        );
      }
    }

    throw new NonRetryableError(
      `Agent generation failed: ${JSON.stringify({
        message: getString(err, 'message'),
        code: getString(err, 'code'),
        status: err['status'],
        cause: err['cause'],
      })}`,
      error,
      'generation_error',
    );
  }
}

const beforeGenerateDebugLog = createDebugLog(
  'DEBUG_CHAT_AGENT',
  '[beforeGenerateHook]',
);

export const beforeGenerateHook = internalAction({
  args: {
    threadId: v.string(),
    promptMessage: v.string(),
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
    contextMessagesTokens: v.number(),
  },
  returns: v.object({
    promptContent: v.optional(v.any()),
    contextExceedsBudget: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const { threadId, promptMessage, contextMessagesTokens } = args;

    const currentPromptTokens = estimateTokens(promptMessage || '');
    const contextBudget =
      DEFAULT_MODEL_CONTEXT_LIMIT * CONTEXT_SAFETY_MARGIN -
      SYSTEM_INSTRUCTIONS_TOKENS -
      currentPromptTokens -
      OUTPUT_RESERVE;

    const contextExceedsBudget = contextMessagesTokens > contextBudget;
    if (contextExceedsBudget) {
      beforeGenerateDebugLog('Context may exceed budget', {
        threadId,
        budget: contextBudget,
        contextTokens: contextMessagesTokens,
      });
    }

    const promptContent = await buildTodosPromptAugmentation(
      ctx,
      threadId,
      promptMessage,
    );

    return { promptContent, contextExceedsBudget };
  },
});

/**
 * Guaranteed-synthesis fallback. Runs after the agent finishes generation.
 * If the agent maintained todos but the final message is missing a
 * [[CONCLUSION]] marker, append a deterministic summary so the user always
 * gets a cited report from completed todos — never silence.
 */
export const afterGenerateHook = internalAction({
  args: {
    threadId: v.string(),
    result: v.object({
      text: v.optional(v.string()),
      usage: v.optional(v.any()),
      durationMs: v.optional(v.number()),
    }),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { threadId, result } = args;
    const finalText = typeof result.text === 'string' ? result.text : '';
    if (finalText.includes('[[CONCLUSION]]')) {
      return null;
    }

    const waitingForHuman = await ctx.runQuery(
      internal.approvals.internal_queries.hasPendingHumanInputForThread,
      { threadId },
    );
    if (waitingForHuman) {
      return null;
    }

    const threadMetadata = await ctx.runQuery(
      internal.threads.internal_queries.getThreadMetadata,
      { threadId },
    );
    const organizationId = threadMetadata?.organizationId;
    if (!organizationId) return null;

    const todosRecord = await ctx.runQuery(
      internal.thread_todos.internal_queries.getByThread,
      { organizationId, threadId },
    );
    if (!todosRecord || todosRecord.todos.length === 0) return null;

    const done = todosRecord.todos.filter((t) => t.status === 'done');
    const failed = todosRecord.todos.filter((t) => t.status === 'failed');
    const inProgress = todosRecord.todos.filter(
      (t) => t.status === 'in_progress',
    );
    const pending = todosRecord.todos.filter((t) => t.status === 'pending');

    const lines: string[] = [];
    lines.push('[[CONCLUSION]]');
    if (done.length === 0) {
      lines.push(
        'The research run ended before I could reach a conclusion. The plan below shows where things stood — send a follow-up to continue or narrow the scope.',
      );
    } else {
      lines.push(
        `Summary of findings from ${done.length}/${todosRecord.todos.length} completed todos. The research run ended before a full synthesis could be written — see the key points and details below for what was gathered.`,
      );
    }
    if (done.length > 0) {
      lines.push('', '[[KEY_POINTS]]');
      for (const todo of done) {
        const findings =
          todo.findingsSummary && todo.findingsSummary.trim().length > 0
            ? todo.findingsSummary.trim()
            : todo.content;
        lines.push(`- ${findings}`);
      }
    }
    if (failed.length > 0 || inProgress.length > 0 || pending.length > 0) {
      lines.push('', '[[DETAILS]]');
      if (failed.length > 0) {
        lines.push('Failed todos:');
        for (const todo of failed) {
          const reason = todo.failureReason ?? 'unknown reason';
          lines.push(`- ${todo.content} (${reason})`);
        }
      }
      if (inProgress.length > 0) {
        lines.push('In progress when the run ended:');
        for (const todo of inProgress) {
          lines.push(`- ${todo.content}`);
        }
      }
      if (pending.length > 0) {
        lines.push('Not yet started:');
        for (const todo of pending) {
          lines.push(`- ${todo.content}`);
        }
      }
    }

    const aggregatedSources = collectUniqueSources(todosRecord.todos);
    if (aggregatedSources.length > 0) {
      lines.push('', 'Sources:');
      for (const src of aggregatedSources) {
        const label =
          src.title && src.title.length > 0 ? src.title : prettifyUrl(src.url);
        lines.push(`- [${label}](${src.url})`);
      }
    }

    lines.push(
      '',
      '_This summary was auto-generated from the research plan state. Ask a follow-up to investigate further._',
    );

    await saveMessage(ctx, components.agent, {
      threadId,
      message: {
        role: 'assistant',
        content: lines.join('\n'),
      },
    });
    return null;
  },
});
