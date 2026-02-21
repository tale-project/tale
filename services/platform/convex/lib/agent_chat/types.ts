/**
 * Type definitions for Agent Chat configuration.
 *
 * These types support fully parameterized agent configuration,
 * enabling lib/ to be completely decoupled from agents/.
 */

import type { ToolName } from '../../agent_tools/tool_registry';
import type { AgentType } from '../context_management/constants';

/**
 * Serializable Agent configuration for creating agents.
 * All fields are JSON-serializable and can be passed through scheduler.
 */
export interface SerializableAgentConfig {
  /** Agent name identifier */
  name: string;
  /** System instructions for the agent */
  instructions: string;
  /** List of Convex tool names to enable */
  convexToolNames?: ToolName[];
  /** Integration names bound as dedicated tools (resolved at runtime) */
  integrationBindings?: string[];
  /** Use fast model (OPENAI_FAST_MODEL) instead of default */
  useFastModel?: boolean;
  /** Explicit model override (takes precedence over useFastModel) */
  model?: string;
  /** Maximum number of steps for tool calls */
  maxSteps?: number;
  /** Output format (text or json) */
  outputFormat?: 'text' | 'json';
  /** Enable vector search for semantic message retrieval */
  enableVectorSearch?: boolean;
  /** Knowledge retrieval mode: tool (agent calls rag_search), context (auto-inject), both, or off */
  knowledgeMode?: 'off' | 'tool' | 'context' | 'both';
  /** Web search retrieval mode: tool (agent calls web), context (auto-inject), both, or off */
  webSearchMode?: 'off' | 'tool' | 'context' | 'both';
  /** Root version IDs of delegate agents */
  delegateAgentIds?: string[];
  /** Whether to inject structured response markers into the system prompt (default true) */
  structuredResponsesEnabled?: boolean;
  /** Per-agent timeout in milliseconds */
  timeoutMs?: number;
  /** Per-agent output token reserve */
  outputReserve?: number;
}

/**
 * Hook configuration using FunctionHandle strings.
 * FunctionHandle is serializable and can be passed through scheduler.
 */
export interface AgentHooksConfig {
  /** FunctionHandle for beforeContext hook (mutation) */
  beforeContext?: string;
  /** FunctionHandle for beforeGenerate hook (mutation) */
  beforeGenerate?: string;
  /** FunctionHandle for afterGenerate hook (mutation) */
  afterGenerate?: string;
}

/**
 * Complete runtime configuration for starting an agent chat.
 * All fields are serializable and can be passed through scheduler.
 */
export interface AgentRuntimeConfig {
  /** Agent type identifier */
  agentType: AgentType;
  /** Serializable agent configuration */
  agentConfig: SerializableAgentConfig;
  /** Model to use for response generation */
  model: string;
  /** Model provider (e.g., 'openai', 'anthropic') */
  provider: string;
  /** Debug tag for logging */
  debugTag: string;
  /** Enable streaming response */
  enableStreaming: boolean;
  /** Optional hooks configuration (FunctionHandles) */
  hooks?: AgentHooksConfig;
}

/**
 * Arguments for runAgentGeneration action.
 * These are the serialized arguments passed through scheduler.
 */
export interface RunAgentGenerationArgs {
  agentType: string;
  agentConfig: SerializableAgentConfig;
  model: string;
  provider: string;
  debugTag: string;
  enableStreaming?: boolean;
  hooks?: AgentHooksConfig;
  threadId: string;
  organizationId: string;
  userId?: string;
  promptMessage: string;
  additionalContext?: Record<string, string>;
  parentThreadId?: string;
  agentOptions?: unknown;
  attachments?: Array<{
    fileId: string;
    fileName: string;
    fileType: string;
    fileSize: number;
  }>;
  streamId?: string;
  promptMessageId?: string;
  maxSteps?: number;
  userTeamIds?: string[];
}

/**
 * Result from beforeContext hook.
 */
export interface BeforeContextHookResult {
  contextSummary?: string;
  ragPrefetchCache?: unknown;
  [key: string]: unknown;
}

/**
 * Result from beforeGenerate hook.
 */
export interface BeforeGenerateHookResult {
  promptContent?: unknown;
  systemContextMessages?: unknown[];
  additionalContextData?: Record<string, unknown>;
}
