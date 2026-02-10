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
 * - 'vision' → resolved via OPENAI_VISION_MODEL env var
 */

import type { Doc } from '../_generated/dataModel';
import type { ToolName } from '../agent_tools/tool_names';
import type { SerializableAgentConfig } from '../lib/agent_chat/types';

function resolveModelPreset(preset: string): string | undefined {
  switch (preset) {
    case 'fast':
      return undefined; // handled by useFastModel flag
    case 'advanced':
      return process.env.OPENAI_CODING_MODEL;
    case 'vision':
      return process.env.OPENAI_VISION_MODEL;
    default:
      return undefined; // 'standard' uses default OPENAI_MODEL
  }
}

export function toSerializableConfig(
  agent: Doc<'customAgents'>,
): SerializableAgentConfig {
  return {
    name: `custom:${agent.name}`,
    instructions: agent.systemInstructions,
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- toolNames are validated via validateToolNames() on insert; always valid ToolName values
    convexToolNames: agent.toolNames as ToolName[],
    integrationBindings: agent.integrationBindings,
    useFastModel: agent.modelPreset === 'fast',
    model: resolveModelPreset(agent.modelPreset),
    enableVectorSearch: false,
  };
}
