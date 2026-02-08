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
import type { SerializableAgentConfig } from '../lib/agent_chat/types';
import type { ToolName } from '../agent_tools/tool_registry';

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
    convexToolNames: agent.toolNames as ToolName[],
    useFastModel: agent.modelPreset === 'fast',
    model: resolveModelPreset(agent.modelPreset),
    temperature: agent.temperature,
    maxTokens: agent.maxTokens,
    maxSteps: agent.maxSteps ?? 15,
    enableVectorSearch: agent.includeKnowledge,
  };
}
