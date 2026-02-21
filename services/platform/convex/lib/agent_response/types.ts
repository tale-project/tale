/**
 * Type definitions for the generic agent response generator.
 */

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
  provider: string;
  debugTag: string;
  enableStreaming?: boolean;
  hooks?: GenerateResponseHooks;
  /** Tool names configured for this agent - used to determine if RAG prefetch should be enabled */
  convexToolNames?: string[];
  /** Knowledge retrieval mode */
  knowledgeMode?: 'off' | 'tool' | 'context' | 'both';
  /** Web search retrieval mode */
  webSearchMode?: 'off' | 'tool' | 'context' | 'both';
  /** Agent instructions for context window display (not sent to LLM, already in agent config) */
  instructions?: string;
  /** Formatted tool definitions for context window display (not sent to LLM) */
  toolsSummary?: string;
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
  integrationsInfo?: string;
  ragPrefetchCache?: unknown;
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
  parentThreadId?: string;
  agentOptions?: Record<string, unknown>;
  attachments?: FileAttachment[];
  streamId?: string;
  promptMessageId?: string;
  maxSteps?: number;
  userTeamIds?: string[];
  /** Absolute deadline (Date.now()-based) by which this generation must complete */
  deadlineMs?: number;
}

/**
 * Result of generating an agent response.
 */
export interface GenerateResponseResult {
  threadId: string;
  text: string;
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
  subAgentUsage?: Array<{
    toolName: string;
    model?: string;
    provider?: string;
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    durationMs?: number;
  }>;
  contextWindow?: string;
  contextStats?: {
    totalTokens: number;
    messageCount: number;
    approvalCount: number;
    hasRag: boolean;
    hasWebContext: boolean;
    hasIntegrations: boolean;
  };
  model?: string;
  provider?: string;
  reasoning?: string;
}
