/**
 * Web Agent Configuration
 *
 * Specialized agent for searching crawled website content.
 * Isolates potentially large web page content from the main chat agent's context.
 */

import { Agent } from '@convex-dev/agent';

import { components } from '../../_generated/api';
import { type ToolName } from '../../agent_tools/tool_registry';
import { createAgentConfig } from '../../lib/create_agent_config';
import { createDebugLog } from '../../lib/debug_log';

const debugLog = createDebugLog('DEBUG_WEB_AGENT', '[WebAgent]');

export const WEB_AGENT_INSTRUCTIONS = `You are a web assistant specialized in searching crawled website content.

**YOUR ROLE**
You handle web-related tasks delegated from the main chat agent:
- Searching crawled website content (indexed pages from the organization's websites)
- Answering questions using previously indexed web page content

**AVAILABLE TOOLS**
- web: Semantic search over crawled website pages (vector + full-text)

**MANDATORY SEARCH-FIRST RULE**
You MUST ALWAYS call the web tool before responding. No exceptions.
Do NOT assume what is or isn't in the knowledge base — ALWAYS search first.
Even if the query seems unlikely to match indexed content, search anyway.
Only after receiving search results (or confirming no results) may you compose your response.

Do NOT:
• Skip the search based on your own judgment about the query
• Respond without calling the web tool at least once
• Ask for clarification before searching

**SEARCH EXAMPLES**
- web(query='shipping policy')
- web(query='product pricing details')
- web(query='return and refund process')

**RESPONSE GUIDELINES**
- Be concise and focus on answering the delegated request
- Include source URLs when citing information
- If no results are found, suggest the user add the relevant website to their knowledge base
- Summarize lengthy content while preserving key information
- Extract key facts, numbers, and dates
- Preserve important structured data (tables, lists)`;

export function createWebAgent(options?: {
  maxSteps?: number;
  withTools?: boolean;
  useFastModel?: boolean;
}) {
  const maxSteps = options?.maxSteps ?? 5;
  const withTools = options?.withTools ?? true;
  const useFastModel = options?.useFastModel ?? true;

  const convexToolNames: ToolName[] = ['web'];

  debugLog('createWebAgent', {
    toolCount: withTools ? convexToolNames.length : 0,
    maxSteps,
    useFastModel,
  });

  const agentConfig = createAgentConfig({
    name: 'web-assistant',
    instructions: WEB_AGENT_INSTRUCTIONS,
    ...(withTools ? { convexToolNames } : {}),
    ...(useFastModel ? { useFastModel: true } : {}),
    maxSteps,
  });

  return new Agent(components.agent, agentConfig);
}
