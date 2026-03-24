/**
 * Convert a DB custom agent record to SerializableAgentConfig.
 *
 * This is the thin mapping layer between the database model
 * and the existing agent pipeline.
 *
 * Model preset resolution:
 * - 'fast' → OPENAI_FAST_MODEL
 * - 'standard' → OPENAI_MODEL (default)
 * - 'advanced' → OPENAI_CODING_MODEL
 */

import type { Doc } from '../_generated/dataModel';
import type { ToolName } from '../agent_tools/tool_names';
import type { SerializableAgentConfig } from '../lib/agent_chat/types';

import {
  getCodingModelOrThrow,
  getDefaultModel,
  getFastModel,
} from '../lib/agent_runtime_config';

function resolveModel(agent: Doc<'customAgents'>): string {
  if (agent.modelId) return agent.modelId;

  switch (agent.modelPreset) {
    case 'fast':
      return getFastModel();
    case 'advanced':
      return getCodingModelOrThrow();
    default:
      return getDefaultModel();
  }
}

export function toSerializableConfig(
  agent: Doc<'customAgents'>,
): SerializableAgentConfig {
  const knowledgeMode =
    agent.knowledgeMode ?? (agent.knowledgeEnabled ? 'tool' : 'off');
  const webSearchMode =
    agent.webSearchMode ?? (agent.toolNames.includes('web') ? 'tool' : 'off');

  return {
    name: `${agent.name}:v${agent.versionNumber}`,
    instructions: agent.systemInstructions,
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- toolNames are filtered via filterValidToolNames() on insert; always valid ToolName values
    convexToolNames: agent.toolNames as ToolName[],
    integrationBindings: agent.integrationBindings,
    workflowBindings: agent.workflowBindings?.map(String),
    model: resolveModel(agent),
    maxSteps: agent.maxSteps,
    enableVectorSearch: false,
    knowledgeMode,
    webSearchMode,
    includeTeamKnowledge: agent.includeTeamKnowledge ?? true,
    includeOrgKnowledge: agent.includeOrgKnowledge ?? false,
    agentTeamId: agent.teamId,
    knowledgeFileIds: (agent.knowledgeFiles ?? [])
      .filter((f) => f.ragStatus === 'completed')
      .map((f) => String(f.fileId)),
    delegateAgentIds: (agent.delegateAgentIds ?? agent.partnerAgentIds)?.map(
      String,
    ),
    structuredResponsesEnabled: agent.structuredResponsesEnabled ?? true,
    timeoutMs: agent.timeoutMs,
    outputReserve: agent.outputReserve,
  };
}
