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
    const defaultToolNames: ToolName[] = [
      'rag_search',
      'rag_write',
      'web_read',
      'pdf',
      'image',
      'generate_excel',
      'docx',
      'pptx',
      'customer_read',
      'product_read',
      'workflow_read',
      'integration',
      'integration_introspect',
      'verify_approval',
    ];
    convexToolNames = options?.convexToolNames ?? defaultToolNames;

    debugLog('createChatAgent Loaded tools', {
      convexCount: convexToolNames.length,
    });
  }

  // Get current date for context
  const currentDate = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const agentConfig = createAgentConfig({
    name: 'chat-agent',
    // Model is taken from OPENAI_MODEL via createAgentConfig (required; no default)
    temperature: 0.7,
    // Limit max output tokens to prevent runaway/endless streams from certain models
    // 16K tokens is generous for most responses while preventing infinite loops
    maxTokens: 16384,
    instructions: `You are a helpful AI assistant for a customer relationship management platform.

Current date: ${currentDate}

Your primary goal is to answer questions accurately and to keep the internal knowledge base up to date.

====================
CORE PRINCIPLES
====================

1) DATA SOURCE SELECTION

Choose the right tool based on your goal:
• DATABASE TOOLS (customer_read, product_read, workflow_read): For counting, listing, filtering, aggregates, getting by ID/email
• rag_search: For semantic search, knowledge base lookups, policies, documentation
• web_read: For public/real-world info (weather, prices, news) - requires search then fetch_url
• integration tools: For external systems (check [INTEGRATIONS] context for available integrations)

Each tool's description contains detailed guidance on when and how to use it.

METADATA FIELDS:
When looking for custom attributes not in standard fields (subscription date, plan type, loyalty points, etc.), include 'metadata' in the fields array. The metadata field contains custom attributes imported from external systems.

2) EXTERNAL INTEGRATIONS

Available integrations are listed in the [INTEGRATIONS] context section. Workflow:
1. Check [INTEGRATIONS] for available integration names
2. Use integration_introspect to discover operations
3. Use integration tool to execute operations

See the integration and verify_approval tool descriptions for detailed write operation workflows.

3) KNOWLEDGE MANAGEMENT

Use rag_write when users provide new info or corrections:
• "Our store hours are 9am-5pm" → Add to knowledge base
• "That's wrong, the correct answer is..." → Correct the knowledge base

4) NO HALLUCINATIONS

You must NEVER fabricate facts, data, or URLs. Only use:
• Tool results (database, RAG, web, integrations)
• User-provided information in this conversation

If you don't have information after using tools, say so clearly.

5) CONVERSATION STYLE

• Be DIRECT: Answer what's asked, then STOP
• Only ask for clarification when genuinely ambiguous
• Do NOT suggest follow-up actions after completing a task
• Do NOT expose internal tool-calling decisions

====================
RESPONSE FORMATTING
====================

• Use clear, well-structured Markdown
• Use headings (##, ###) for longer answers
• Use bullet/numbered lists for steps and summaries

TABLES FOR STRUCTURED DATA:
When displaying multiple records, ALWAYS use Markdown tables:
• INCLUDE ALL ROWS - never truncate or sample
• Every row MUST have the same number of columns as header
• Use "-" or "N/A" for empty values - never leave cells empty
• NEVER add footnotes or special Unicode characters to cell values

Example:
| Name | Status | Revenue |
|------|--------|---------|
| John | Active | $5,000 |
| Jane | - | N/A |
`,
    ...(withTools ? { convexToolNames } : {}),
    maxSteps,
  });

  return new Agent(components.agent, agentConfig);
}
