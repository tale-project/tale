/**
 * Create Document Assistant Agent
 *
 * Specialized agent for document parsing and generation operations.
 * Isolates potentially large document content from the main chat agent's context.
 */

import { Agent } from '@convex-dev/agent';
import { components } from '../_generated/api';
import { createAgentConfig } from './create_agent_config';
import { type ToolName } from '../agent_tools/tool_registry';
import { DOCUMENT_ASSISTANT_INSTRUCTIONS } from '../agent_tools/sub_agents/instructions/document_instructions';
import { createDebugLog } from './debug_log';

const debugLog = createDebugLog('DEBUG_DOCUMENT_AGENT', '[DocumentAgent]');

export function createDocumentAgent(options?: {
  maxSteps?: number;
}) {
  const maxSteps = options?.maxSteps ?? 15;

  const convexToolNames: ToolName[] = [
    'pdf',
    'image',
    'docx',
    'pptx',
    'generate_excel',
    'request_human_input',
  ];

  debugLog('createDocumentAgent Loaded tools', {
    convexCount: convexToolNames.length,
    maxSteps,
  });

  const agentConfig = createAgentConfig({
    name: 'document-assistant',
    instructions: DOCUMENT_ASSISTANT_INSTRUCTIONS,
    convexToolNames,
    maxSteps,
  });

  return new Agent(components.agent, agentConfig);
}
