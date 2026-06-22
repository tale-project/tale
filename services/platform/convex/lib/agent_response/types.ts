/**
 * Type definitions for the generic agent response generator.
 */

import type { SharedV3ProviderOptions } from '@ai-sdk/provider';
import type { Agent } from '@convex-dev/agent';
import type { ModelMessage } from 'ai';

import type {
  ResponseReasoningSeed,
  ResponseStyleAdvice,
} from '../../../lib/shared/response-tuning';
import type { ActionCtx } from '../../_generated/server';
import type { AutoRouteReason } from '../../streaming/validators';
import type { FileAttachment } from '../attachments';
import type { AgentType } from '../context_management';
import type { StructuredContextResult } from '../context_management';
import type { ReasoningCapabilityConfig } from './reasoning/capability';

/**
 * Configuration for creating a generic agent response generator.
 */
export interface GenerateResponseConfig {
  agentType: AgentType;
  createAgent: (options?: Record<string, unknown>) => Agent;
  model: string;
  provider?: string;
  debugTag: string;
  enableStreaming?: boolean;
  hooks?: GenerateResponseHooks;
  /** Tool names configured for this agent - used to determine if RAG prefetch should be enabled */
  convexToolNames?: string[];
  /** Knowledge retrieval mode */
  knowledgeMode?: 'off' | 'tool' | 'context' | 'both';
  /** Web search retrieval mode */
  webSearchMode?: 'off' | 'tool' | 'context' | 'both';
  /** Whether to include team documents in knowledge scope (default true) */
  includeTeamKnowledge?: boolean;
  /** Whether to include org-wide documents in knowledge scope (default false) */
  includeOrgKnowledge?: boolean;
  /** Team ID the agent is assigned to (primary/legacy) */
  agentTeamId?: string;
  /** All team IDs the agent is scoped to (union of teamId + sharedWithTeamIds) */
  agentTeamIds?: string[];
  /** Pre-resolved completed file IDs from agent-specific knowledge files */
  knowledgeFileIds?: string[];
  /**
   * Projects feature: project IDs whose RAG-indexed files should be
   * unioned into the agent's file scope when the chat is in a project.
   */
  agentProjectIds?: string[];
  /** Whether to inject structured response markers into the system prompt (default false) */
  structuredResponsesEnabled?: boolean;
  /** Agent instructions for context window display (not sent to LLM, already in agent config) */
  instructions?: string;
  /** Formatted tool definitions for context window display (not sent to LLM) */
  toolsSummary?: string;
  /** Governance-enforced max context tokens (overrides agent config maxHistoryTokens) */
  maxContextTokens?: number;
  /** Per-agent personalization injection mode: 'on' (default) or 'off' */
  personalizationMode?: 'on' | 'off';
  /**
   * Pre-namespaced provider options from `buildCallProviderOptions(modelData)`.
   * Spread per-call into streamText / generateText / generateObject — NOT
   * into the Agent constructor (`Agent({providerOptions})` is `@deprecated`
   * in `@convex-dev/agent` and slated for removal). When undefined, the call
   * sites omit the field.
   */
  providerOptions?: SharedV3ProviderOptions;
  /**
   * Per-model output cap (`modelData.maxOutputTokens`). Bounds the Adaptive
   * Reasoning Governor's thinking budget so it leaves room for the answer.
   */
  modelMaxOutputTokens?: number;
  /**
   * Per-model context window (`modelData.contextWindow`) — drives the
   * model-aware history budget and the auto-compaction trigger. Falls back to a
   * sensible default when the model declares none (unknown family).
   */
  modelContextWindow?: number;
  /**
   * Operator-declared reasoning capability (`modelData.reasoning`) for the
   * Adaptive Reasoning Governor. Optional — when absent the governor falls back
   * to family-based inference of the reasoning knob (see
   * `reasoning/capability.ts`).
   */
  reasoningCapability?: ReasoningCapabilityConfig;
  /**
   * Prose-level response shaping (style/verbosity) the Auto router advised for
   * this turn, rendered into the style/verbosity prompt fragment. Set ONLY in
   * Auto mode; absent for pinned agents (tone comes from their instructions).
   */
  responseStyle?: ResponseStyleAdvice;
  /**
   * Coarse reasoning seed (effort/creativity) the Auto router advised for this
   * turn. Fed to `buildReasoningOptions` as a PRIOR (blended into the difficulty
   * score), never a hard override — the online controller still refines from
   * observed usage. Set ONLY in Auto mode; absent = fully-heuristic prior.
   */
  routeSeed?: ResponseReasoningSeed;
  /**
   * Advisory reply-language hint from the Auto router (BCP-47 code or language
   * name). Inserted into the response-language directive's fallback chain just
   * above the org default — the directive's explicit-request and
   * message-language rules still take precedence. Optional.
   */
  replyLocaleHint?: string;
}

/**
 * Hooks for customizing the response generation pipeline.
 * These allow chat agent to inject its specific logic while using the common framework.
 */
export interface GenerateResponseHooks {
  /**
   * Called before building context. Can load additional data in parallel.
   * Returns data that will be passed to other hooks.
   */
  beforeContext?: (
    ctx: ActionCtx,
    args: GenerateResponseArgs,
  ) => Promise<BeforeContextResult>;

  /**
   * Called after context is built but before generation.
   * Can modify context or perform additional setup.
   */
  beforeGenerate?: (
    ctx: ActionCtx,
    args: GenerateResponseArgs,
    context: StructuredContextResult,
    hookData: BeforeContextResult | undefined,
  ) => Promise<BeforeGenerateResult>;

