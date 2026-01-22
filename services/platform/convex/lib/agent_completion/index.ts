/**
 * Agent Completion Module
 *
 * Provides unified completion handling for all agents (routing agent and specialized agents).
 * All agents are treated equally and have the same completion behavior:
 * 1. Save message metadata (model, usage, context stats, etc.)
 * 2. Trigger background summarization for long conversations
 *
 * Usage:
 * ```typescript
 * import { onAgentComplete } from '../lib/agent_completion';
 *
 * const result = await agent.generateText(ctx, { threadId, userId }, { messages });
 *
 * await onAgentComplete(ctx, {
 *   threadId,
 *   agentType: 'workflow',
 *   result: {
 *     text: result.text,
 *     usage: result.usage,
 *     // ... other fields
 *   },
 * });
 * ```
 */

export {
  onAgentComplete,
  type OnAgentCompleteArgs,
  type AgentResponseResult,
} from './on_agent_complete';
