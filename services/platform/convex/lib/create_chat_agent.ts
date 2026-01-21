import { Agent } from '@convex-dev/agent';
import { components } from '../_generated/api';

import { createAgentConfig } from './create_agent_config';
import { type ToolName } from '../agent_tools/tool_registry';

import { createDebugLog } from './debug_log';

const debugLog = createDebugLog('DEBUG_CHAT_AGENT', '[ChatAgent]');

/**
 * Create a chat agent instance with shared configuration
 * Supports Convex tools
 */
export function createChatAgent(options?: {
  withTools?: boolean;
  maxSteps?: number;
  convexToolNames?: ToolName[];
}) {
  const withTools = options?.withTools ?? true;
  const maxSteps = options?.maxSteps ?? 20;

  // Build tool inputs (Convex tool names)
  let convexToolNames: ToolName[] = [];

  if (withTools) {
    // If no specific Convex tools are requested, use a focused default tool set
    // Direct tools are kept for fast, bounded-output queries
    // Sub-agents handle high-context operations and human input collection
    const defaultToolNames: ToolName[] = [
      // Direct tools (fast, bounded output)
      'rag_search',
      // Sub-agents (context isolation for large outputs)
      // Note: request_human_input is NOT given to chat-agent directly.
      // Sub-agents handle human input collection - they have specialized knowledge
      // to determine when disambiguation is needed and what options to present.
      'web_assistant', // Replaces web_read - isolates web page content (20K-50K tokens)
      'document_assistant', // Replaces pdf, image, docx, pptx, generate_excel - isolates document content
      'integration_assistant', // Replaces integration, integration_introspect, verify_approval - isolates DB results
      'workflow_assistant', // Single entry point for all workflow operations
      'crm_assistant', // Replaces customer_read, product_read - isolates CRM data
    ];
    convexToolNames = options?.convexToolNames ?? defaultToolNames;

    debugLog('createChatAgent Loaded tools', {
      convexCount: convexToolNames.length,
    });
  }

  const agentConfig = createAgentConfig({
    name: 'chat-agent',
    // Use fast model (OPENAI_FAST_MODEL) for better performance
    useFastModel: true,
    temperature: 0.7,
    // Limit max output tokens to prevent runaway/endless streams from certain models
    // 16K tokens is generous for most responses while preventing infinite loops
    maxTokens: 16384,
    // NOTE: Current date/time is provided via system context (DYNAMIC_INFO priority)
    // to improve LLM cache hit rate. Do not add dynamic data here.
    instructions: `You are a routing assistant that delegates tasks to specialized sub-agents.

====================
YOUR ROLE
====================

You are a ROUTER, not an executor. Your job is to:
1. Understand what the user wants
2. Route the request to the appropriate sub-agent or tool
3. Relay the sub-agent's response back to the user

You do NOT directly access databases, APIs, or external systems.
Sub-agents handle all data operations and will ask the user for clarification when needed.

====================
LANGUAGE
====================

ALWAYS respond in the SAME language the user used.

====================
ROUTING RULES
====================

**rag_search** (direct tool):
• Knowledge base queries, policies, documentation, uploaded documents
• Use this for: "What does our policy say about...", "Find documents about..."

**crm_assistant**:
• Internal CRM data (customers, products)
• Use this for: "Find customer...", "List products...", "Customer info for..."

**integration_assistant**:
• External systems (check [INTEGRATIONS] context for available integrations)
• Use this for: "Get data from Shopify...", "Update guest in PMS...", "Sync with..."

**web_assistant**:
• Public web info (weather, prices, news, web pages)
• Use this for: "What's the weather...", "Search for...", "Fetch this URL..."

**document_assistant**:
• File parsing (PDF, Word, PowerPoint) and generation
• Use this for: "Parse this PDF...", "Generate a report...", "Analyze this image..."

**workflow_assistant**:
• All workflow operations (list, create, modify, explain)
• Use this for: "List workflows", "Create a workflow...", "What is workflow_processing_records?"

====================
CRITICAL RULES
====================

1) **SEARCH BEFORE "I DON'T KNOW"**
   Never say you don't have information without first using rag_search.

2) **NO HALLUCINATIONS**
   Only use data from tool results or user messages. Never fabricate facts.

3) **SUB-AGENT RESPONSES**
   When a sub-agent returns "[HUMAN INPUT CARD CREATED" or mentions "waiting for selection":
   • A selection card is ALREADY visible to the user
   • Do NOT list or fabricate options - just say "Please select from the options above"
   • Do NOT invent data not in the sub-agent's response

4) **SUB-AGENT MEMORY**
   Sub-agents remember their previous work. For follow-up questions about a previous
   operation, call the same sub-agent again.

5) **ACT FIRST**
   Route to sub-agents immediately. Don't ask users for details that sub-agents can discover.

====================
RESPONSE STYLE
====================

• Be DIRECT: Answer then STOP
• Use Markdown tables for multiple records
• Match user's language
`,
    ...(withTools ? { convexToolNames } : {}),
    maxSteps,
  });

  return new Agent(components.agent, agentConfig);
}
