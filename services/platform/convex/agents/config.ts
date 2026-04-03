/**
 * Convert a JSON-file-based agent config to SerializableAgentConfig.
 *
 * This is the thin mapping layer between the agent JSON file format
 * and the existing agent pipeline.
 */

import type { ToolName } from '../agent_tools/tool_names';
import type { SerializableAgentConfig } from '../lib/agent_chat/types';
import type { AgentJsonConfig } from './file_utils';
import type { KnowledgeFile } from './schema';

export function toSerializableConfig(
  agentName: string,
  config: AgentJsonConfig,
  binding?: { teamId?: string; knowledgeFiles?: KnowledgeFile[] },
): SerializableAgentConfig {
  const knowledgeMode = config.knowledgeMode ?? 'off';
  const webSearchMode =
    config.webSearchMode ??
    (config.toolNames?.includes('web') ? 'tool' : 'off');

  return {
    name: agentName,
    instructions: config.systemInstructions,
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- toolNames are validated on file read; always valid ToolName values
    convexToolNames: config.toolNames as ToolName[],
    integrationBindings: config.integrationBindings,
    workflowBindings: config.workflows,
    model:
      config.supportedModels[0] ??
      (() => {
        throw new Error('supportedModels must not be empty');
      })(),
    provider: config.provider,
    maxSteps: config.maxSteps,
    knowledgeMode,
    webSearchMode,
    includeTeamKnowledge: config.includeTeamKnowledge ?? true,
    includeOrgKnowledge: config.includeOrgKnowledge ?? false,
    agentTeamId: binding?.teamId,
    knowledgeFileIds: (binding?.knowledgeFiles ?? [])
      .filter((f) => f.ragStatus === 'completed')
      .map((f) => String(f.fileId)),
    delegateAgentIds: config.delegates,
    structuredResponsesEnabled: config.structuredResponsesEnabled ?? true,
    timeoutMs: config.timeoutMs,
    outputReserve: config.outputReserve,
  };
}
