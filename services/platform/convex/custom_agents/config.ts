/**
 * Convert a DB custom agent record to SerializableAgentConfig.
 *
 * This is the thin mapping layer between the database model
 * and the existing agent pipeline.
 *
 * Model preset resolution:
 * - 'fast' → useFastModel flag (resolved in createAgentConfig via OPENAI_FAST_MODEL)
 * - 'standard' → default (resolved in createAgentConfig via OPENAI_MODEL)
 * - 'advanced' → resolved via OPENAI_CODING_MODEL env var
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

const beforeGenerateHookRef = makeFunctionReference<'action'>(
  'lib/agent_chat/internal_actions:beforeGenerateHook',
);

function resolveModelPreset(preset: string): string | undefined {
  switch (preset) {
    case 'fast':
      return undefined; // handled by useFastModel flag
    case 'advanced':
      return process.env.OPENAI_CODING_MODEL;
    default:
      return undefined; // 'standard' uses default OPENAI_MODEL
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

  return {
    name: agent.isSystemDefault ? agent.name : `custom:${agent.name}`,
    instructions,
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- toolNames are validated via validateToolNames() on insert; always valid ToolName values
    convexToolNames: agent.toolNames as ToolName[],
    integrationBindings: agent.integrationBindings,
    useFastModel: agent.modelPreset === 'fast',
    model: resolveModelPreset(agent.modelPreset),
    maxSteps: agent.maxSteps,
    enableVectorSearch: false,
    partnerAgentIds: agent.partnerAgentIds?.map(String),
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
