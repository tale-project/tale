/**
 * Constants for Context Management
 *
 * Shared constants used by both main chat agent and sub-agents.
 */

/**
 * Base token count for system instructions.
 * This should be updated if instructions change significantly.
 * After P1 optimization (moving detailed guidance to tool descriptions):
 * ~2,800 chars = ~700 tokens (reduced from ~17,500 chars / ~4,400 tokens)
 */
export const SYSTEM_INSTRUCTIONS_TOKENS = 800;

/**
 * Safety margin for context limit (75% of max).
 * Leaves room for output tokens and tool call overhead.
 */
export const CONTEXT_SAFETY_MARGIN = 0.75;

/**
 * Default model context limit in tokens.
 * Most modern models support 128K+, but we use a conservative default.
 */
export const DEFAULT_MODEL_CONTEXT_LIMIT = 128000;

/**
 * Number of recent messages to load by default.
 * This balances context quality with token efficiency.
 */
export const DEFAULT_RECENT_MESSAGES = 20;

/**
 * Reserve tokens for model output generation.
 * This ensures the model has room to generate a complete response.
 */
export const OUTPUT_RESERVE = 4096;

/**
 * Estimate for recent conversation history tokens.
 * Used for budget calculations when loading context.
 */
export const RECENT_MESSAGES_TOKEN_ESTIMATE = 10000;

/**
 * Threshold for considering a message as "large" (in tokens).
 * Large messages may be skipped when budget is tight.
 */
export const LARGE_MESSAGE_THRESHOLD = 2000;

/**
 * Threshold for triggering summarization.
 * When context usage exceeds this ratio, async summarization is triggered.
 */
export const SUMMARIZATION_THRESHOLD = 0.65;

/**
 * Agent-specific context configurations
 *
 * All agents are treated as equal and independent - they can be used as
 * standalone entry points or as sub-agents delegated by the chat agent.
 * Each agent has full context management capabilities including:
 * - Complete message history loading
 * - XML-structured context formatting
 * - Summarization support for long conversations
 */
export const AGENT_CONTEXT_CONFIGS = {
  /** Main chat agent - full context management */
  chat: {
    modelContextLimit: DEFAULT_MODEL_CONTEXT_LIMIT,
    recentMessages: DEFAULT_RECENT_MESSAGES,
    outputReserve: OUTPUT_RESERVE,
    enableSummarization: true,
  },
  /** Web assistant - independent agent for web operations */
  web: {
    modelContextLimit: DEFAULT_MODEL_CONTEXT_LIMIT,
    recentMessages: DEFAULT_RECENT_MESSAGES,
    outputReserve: 2048,
    enableSummarization: true,
  },
  /** Document assistant - independent agent for document operations */
  document: {
    modelContextLimit: DEFAULT_MODEL_CONTEXT_LIMIT,
    recentMessages: DEFAULT_RECENT_MESSAGES,
    outputReserve: 4096,
    enableSummarization: true,
  },
  /** Integration assistant - independent agent for external system operations */
  integration: {
    modelContextLimit: DEFAULT_MODEL_CONTEXT_LIMIT,
    recentMessages: DEFAULT_RECENT_MESSAGES,
    outputReserve: 2048,
    enableSummarization: true,
  },
  /** Workflow assistant - independent agent for workflow operations */
  workflow: {
    modelContextLimit: DEFAULT_MODEL_CONTEXT_LIMIT,
    recentMessages: DEFAULT_RECENT_MESSAGES,
    outputReserve: 2048,
    enableSummarization: true,
  },
  /** CRM assistant - independent agent for CRM operations */
  crm: {
    modelContextLimit: DEFAULT_MODEL_CONTEXT_LIMIT,
    recentMessages: DEFAULT_RECENT_MESSAGES,
    outputReserve: 2048,
    enableSummarization: true,
  },
} as const;

export type AgentType = keyof typeof AGENT_CONTEXT_CONFIGS;
