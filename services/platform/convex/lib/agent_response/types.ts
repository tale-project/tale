/**
 * Type definitions for the generic agent response generator.
 */

import type { ActionCtx } from '../../_generated/server';
import type { Agent } from '@convex-dev/agent';
import type { ModelMessage } from 'ai';
import type { AgentType } from '../context_management';
import type { StructuredContextResult } from '../context_management';
import type { FileAttachment, MessageContentPart } from '../attachments';

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

  /**
   * Called on error.
   * Can perform error-specific cleanup.
   */
  onError?: (
    ctx: ActionCtx,
    args: GenerateResponseArgs,
    error: unknown,
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
  promptContent?: ModelMessage[];
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
  taskDescription: string;
  additionalContext?: Record<string, string>;
  parentThreadId?: string;
  agentOptions?: Record<string, unknown>;
  attachments?: FileAttachment[];
  streamId?: string;
  promptMessageId?: string;
  maxSteps?: number;
  userTeamIds?: string[];
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
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  }>;
  contextWindow?: string;
  contextStats?: {
    totalTokens: number;
    messageCount: number;
    approvalCount: number;
    hasSummary: boolean;
    hasRag: boolean;
    hasIntegrations: boolean;
  };
  model?: string;
  provider?: string;
  reasoning?: string;
}
