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

import { createFunctionHandle, makeFunctionReference } from 'convex/server';

import type { Doc } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import type { ToolName } from '../agent_tools/tool_names';
import type {
  AgentHooksConfig,
  SerializableAgentConfig,
} from '../lib/agent_chat/types';

import { FILE_PREPROCESSING_INSTRUCTIONS } from '../../lib/shared/constants/custom-agents';
import {
  getCodingModelOrThrow,
  getDefaultModel,
  getFastModel,
} from '../lib/agent_runtime_config';

const beforeGenerateHookRef = makeFunctionReference<'action'>(
  'lib/agent_chat/internal_actions:beforeGenerateHook',
);

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
  const instructions = agent.filePreprocessingEnabled
    ? [agent.systemInstructions, FILE_PREPROCESSING_INSTRUCTIONS]
        .filter(Boolean)
        .join('\n\n')
    : agent.systemInstructions;

  const knowledgeMode =
    agent.knowledgeMode ?? (agent.knowledgeEnabled ? 'tool' : 'off');
  const webSearchMode =
    agent.webSearchMode ?? (agent.toolNames.includes('web') ? 'tool' : 'off');

  return {
    name: agent.isSystemDefault ? agent.name : `custom:${agent.name}`,
    instructions,
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- toolNames are filtered via filterValidToolNames() on insert; always valid ToolName values
    convexToolNames: agent.toolNames as ToolName[],
    integrationBindings: agent.integrationBindings,
    workflowBindings: agent.workflowBindings?.map(String),
    model: resolveModel(agent),
    maxSteps: agent.maxSteps,
    enableVectorSearch: false,
    knowledgeMode,
    webSearchMode,
    delegateAgentIds: (agent.delegateAgentIds ?? agent.partnerAgentIds)?.map(
      String,
    ),
    structuredResponsesEnabled: agent.structuredResponsesEnabled ?? true,
    timeoutMs: agent.timeoutMs,
    outputReserve: agent.outputReserve,
  };
}

/**
 * Create FunctionHandles for custom agent file preprocessing hooks.
 * Returns undefined when file preprocessing is disabled.
 */
export async function createCustomAgentHookHandles(
  _ctx: MutationCtx,
  filePreprocessingEnabled: boolean | undefined,
): Promise<AgentHooksConfig | undefined> {
  if (!filePreprocessingEnabled) {
    return undefined;
  }

  const beforeGenerate = await createFunctionHandle(beforeGenerateHookRef);

  return { beforeGenerate };
}
