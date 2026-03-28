/**
 * Convert a JSON-file-based agent config to SerializableAgentConfig.
 *
 * This is the thin mapping layer between the agent JSON file format
 * and the existing agent pipeline.
 *
 * Model preset resolution:
 * - 'fast' → OPENAI_FAST_MODEL
 * - 'standard' → OPENAI_MODEL (default)
 * - 'advanced' → OPENAI_CODING_MODEL
 */

import type { ToolName } from '../agent_tools/tool_names';
import type { SerializableAgentConfig } from '../lib/agent_chat/types';
import type { AgentJsonConfig } from './file_utils';
import type { KnowledgeFile } from './schema';

import {
  getCodingModelOrThrow,
  getDefaultModel,
  getFastModel,
} from '../lib/agent_runtime_config';

function resolveModel(config: AgentJsonConfig): string {
  if (config.modelId) return config.modelId;

  switch (config.modelPreset) {
    case 'fast':
      return getFastModel();
    case 'advanced':
      return getCodingModelOrThrow();
    default:
      return getDefaultModel();
  }
}

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
    model: resolveModel(config),
    maxSteps: config.maxSteps,
    enableVectorSearch: false,
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
