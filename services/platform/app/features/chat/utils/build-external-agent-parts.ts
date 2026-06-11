/**
 * Adapts an external-agent op's `recentEvents` (JSON-stringified AgentEvents
 * from @tale/agent-adapters, streamed into sandboxSessionOps) into the SAME
 * loosely-typed `parts` array that `buildMessageSegments` already consumes — so
 * the live Claude Code / OpenCode timeline reuses the existing thought-process
 * renderer with zero new row components.
 *
 * Mapping (array order preserved — the adapter emits events chronologically):
 *   - `text`        → a `reasoning` part (the agent's running narration between
 *                     tools; the final answer renders from the saved message).
 *   - `tool-use`    → a `tool-<name>` part, state `input-available`.
 *   - `tool-result` → updates the matching `tool-<name>` part (keyed by
 *                     toolUseId) to `output-available` / `output-error`.
 * `text-delta`/`usage`/`raw`/`run-started`/`result` are ignored (deltas aren't
 * in recentEvents; the rest aren't timeline steps).
 */

import { isRecord } from '@/lib/utils/type-guards';

export function buildExternalAgentParts(
  recentEvents: readonly string[] | undefined,
): unknown[] {
  if (!Array.isArray(recentEvents) || recentEvents.length === 0) return [];

  const parts: Array<Record<string, unknown>> = [];
  // toolUseId → index into `parts`, so a tool-result updates the tool part in
  // place (the renderer also merges by toolCallId, but we need the toolName
  // from the earlier tool-use since tool-result events don't carry it).
  const toolIndex = new Map<string, number>();

  for (const rawJson of recentEvents) {
    let event: unknown;
    try {
      event = JSON.parse(rawJson);
    } catch {
      continue;
    }
    if (!isRecord(event) || typeof event.type !== 'string') continue;

    if (event.type === 'text') {
      const text = typeof event.text === 'string' ? event.text : '';
      if (text.trim() === '') continue;
      parts.push({ type: 'reasoning', text, state: 'done' });
      continue;
    }

    if (event.type === 'tool-use') {
      const toolName =
        typeof event.toolName === 'string' && event.toolName
          ? event.toolName
          : 'tool';
      const toolCallId =
        typeof event.toolUseId === 'string' && event.toolUseId
          ? event.toolUseId
          : `tool-${parts.length}`;
      parts.push({
        type: `tool-${toolName}`,
        state: 'input-available',
        toolCallId,
        ...(isRecord(event.input) ? { input: event.input } : {}),
      });
      toolIndex.set(toolCallId, parts.length - 1);
      continue;
    }

    if (event.type === 'tool-result') {
      const toolCallId =
        typeof event.toolUseId === 'string' ? event.toolUseId : '';
      const idx = toolCallId ? toolIndex.get(toolCallId) : undefined;
      if (idx === undefined) continue; // result with no prior use — skip
      const isError = event.isError === true;
      const prior = parts[idx];
      prior.state = isError ? 'output-error' : 'output-available';
      if ('output' in event) prior.output = event.output;
      if (isError) {
        prior.errorText =
          typeof event.output === 'string' ? event.output : 'tool error';
      }
    }
  }

  return parts;
}
