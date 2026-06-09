/**
 * Pure formatting helpers for auto-compaction (no IO, no node-only APIs) so the
 * transcript-building + summary-prompt logic is unit-testable without the
 * Convex action runtime. Consumed by `./summarize`.
 */

import { isRecord } from '../../../../lib/utils/type-guards';

/** Minimal structural shape these helpers need from an Agent SDK message —
 *  decoupled from the full `MessageDoc` so the formatting is testable with
 *  plain objects. `MessageDoc` is structurally assignable to it. */
export interface SummarizableMessage {
  message?: { role?: string; content?: unknown } | null;
}

export const SUMMARY_SYSTEM =
  'You compress a conversation transcript into a dense, faithful running summary that a downstream assistant will rely on as its ONLY memory of the earlier conversation. Preserve, in compact prose or terse bullet points: the user’s goals and constraints, decisions and conclusions reached, concrete facts/values/identifiers established, the state of any ongoing task, unresolved questions, and the outcome of any tools that were run. Preserve the user’s stated preferences and any commitments the assistant made. Do NOT invent anything not present in the transcript, do NOT add commentary, and do NOT address the user — write it as notes-to-self for the assistant. Keep it as short as faithfully possible.';

/** Extract plain text from an Agent SDK message content (string | parts[]). */
export function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const part of content) {
    if (typeof part === 'string') parts.push(part);
    else if (
      isRecord(part) &&
      part.type === 'text' &&
      typeof part.text === 'string'
    ) {
      parts.push(part.text);
    }
  }
  return parts.join('\n');
}

/** Max chars of a single tool result kept in the transcript (outputs can be
 *  huge; the summarizer only needs the gist of the outcome). */
const MAX_TOOL_RESULT_CHARS = 400;

/** Compact one-line digest of a tool message's results, so the summary can
 *  preserve "the outcome of any tools that were run" instead of dropping them. */
export function summarizeToolResults(content: unknown): string {
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const part of content) {
    if (!isRecord(part) || part.type !== 'tool-result') continue;
    const name = typeof part.toolName === 'string' ? part.toolName : 'tool';
    const raw = part.result ?? part.output;
    const text =
      typeof raw === 'string' ? raw : raw == null ? '' : JSON.stringify(raw);
    const trimmed = text
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_TOOL_RESULT_CHARS);
    const status = part.isError === true ? ' (error)' : '';
    parts.push(`${name}${status} → ${trimmed}`);
  }
  return parts.join('; ');
}

/** One transcript line per message (role-prefixed); '' for empty. Tool messages
 *  contribute a compact outcome digest so tool results survive compaction. */
export function formatForSummary(msg: SummarizableMessage): string {
  const role = msg.message?.role;
  if (role === 'tool') {
    const tools = summarizeToolResults(msg.message?.content);
    return tools ? `Tool: ${tools}` : '';
  }
  if (role !== 'user' && role !== 'assistant' && role !== 'system') return '';
  const text = extractText(msg.message?.content).trim();
  if (!text) return '';
  const who =
    role === 'user' ? 'User' : role === 'assistant' ? 'Assistant' : 'System';
  return `${who}: ${text}`;
}

/** Join formatted lines into the transcript block fed to the summarizer. */
export function buildTranscript(messages: SummarizableMessage[]): string {
  return messages
    .map(formatForSummary)
    .filter((line) => line.length > 0)
    .join('\n');
}

/** Build the summarization prompt, folding any prior running summary in. */
export function buildSummaryPrompt(
  prev: string | undefined,
  transcript: string,
): string {
  const prior = prev
    ? `Existing running summary of even earlier conversation (fold this in; keep its still-relevant facts):\n<existing_summary>\n${prev}\n</existing_summary>\n\n`
    : '';
  return `${prior}New transcript to fold into the running summary:\n<transcript>\n${transcript}\n</transcript>\n\nReturn the updated running summary.`;
}
