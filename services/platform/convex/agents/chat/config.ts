/**
 * Chat Agent Configuration
 *
 * Exports the serializable configuration for the chat (routing) agent.
 * This configuration is passed to lib/agent_chat for unified handling.
 */

import { createFunctionHandle, makeFunctionReference } from 'convex/server';
import type { MutationCtx } from '../../_generated/server';
import type { SerializableAgentConfig, AgentHooksConfig } from '../../lib/agent_chat/types';
import type { ToolName } from '../../agent_tools/tool_registry';
import { getDefaultAgentRuntimeConfig } from '../../lib/agent_runtime_config';
import { CHAT_AGENT_INSTRUCTIONS } from './agent';

export const CHAT_AGENT_TOOL_NAMES: ToolName[] = [
  'rag_search',
  'web_assistant',
  'document_assistant',
  'integration_assistant',
  'workflow_assistant',
  'crm_assistant',
];

export const CHAT_AGENT_CONFIG: SerializableAgentConfig = {
  name: 'routing-agent',
  instructions: CHAT_AGENT_INSTRUCTIONS,
  convexToolNames: CHAT_AGENT_TOOL_NAMES,
  maxSteps: 20,
};

/**
 * Get the runtime configuration for the chat agent.
 * Model is read from environment variable at runtime.
 */
export function getChatAgentRuntimeConfig() {
  const { model, provider } = getDefaultAgentRuntimeConfig();
  return {
    agentType: 'chat' as const,
    agentConfig: CHAT_AGENT_CONFIG,
    model,
    provider,
    debugTag: '[RoutingAgent]',
    enableStreaming: true,
  };
}

// Function references for hooks - using makeFunctionReference for type-safe path construction
const beforeContextHookRef = makeFunctionReference<'action'>('agents/chat/hooks:beforeContextHook');
const beforeGenerateHookRef = makeFunctionReference<'action'>('agents/chat/hooks:beforeGenerateHook');
const onErrorHookRef = makeFunctionReference<'action'>('agents/chat/hooks:onErrorHook');

/**
 * Create FunctionHandles for chat agent hooks.
 * Must be called from a mutation context.
 */
export async function createChatHookHandles(ctx: MutationCtx): Promise<AgentHooksConfig> {
  const [beforeContext, beforeGenerate, onError] = await Promise.all([
    createFunctionHandle(beforeContextHookRef),
    createFunctionHandle(beforeGenerateHookRef),
    createFunctionHandle(onErrorHookRef),
  ]);

  return {
    beforeContext,
    beforeGenerate,
    onError,
  };
}
