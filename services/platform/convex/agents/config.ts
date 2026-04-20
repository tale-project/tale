/**
 * Convert a JSON-file-based agent config to SerializableAgentConfig.
 *
 * This is the thin mapping layer between the agent JSON file format
 * and the existing agent pipeline.
 */

import { stripModelRefQualifier } from '../../lib/shared/utils/model-ref';
import type { ToolName } from '../agent_tools/tool_names';
import type { SerializableAgentConfig } from '../lib/agent_chat/types';
import { getAgentTeamIds } from './access';
import type { AgentJsonConfig } from './file_utils';
import type { KnowledgeFile } from './schema';

export function toSerializableConfig(
  agentName: string,
  config: AgentJsonConfig,
  binding?: {
    teamId?: string;
    sharedWithTeamIds?: string[];
    knowledgeFiles?: KnowledgeFile[];
  },
): SerializableAgentConfig {
  const knowledgeMode = config.knowledgeMode ?? 'off';
  const webSearchMode =
    config.webSearchMode ??
    (config.toolNames?.includes('web') ? 'tool' : 'off');
  const allTeamIds = getAgentTeamIds(binding ?? null);

  return {
    name: agentName,
    primaryBehavior: config.primaryBehavior,
    instructions: config.systemInstructions ?? '',
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
    agentTeamIds: allTeamIds.length > 0 ? allTeamIds : undefined,
    knowledgeFileIds: (binding?.knowledgeFiles ?? [])
      .filter((f) => f.ragStatus === 'completed')
      .map((f) => String(f.fileId)),
    delegateSlugs: config.delegates,
    structuredResponsesEnabled: config.structuredResponsesEnabled ?? true,
    timeoutMs: config.timeoutMs,
    outputReserve: config.outputReserve,
    responseCacheEnabled: config.responseCacheEnabled,
    responseCacheTtlMs: config.responseCacheTtlMs,
    noCacheToolNames: config.noCacheToolNames,
    fallbackModels:
      config.supportedModels.length > 1
        ? config.supportedModels.slice(1)
        : undefined,
  };
}

/**
 * Apply a model override to a config if the model is in the agent's
 * supportedModels list. When forcing a specific model (e.g. arena mode or
 * governance default), fallback is disabled so the exact model is used.
 *
 * Returns true if the override was applied.
 */
export function applyModelOverride(
  config: SerializableAgentConfig,
  modelId: string,
  supportedModels: string[],
): boolean {
  const target = stripModelRefQualifier(modelId);
  const matched = supportedModels.some(
    (ref) => stripModelRefQualifier(ref) === target,
  );
  if (matched) {
    config.model = modelId;
    config.fallbackModels = undefined;
    return true;
  }
  return false;
}
