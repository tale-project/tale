/**
 * Build Sub-Agent Prompt
 *
 * Helper function to build structured prompts for sub-agents
 * with consistent context management.
 */

import {
  ContextBuilder,
  ContextPriority,
  type AgentType,
} from '../../../lib/context_management';

/**
 * Context options for building a sub-agent prompt.
 */
export interface SubAgentPromptOptions {
  /** The user's request in natural language */
  userRequest: string;
  /** Agent type for context configuration */
  agentType: AgentType;
  /** Thread ID (sub-thread) */
  threadId: string;
  /** Organization ID */
  organizationId: string;
  /** Optional user ID */
  userId?: string;
  /** Optional parent thread ID */
  parentThreadId?: string;
  /** Optional additional context sections */
  additionalContext?: Record<string, string>;
  /** Optional existing conversation summary */
  existingSummary?: string;
}

/**
 * Result from building a sub-agent prompt.
 */
export interface SubAgentPromptResult {
  /** The built prompt string */
  prompt: string;
  /** System messages for context injection */
  systemMessages: Array<{ role: 'system'; content: string }>;
  /** Estimated token count */
  estimatedTokens: number;
}

/**
 * Build a structured prompt for a sub-agent with consistent formatting.
 *
 * This function creates a well-structured prompt that includes:
 * - User request (high priority)
 * - Current date/time context
 * - Organization and thread context
 * - Any additional context sections
 *
 * @example
 * ```typescript
 * const result = buildSubAgentPrompt({
 *   userRequest: 'Search for React 19 features',
 *   agentType: 'web',
 *   threadId: subThreadId,
 *   organizationId,
 *   additionalContext: {
 *     search_query: 'React 19 new features 2024',
 *     target_url: 'https://react.dev',
 *   },
 * });
 *
 * await webAgent.generateText(ctx, { threadId }, {
 *   prompt: result.prompt,
 *   messages: result.systemMessages,
 * });
 * ```
 */
export function buildSubAgentPrompt(options: SubAgentPromptOptions): SubAgentPromptResult {
  const {
    userRequest,
    agentType,
    threadId,
    organizationId,
    userId,
    parentThreadId,
    additionalContext,
    existingSummary,
  } = options;

  // Build the prompt string
  const promptParts: string[] = [];

  // User request (always first)
  promptParts.push(`## User Request:\n${userRequest}`);

  // Additional context sections
  if (additionalContext) {
    for (const [key, value] of Object.entries(additionalContext)) {
      if (value) {
        const title = key
          .split('_')
          .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' ');
        promptParts.push(`## ${title}: ${value}`);
      }
    }
  }

  // Current date/time context
  const { date, time } = formatCurrentDateTime();

  const contextLines: string[] = [
    `- **Current Date**: ${date}`,
    `- **Current Time**: ${time}`,
    `- Organization ID: ${organizationId}`,
  ];

  if (parentThreadId) {
    contextLines.push(`- Parent Thread ID: ${parentThreadId}`);
  }
  if (userId) {
    contextLines.push(`- User ID: ${userId}`);
  }

  promptParts.push(`## Context:\n${contextLines.join('\n')}`);

  const prompt = promptParts.join('\n\n');

  // Build system messages using the context builder
  const builder = new ContextBuilder({ agentType });

  // Add system info (static) and current time (dynamic, placed last for cache optimization)
  builder.addSystemInfo(threadId).addCurrentTime();

  // Add existing summary if available
  if (existingSummary) {
    builder.addSummary(existingSummary);
  }

  // Add task context (the user request)
  builder.addContext(
    'current_task',
    userRequest,
    ContextPriority.HIGH_RELEVANCE,
    { sectionName: 'current_task' },
  );

  // Add additional context items
  if (additionalContext) {
    for (const [key, value] of Object.entries(additionalContext)) {
      if (value) {
        builder.addContext(
          key,
          value,
          ContextPriority.MEDIUM_RELEVANCE,
          { sectionName: key },
        );
      }
    }
  }

  const buildResult = builder.build();

  return {
    prompt,
    systemMessages: buildResult.systemMessages,
    estimatedTokens: buildResult.totalTokens,
  };
}

/**
 * Format current date and time for prompt context.
 */
export function formatCurrentDateTime(): { date: string; time: string } {
  const now = new Date();
  return {
    date: now.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }),
    time: now.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
    }),
  };
}
