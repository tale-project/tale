/**
 * Agent Chat Module
 *
 * Provides unified chat functionality for all agents:
 * - startAgentChat: Generic mutation helper for starting chats
 * - runAgentGeneration: Generic action for agent response generation
 * - Type definitions for configuration
 */

export { startAgentChat } from './start_agent_chat';
export type { StartAgentChatArgs, StartAgentChatResult } from './start_agent_chat';
export type {
  SerializableAgentConfig,
  AgentHooksConfig,
  AgentRuntimeConfig,
  RunAgentGenerationArgs,
  BeforeContextHookResult,
  BeforeGenerateHookResult,
} from './types';
