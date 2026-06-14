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
 *
 * SUB-AGENT FOLDING: an event with `parentToolUseId` was emitted by a sub-agent
 * (the agent's own Task/Agent tool). Its text is dropped and its tool calls fold
 * into the parent Task part's `output` as `{ report, steps }` — the SAME shape
 * `toUIMessages` hands the persisted path after unwrapping `{type:'json',value}`
 * — so the timeline nests sub-agent activity under its Task card instead of
 * flattening it. Mirrors `buildAssistantContent`'s server-side fold.
 */

import { isRecord } from '@/lib/utils/type-guards';

interface SubAgentStep {
  toolName: string;
  input?: unknown;
  output?: unknown;
  isError?: boolean;
}

function resultText(output: unknown): string {
  if (typeof output === 'string') return output;
  if (Array.isArray(output)) {
    const texts = output
      .map((b) => (isRecord(b) && typeof b.text === 'string' ? b.text : ''))
      .filter((t) => t !== '');
    if (texts.length > 0) return texts.join('\n');
  }
  return output === undefined || output === null ? '' : JSON.stringify(output);
}

export function buildExternalAgentParts(
  recentEvents: readonly string[] | undefined,
): unknown[] {
  if (!Array.isArray(recentEvents) || recentEvents.length === 0) return [];

  const events: Array<Record<string, unknown>> = [];
  for (const rawJson of recentEvents) {
    try {
      const ev: unknown = JSON.parse(rawJson);
      if (isRecord(ev) && typeof ev.type === 'string') events.push(ev);
    } catch {
      continue;
    }
  }

  // childToolUseId → immediate parentToolUseId, learned from sub-agent tool-uses
  // (the parent Task's tool-use precedes them in the stream).
  const toolParents = new Map<string, string>();
  for (const ev of events) {
    if (
      ev.type === 'tool-use' &&
      typeof ev.toolUseId === 'string' &&
      typeof ev.parentToolUseId === 'string'
    ) {
      toolParents.set(ev.toolUseId, ev.parentToolUseId);
    }
  }
  /** Walk to the top-level Task tool-use id; undefined ⇒ a main-agent event. */
  const rootTaskOf = (parentId: unknown): string | undefined => {
    let cur = typeof parentId === 'string' ? parentId : undefined;
    for (let depth = 0; cur !== undefined && depth < 8; depth++) {
      const next = toolParents.get(cur);
      if (next === undefined) return cur;
      cur = next;
    }
    return cur;
  };

  const parts: Array<Record<string, unknown>> = [];
  // toolUseId → index into `parts`, for top-level tool parts only (Task cards +
  // main-agent tools), so a tool-result updates its part in place.
  const toolIndex = new Map<string, number>();
  // rootTaskId → folded sub-agent steps (attached to the Task part at the end).
  const subSteps = new Map<string, SubAgentStep[]>();
  // subAgentToolUseId → its step object, so the sub-agent's tool-result fills it.
  const stepByUseId = new Map<string, SubAgentStep>();
  // rootTaskId → the sub-agent's final report (the Task tool-result's text).
  const reportByRoot = new Map<string, string>();
  const pushStep = (root: string, step: SubAgentStep): void => {
    const list = subSteps.get(root);
    if (list) list.push(step);
    else subSteps.set(root, [step]);
  };

  for (const event of events) {
    if (event.type === 'text') {
      // Sub-agent narration is dropped (its report rides the Task result).
      if (rootTaskOf(event.parentToolUseId) !== undefined) continue;
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
      const root = rootTaskOf(event.parentToolUseId);
      if (root !== undefined) {
        // Sub-agent tool call → fold under its top-level Task instead of a card.
        const step: SubAgentStep = {
          toolName,
          ...(isRecord(event.input) ? { input: event.input } : {}),
        };
        stepByUseId.set(toolCallId, step);
        pushStep(root, step);
        continue;
      }
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
      const isError = event.isError === true;
      const root = rootTaskOf(event.parentToolUseId);
      if (root !== undefined) {
        // Sub-agent tool result → fill the step its use opened (or append a
        // result-only step if the use scrolled out of the recent-events tail).
        const existing = toolCallId ? stepByUseId.get(toolCallId) : undefined;
        if (existing) {
          if ('output' in event) existing.output = event.output;
          if (isError) existing.isError = true;
        } else if (toolCallId) {
          pushStep(root, {
            toolName: 'tool',
            ...('output' in event ? { output: event.output } : {}),
            ...(isError ? { isError: true } : {}),
          });
        }
        continue;
      }
      // Main-agent tool result. A Task's result carries the sub-agent's report;
      // capture it (the steps fold in at the end).
      if (toolCallId && subSteps.has(toolCallId)) {
        reportByRoot.set(toolCallId, resultText(event.output));
      }
      const idx = toolCallId ? toolIndex.get(toolCallId) : undefined;
      if (idx === undefined) continue; // result with no prior use — skip
      const prior = parts[idx];
      prior.state = isError ? 'output-error' : 'output-available';
      if ('output' in event) prior.output = event.output;
      if (isError) {
        prior.errorText =
          typeof event.output === 'string' ? event.output : 'tool error';
      }
    }
  }

  // Attach each Task's folded sub-agent activity to its card (same `{report,
  // steps}` shape the persisted path yields after toUIMessages unwraps the json
  // output). A root whose Task use scrolled out of the tail is simply skipped.
  for (const [root, steps] of subSteps) {
    const idx = toolIndex.get(root);
    if (idx === undefined) continue;
    parts[idx].output = { report: reportByRoot.get(root) ?? '', steps };
  }

  return parts;
}