  /**
   * Called after generation completes.
   * Can perform cleanup or additional processing.
   */
  afterGenerate?: (
    ctx: ActionCtx,
    args: GenerateResponseArgs,
    result: GenerateResponseResult,
    hookData: BeforeContextResult | undefined,
  ) => Promise<void>;
}

/**
 * Result from beforeContext hook.
 */
export interface BeforeContextResult {
  contextSummary?: string;
  ragContext?: string;
  [key: string]: unknown;
}

/**
 * Result from beforeGenerate hook.
 */
export interface BeforeGenerateResult {
  /** Prompt content - can be string (simple) or ModelMessage[] (with attachments) */
  promptContent?: string | ModelMessage[];
  systemContextMessages?: ModelMessage[];
  additionalContextData?: Record<string, unknown>;
}

/**
 * Arguments for generating an agent response.
 */
export interface GenerateResponseArgs {
  ctx: ActionCtx;
  threadId: string;
  userId?: string;
  organizationId: string;
  /** The user's message to send as prompt */
  promptMessage: string;
  additionalContext?: Record<string, string>;
  /** User environment context (timezone, language, location) for template variables */
  userContext?: {
    timezone: string;
    language: string;
    /** App UI locale (i18n), preferred over the browser locale for the
     * response-language fallback when the user's input language is unclear. */
    uiLanguage?: string;
    coordinates?: string;
    location?: string;
  };
  agentSlug?: string;
  /** Set ONLY when this turn came from Auto routing; absent for a pinned agent. */
  autoRouteReason?: AutoRouteReason;
  teamIds?: string[];
  providerCost?: {
    inputCentsPerMillion: number;
    outputCentsPerMillion: number;
  };
  parentThreadId?: string;
  agentOptions?: Record<string, unknown>;
  attachments?: FileAttachment[];
  /**
   * Pre-built multimodal prompt with inline image parts. When set, used as
   * the in-flight prompt to the LLM in place of `promptMessage`. The
   * `beforeGenerate` hook can still override it via `promptContent`.
   */
  multiModalPrompt?: ModelMessage[];
  streamId?: string;
  promptMessageId?: string;
  maxSteps?: number;
  /** Absolute deadline (Date.now()-based) by which this generation must complete */
  deadlineMs?: number;
  /**
   * Timestamp (Date.now()-based) stamped at `chatWithAgent` entry — the
   * earliest server-side point of the turn. Threaded through the action chain
   * so `timeFromSendMs` can measure the full pre-stream overhead, not just the
   * portion inside this action. Optional: in-flight jobs scheduled before this
   * field existed (and other callers) omit it; consumers fall back to the
   * local `startTime`.
   */
  requestStartMs?: number;
  /** Optional per-request generation parameters from OpenAI compat endpoint */
  generationParams?: {
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    frequencyPenalty?: number;
    presencePenalty?: number;
    stopSequences?: string[];
  };
  /** Governance-resolved max context tokens (overrides agent default) */
  maxContextTokens?: number;
  /**
   * Storage IDs of knowledge-base documents the user explicitly
   * `@`-mentioned on this turn (resolved + access-validated upstream by
   * `chatWithAgentTurn`). When non-empty, knowledge-context injection is
   * forced on (explicit user intent overrides the agent's `knowledgeMode`)
   * and the RAG query is scoped to exactly these files instead of the
   * agent's configured scope, with a relaxed similarity threshold.
   */
  pinnedFileIds?: string[];
  /**
   * When true, the error path skips saving a failed message, marking the
   * stream as error, and clearing the generation status. Used by the
   * fallback retry loop so the caller can handle cleanup itself without
   * causing UI flicker (loading disappearing, error message flashing).
   */
  suppressErrorCleanup?: boolean;
  /**
   * Cache pre-warm mode. When true, the pipeline builds the EXACT same tools +
   * stable system prefix a real first turn would, then issues one throwaway
   * 1-token generation (no persistence, no RAG/web, no streaming, no outcome
   * recording) purely to prime the provider's prompt cache so the user's first
   * real message is served warm. Returns immediately after the priming call.
   */
  prewarm?: boolean;
}

/**
 * Result of generating an agent response.
 */
export interface GenerateResponseResult {
  threadId: string;
  text: string;
  savedMessageId?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    reasoningTokens?: number;
    cachedInputTokens?: number;
  };
  finishReason?: string;
  durationMs: number;
  timeToFirstTokenMs?: number;
  /** Action-relative time to the first reasoning ("thinking") delta. */
  timeToFirstReasoningMs?: number;
  /**
   * Send-relative time to the first user-visible token (reasoning if present,
   * else content) — measured from `requestStartMs` when available, else from
   * the local `startTime`. This is the number that reflects the real wait.
   */
  timeFromSendMs?: number;
  /** Pre-answer wall-clock the user waited, INCLUDING Auto-routing latency
   *  (markGenerating → first answer token). See streaming/schema.ts. */
  thinkingDurationMs?: number;
  toolCalls?: Array<{ toolName: string; status: string }>;
  toolsUsage?: Array<{
    toolName: string;
    model?: string;
    provider?: string;
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    durationMs?: number;
    input?: string;
    output?: string;
  }>;
  citations?: Array<{
    index: number;
    type: 'rag' | 'web';
    source: string;
    fileId?: string;
    url?: string;
    page?: number;
    relevance?: number;
  }>;
  contextWindow?: string;
  contextStats?: {
    totalTokens: number;
    messageCount: number;
    approvalCount: number;
    hasRag: boolean;
    hasWebContext: boolean;
  };
  model?: string;
  provider?: string;
  reasoning?: string;
}
