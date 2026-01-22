/**
 * Message Formatter for Structured Context Window
 *
 * Formats conversation messages, tool calls, and human interactions
 * as XML-like structured tags for clear context organization.
 */

/**
 * Escape XML special characters in content
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Format ISO timestamp
 */
function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

/**
 * Format a user message
 */
export function formatUserMessage(content: string, timestamp: number): string {
  return `<user timestamp="${formatTimestamp(timestamp)}">
${escapeXml(content)}
</user>`;
}

/**
 * Format an assistant message
 */
export function formatAssistantMessage(
  content: string,
  timestamp: number,
): string {
  return `<assistant timestamp="${formatTimestamp(timestamp)}">
${escapeXml(content)}
</assistant>`;
}

/**
 * Format a tool call with its input and output
 */
export function formatToolCall(
  toolName: string,
  input: unknown,
  output: unknown,
  timestamp: number,
  status: 'success' | 'error' = 'success',
): string {
  const inputStr = JSON.stringify(input, null, 2);
  const outputStr = JSON.stringify(output, null, 2);

  return `<tool_call name="${escapeXml(toolName)}" timestamp="${formatTimestamp(timestamp)}" status="${status}">
input: ${escapeXml(inputStr)}
output: ${escapeXml(outputStr)}
</tool_call>`;
}

/**
 * Format a human input request (from AI to user)
 */
export function formatHumanInputRequest(
  id: string,
  question: string,
  format: string,
  context?: string,
  options?: Array<{ label: string; description?: string; value?: string }>,
  timestamp?: number,
): string {
  const parts: string[] = [`question: ${escapeXml(question)}`];

  if (context) {
    parts.push(`context: ${escapeXml(context)}`);
  }

  if (options && options.length > 0) {
    parts.push(`options: ${escapeXml(JSON.stringify(options))}`);
  }

  const timestampAttr = timestamp
    ? ` timestamp="${formatTimestamp(timestamp)}"`
    : '';

  return `<request_human_input id="${escapeXml(id)}" format="${escapeXml(format)}"${timestampAttr}>
${parts.join('\n')}
</request_human_input>`;
}

/**
 * Format a human response (user's answer to AI's question)
 */
export function formatHumanResponse(
  id: string,
  response: string | string[],
  user: string,
  timestamp: number,
): string {
  const responseStr =
    typeof response === 'string' ? response : JSON.stringify(response);

  return `<human_response id="${id}" user="${escapeXml(user)}" timestamp="${formatTimestamp(timestamp)}">
response: ${escapeXml(responseStr)}
</human_response>`;
}

/**
 * Format system information block
 */
export function formatSystemInfo(threadId: string, timestamp: number): string {
  return `<system>
thread_id: ${threadId}
time: ${formatTimestamp(timestamp)}
</system>`;
}

/**
 * Format context summary block
 */
export function formatContextSummary(summary: string): string {
  return `<context_summary>
${escapeXml(summary)}
</context_summary>`;
}

/**
 * Format knowledge base (RAG) context block
 */
export function formatKnowledgeBase(content: string): string {
  return `<knowledge_base>
${escapeXml(content)}
</knowledge_base>`;
}

/**
 * Format integrations info block
 */
export function formatIntegrations(info: string): string {
  return `<integrations>
${escapeXml(info)}
</integrations>`;
}

/**
 * Format task description block (used by agents when handling a specific task)
 */
export function formatTaskDescription(description: string): string {
  return `<current_task>
${escapeXml(description)}
</current_task>`;
}

/**
 * Format additional context block with dynamic tag name
 * The key is sanitized to be a valid XML tag name
 */
export function formatAdditionalContext(key: string, value: string): string {
  const tagName = key.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^[0-9]/, '_$&');
  return `<${tagName}>
${escapeXml(value)}
</${tagName}>`;
}

/**
 * Format parent thread reference (for sub-agent context)
 */
export function formatParentThread(parentThreadId: string): string {
  return `<parent_thread>
${parentThreadId}
</parent_thread>`;
}

/**
 * Format a system message (internal notification)
 */
export function formatSystemMessage(content: string, timestamp: number): string {
  return `<system_message timestamp="${formatTimestamp(timestamp)}">
${escapeXml(content)}
</system_message>`;
}

/**
 * Tool call info for current turn
 */
export interface CurrentTurnToolCall {
  toolName: string;
  status: 'completed' | 'failed' | string;
}

/**
 * Format the current turn (user input + AI output + tool calls)
 * This is appended to the context window after generation completes
 */
export function formatCurrentTurn(params: {
  userInput: string;
  assistantOutput: string;
  toolCalls?: CurrentTurnToolCall[];
  timestamp: number;
}): string {
  const { userInput, assistantOutput, toolCalls, timestamp } = params;
  const parts: string[] = [];

  parts.push(`<current_turn timestamp="${formatTimestamp(timestamp)}">`);

  if (userInput) {
    parts.push(`<user_input>
${escapeXml(userInput)}
</user_input>`);
  }

  if (toolCalls && toolCalls.length > 0) {
    parts.push(`<tool_calls>
${toolCalls.map((tc) => `  <tool name="${escapeXml(tc.toolName)}" status="${escapeXml(tc.status)}" />`).join('\n')}
</tool_calls>`);
  }

  if (assistantOutput) {
    parts.push(`<assistant_output>
${escapeXml(assistantOutput)}
</assistant_output>`);
  }

  parts.push('</current_turn>');

  return parts.join('\n');
}
