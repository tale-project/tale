/**
 * Message Formatter for Structured Context Window
 *
 * Uses HTML <details> elements for collapsible sections.
 * This format is understood by LLMs and renders natively in browsers.
 */

/**
 * Format compact timestamp (YYYY-MM-DD HH:MM:SS UTC)
 */
function shortTime(timestamp: number): string {
  const iso = new Date(timestamp).toISOString();
  return iso.slice(0, 10) + ' ' + iso.slice(11, 19) + 'Z';
}

/**
 * Escape HTML special characters to prevent structure breakage and XSS
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Wrap content in a collapsible <details> section.
 * Used for all context window sections for unified formatting.
 */
export function wrapInDetails(
  summary: string,
  content: string,
  open = false,
): string {
  const openAttr = open ? ' open' : '';
  return `<details${openAttr}>
<summary>${escapeHtml(summary)}</summary>

${escapeHtml(content)}

</details>`;
}

/**
 * Safely stringify a value, handling circular refs, BigInt, and other edge cases
 */
function safeStringify(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, (_, v) =>
      typeof v === 'bigint' ? v.toString() : v,
    );
  } catch {
    return String(value);
  }
}

/**
 * Summarize output (truncate long values)
 * Default limit increased to 8000 chars to preserve meaningful tool results
 * like web research reports, RAG results, and document analysis.
 */
function summarize(output: unknown, max = 8000): string {
  if (output === null || output === undefined) return '-';
  const str = safeStringify(output);
  return str.length > max ? str.slice(0, max) + '...' : str;
}

/**
 * Format a user message
 */
export function formatUserMessage(content: string, timestamp: number): string {
  return `User[${shortTime(timestamp)}]: ${content}`;
}

/**
 * Format an assistant message
 */
export function formatAssistantMessage(
  content: string,
  timestamp: number,
): string {
  return `Assistant[${shortTime(timestamp)}]: ${content}`;
}

/**
 * Format a tool call with its input and output (legacy)
 * Uses log-style format to prevent AI from mimicking this as an action instruction
 */
export function formatToolCall(
  toolName: string,
  _input: unknown,
  output: unknown,
  _timestamp: number,
  status: 'success' | 'error' = 'success',
): string {
  const s = status === 'success' ? '✓' : '✗';
  return `[Tool Result] ${toolName} (${s}): ${summarize(output)}`;
}

/**
 * Format a tool call summary
 * Uses log-style format to prevent AI from mimicking this as an action instruction
 */
export function formatToolCallSummary(
  toolName: string,
  output: unknown,
  _timestamp: number,
  status: 'success' | 'error' = 'success',
): string {
  const s = status === 'success' ? '✓' : '✗';
  return `[Tool Result] ${toolName} (${s}): ${summarize(output)}`;
}

/**
 * Format a human input request
 */
export function formatHumanInputRequest(
  id: string,
  question: string,
  format: string,
  context?: string,
  options?: Array<{ label: string; description?: string; value?: string }>,
  timestamp?: number,
): string {
  const t = timestamp ? `[${shortTime(timestamp)}]` : '';
  const opts = options?.length
    ? ` Options: ${options.map((o) => o.label).join(', ')}`
    : '';
  return `HumanInput${t} (${format}): ${question}${opts}`;
}

/**
 * Format a human response
 */
export function formatHumanResponse(
  id: string,
  response: string | string[],
  user: string,
  timestamp: number,
): string {
  const r = typeof response === 'string' ? response : response.join(', ');
  return `HumanResponse[${shortTime(timestamp)}] by ${user}: ${r}`;
}

/**
 * Format system info (collapsible)
 */
export function formatSystemInfo(threadId: string, timestamp: number): string {
  const content = `thread=${threadId} time=${shortTime(timestamp)}`;
  return wrapInDetails('⚙️ System', content);
}

/**
 * Format context summary (collapsible)
 */
export function formatContextSummary(summary: string): string {
  return wrapInDetails('📝 Summary', summary);
}

/**
 * Format knowledge base (collapsible)
 */
export function formatKnowledgeBase(content: string): string {
  return wrapInDetails('📚 Knowledge', content);
}

/**
 * Format integrations info (collapsible)
 */
export function formatIntegrations(info: string): string {
  return wrapInDetails('🔌 Integrations', info);
}

/**
 * Format task description (just prefixed user message for sub-agents)
 */
export function formatTaskDescription(description: string): string {
  return `User: ${description}`;
}

/**
 * Format additional context (collapsible)
 */
export function formatAdditionalContext(key: string, value: string): string {
  return wrapInDetails(`📎 ${key}`, value);
}

/**
 * Format parent thread reference (collapsible)
 */
export function formatParentThread(parentThreadId: string): string {
  return wrapInDetails('🔗 Parent', parentThreadId);
}

/**
 * Format conversation history section (collapsible)
 */
export function formatHistorySection(historyContent: string): string {
  return wrapInDetails('💬 History', historyContent);
}

/**
 * Format current user request section (expanded by default, distinct from history)
 */
export function formatCurrentRequestSection(content: string): string {
  return wrapInDetails('📩 Current Request', content, true);
}

/**
 * Format AI response section (expanded by default)
 */
export function formatCurrentTurnSection(content: string): string {
  return wrapInDetails('✨ AI Response', content, true);
}

/**
 * Format a system message
 */
export function formatSystemMessage(
  content: string,
  timestamp: number,
): string {
  return `System[${shortTime(timestamp)}]: ${content}`;
}

/**
 * Tool call info for current turn
 */
export interface CurrentTurnToolCall {
  toolName: string;
  status: 'completed' | 'failed' | string;
}

/**
 * Format the current turn (tool calls and assistant output only)
 * User input is already in message history, so we don't duplicate it here.
 */
export function formatCurrentTurn(params: {
  assistantOutput: string;
  toolCalls?: CurrentTurnToolCall[];
  timestamp: number;
}): string {
  const { assistantOutput, toolCalls, timestamp } = params;
  const parts: string[] = [];
  const t = shortTime(timestamp);

  if (toolCalls?.length) {
    parts.push(
      `Tools: ${toolCalls.map((tc) => `${tc.toolName}(${tc.status})`).join(', ')}`,
    );
  }
  if (assistantOutput) parts.push(`Assistant[${t}]: ${assistantOutput}`);

  return parts.join('\n');
}
