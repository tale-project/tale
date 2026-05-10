/**
 * Type definitions for the generic agent response generator.
 */

import type { SharedV3ProviderOptions } from '@ai-sdk/provider';
import type { Agent } from '@convex-dev/agent';
import type { ModelMessage } from 'ai';

import type { ActionCtx } from '../../_generated/server';
import type { FileAttachment } from '../attachments';
import type { AgentType } from '../context_management';
import type { StructuredContextResult } from '../context_management';

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
    coordinates?: string;
    location?: string;
  };
  agentSlug?: string;
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
   * When true, the error path skips saving a failed message, marking the
   * stream as error, and clearing the generation status. Used by the
   * fallback retry loop so the caller can handle cleanup itself without
   * causing UI flicker (loading disappearing, error message flashing).
   */
  suppressErrorCleanup?: boolean;
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
