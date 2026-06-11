// Maps an external-agent (Claude Code / OpenCode) turn's full event timeline to
// the AI-SDK assistant-message `content` parts that @convex-dev/agent persists.
// On read, listUIMessages/toUIMessages merges the tool-call+tool-result parts by
// toolCallId into the `tool-<name>` UI parts the chat history renderer already
// shows — so a completed turn's tool calls (command + output) survive in history,
// not just the live (capped, ephemeral) op buffer.
//
// This is the ModelMessage CONTENT shape — distinct from the frontend
// build-external-agent-parts.ts (UI-part shape used for the live op view).

import type { AgentEvent } from '@tale/agent-adapters';
import type { AssistantContent } from 'ai';

// Per-tool-output cap so a giant clone/diff/file-read can't push the persisted
// message past Convex's 1 MB document limit. The live view clamps display
// separately; this bounds what we store.
const MAX_OUTPUT_CHARS = 16_000;

function clamp(text: string): string {
  return text.length > MAX_OUTPUT_CHARS
    ? `${text.slice(0, MAX_OUTPUT_CHARS)}\n… (truncated)`
    : text;
}

function stringifyOutput(output: unknown): string {
  if (typeof output === 'string') return output;
  if (output === undefined || output === null) return '';
  try {
    return JSON.stringify(output);
  } catch {
    return String(output);
  }
}

/**
 * Build the assistant message content from the turn's ordered timeline events.
 * `tool-use` → tool-call part, `tool-result` → tool-result part (paired by
 * toolUseId so toUIMessages merges them into a `tool-<name>` UI part), and the
 * agent's `text` blocks → text parts (the assistant's own words / the reply —
 * NOT reasoning, so they render once as the message body, not duplicated into a
 * "Thinking" block). `finalText` is appended only when the stream's last text
 * block didn't already produce it (e.g. a tool-only turn), avoiding duplication.
 *
 * Returns a plain string when the turn made no tool calls (a trivial turn is
 * just its answer text).
 */
export function buildAssistantContent(
  events: readonly AgentEvent[],
  finalText: string,
): AssistantContent {
  const hasToolTimeline = events.some(
    (e) => e.type === 'tool-use' || e.type === 'tool-result',
  );
  // No tools → the message is just its answer; keep it a plain string.
  if (!hasToolTimeline) return finalText;

  const parts: Exclude<AssistantContent, string> = [];
  // toolUseId → toolName, so a tool-result (which carries no toolName) pairs
  // with its call under the same name for toUIMessages' merge.
  const toolNames = new Map<string, string>();
  let lastText: string | undefined;

  for (const e of events) {
    if (e.type === 'text') {
      if (e.text.trim() === '') continue;
      parts.push({ type: 'text', text: e.text });
      lastText = e.text;
    } else if (e.type === 'tool-use') {
      toolNames.set(e.toolUseId, e.toolName);
      parts.push({
        type: 'tool-call',
        toolCallId: e.toolUseId,
        toolName: e.toolName,
        input: e.input,
        providerExecuted: true,
      });
    } else if (e.type === 'tool-result') {
      const value = clamp(stringifyOutput(e.output));
      parts.push({
        type: 'tool-result',
        toolCallId: e.toolUseId,
        toolName: toolNames.get(e.toolUseId) ?? 'tool',
        output: e.isError
          ? { type: 'error-text', value }
          : { type: 'text', value },
      });
    }
  }

  // Ensure the final answer is present exactly once (the stream usually already
  // emitted it as the last text block; append only if it didn't).
  if (finalText.trim() !== '' && finalText !== lastText) {
    parts.push({ type: 'text', text: finalText });
  }
  return parts;
}
