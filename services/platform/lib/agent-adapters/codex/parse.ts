// Codex `codex exec --json` JSONL → normalized AgentEvent[].
//
// Event shapes (verified against codex-cli 0.142.5 live runs + the
// @openai/codex-sdk ThreadEvent/ThreadItem typings, which are versioned with
// the CLI):
//   { type: "thread.started", thread_id }
//   { type: "turn.started" }
//   { type: "item.started" | "item.updated" | "item.completed", item }
//     item: { id, type: "agent_message" | "reasoning" | "command_execution"
//             | "file_change" | "mcp_tool_call" | "web_search" | "todo_list"
//             | "error", ... }
//   { type: "turn.completed", usage: { input_tokens, cached_input_tokens,
//     output_tokens, reasoning_output_tokens } }
//   { type: "turn.failed", error: { message } }
//   { type: "error", message }   // includes TRANSIENT stream reconnects

import type { AgentEvent, AgentEventParser } from '../events';
import { isRecord, LineReassembler, parseJsonLine } from '../jsonl';

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}
function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** Item types that render as a tool call in the timeline. */
const TOOL_ITEM_TYPES = new Set([
  'command_execution',
  'file_change',
  'mcp_tool_call',
  'web_search',
  'todo_list',
]);

/** Codex item type → the timeline tool name. Claude-style names where the
 * concept matches (the UI already renders those); MCP calls keep the
 * `mcp__<server>__<tool>` convention. */
function toolName(item: Record<string, unknown>): string {
  const type = str(item.type);
  if (type === 'command_execution') return 'Bash';
  if (type === 'file_change') return 'Edit';
  if (type === 'web_search') return 'WebSearch';
  if (type === 'todo_list') return 'TodoWrite';
  if (type === 'mcp_tool_call') {
    const server = str(item.server) ?? 'mcp';
    const tool = str(item.tool) ?? '';
    return `mcp__${server}__${tool}`;
  }
  return type ?? '';
}

function toolInput(item: Record<string, unknown>): unknown {
  const type = str(item.type);
  if (type === 'command_execution') return { command: item.command };
  if (type === 'file_change') return { changes: item.changes };
  if (type === 'web_search') return { query: item.query };
  if (type === 'todo_list') return { todos: item.items };
  if (type === 'mcp_tool_call') return item.arguments;
  return undefined;
}

function toolOutput(item: Record<string, unknown>): unknown {
  const type = str(item.type);
  if (type === 'command_execution') {
    return {
      output: item.aggregated_output,
      ...(num(item.exit_code) !== undefined && { exitCode: item.exit_code }),
    };
  }
  if (type === 'file_change') return { changes: item.changes };
  if (type === 'mcp_tool_call') return item.error ?? item.result;
  return undefined;
}

export class CodexParser implements AgentEventParser {
  private readonly lines = new LineReassembler();
  private started = false;
  private sessionId: string | undefined;
  private finalText: string | undefined;
  /** Item ids whose `tool-use` has been emitted (item.started dedup). */
  private readonly toolStarted = new Set<string>();

  feed(chunk: string): AgentEvent[] {
    return this.lines.push(chunk).flatMap((line) => this.line(line));
  }

  end(): AgentEvent[] {
    return this.lines.flush().flatMap((line) => this.line(line));
  }

  private maybeStart(ev: Record<string, unknown>): AgentEvent[] {
    const sid = str(ev.thread_id);
    if (sid) this.sessionId = sid;
    if (this.started) return [];
    this.started = true;
    const out: AgentEvent = { type: 'run-started', agent: 'codex' };
    if (this.sessionId) out.agentSessionId = this.sessionId;
    return [out];
  }

  private item(
    phase: 'started' | 'updated' | 'completed',
    item: Record<string, unknown>,
  ): AgentEvent[] {
    const type = str(item.type);
    const id = str(item.id);

    if (type === 'agent_message') {
      // Assistant text arrives as ONE completed block (no deltas in the exec
      // JSONL stream — verified 0.142.5); updates carry partial text we would
      // double-render, so only the completed block is surfaced.
      if (phase !== 'completed') return [];
      const text = str(item.text);
      if (!text) return [];
      this.finalText = text;
      return [{ type: 'text', text }];
    }

    if (type === 'error') {
      const message = str(item.message);
      return message ? [{ type: 'error', message, raw: item }] : [];
    }

    if (type && id && TOOL_ITEM_TYPES.has(type)) {
      const events: AgentEvent[] = [];
      if (!this.toolStarted.has(id)) {
        // Some item kinds surface only as item.completed (no started phase) —
        // synthesize the tool-use so the result always has its call.
        this.toolStarted.add(id);
        events.push({
          type: 'tool-use',
          toolUseId: id,
          toolName: toolName(item),
          input: toolInput(item),
        });
      }
      if (phase === 'completed') {
        const out: AgentEvent = {
          type: 'tool-result',
          toolUseId: id,
          isError: str(item.status) === 'failed',
        };
        const output = toolOutput(item);
        if (output !== undefined) out.output = output;
        events.push(out);
      }
      return events;
    }

    // reasoning summaries + unknown item kinds: forward-compat passthrough.
    return [{ type: 'raw', agent: 'codex', payload: item }];
  }

  private line(line: string): AgentEvent[] {
    const ev = parseJsonLine(line);
    if (!ev) {
      console.warn('[codex parse] dropping unparseable line', {
        len: line.length,
        head: line.slice(0, 120),
      });
      return [];
    }

    const type = str(ev.type);

    if (type === 'thread.started' || type === 'turn.started') {
      return this.maybeStart(ev);
    }

    const itemPhase =
      type === 'item.started'
        ? ('started' as const)
        : type === 'item.updated'
          ? ('updated' as const)
          : type === 'item.completed'
            ? ('completed' as const)
            : undefined;
    if (itemPhase) {
      const events = this.maybeStart(ev);
      if (isRecord(ev.item)) {
        events.push(...this.item(itemPhase, ev.item));
      }
      return events;
    }

    if (type === 'turn.completed') {
      const events = this.maybeStart(ev);
      const usage = isRecord(ev.usage) ? ev.usage : undefined;
      const inputTokens = num(usage?.input_tokens) ?? 0;
      const outputTokens = num(usage?.output_tokens) ?? 0;
      const cacheReadTokens = num(usage?.cached_input_tokens) ?? 0;
      // Zero-token turns emit NO usage event — a zero row would only pollute
      // metering.
      if (inputTokens > 0 || outputTokens > 0) {
        events.push({
          type: 'usage',
          inputTokens,
          outputTokens,
          ...(cacheReadTokens > 0 && { cacheReadTokens }),
        });
      }
      const result: AgentEvent = { type: 'result', status: 'completed' };
      if (this.sessionId) result.agentSessionId = this.sessionId;
      if (this.finalText) result.finalText = this.finalText;
      events.push(result);
      return events;
    }

    if (type === 'turn.failed') {
      const events = this.maybeStart(ev);
      const message =
        (isRecord(ev.error) ? str(ev.error.message) : undefined) ??
        'Codex turn failed';
      events.push({ type: 'error', message, raw: ev });
      const result: AgentEvent = {
        type: 'result',
        status: 'error',
        isError: true,
      };
      if (this.sessionId) result.agentSessionId = this.sessionId;
      events.push(result);
      return events;
    }

    if (type === 'error') {
      // TRANSIENT stream errors too ("Reconnecting... 1/5" while the CLI
      // retries — observed live); a terminal failure always follows as
      // turn.failed, so these pass through as raw rather than spamming the
      // timeline with error rows.
      return [{ type: 'raw', agent: 'codex', payload: ev }];
    }

    return [{ type: 'raw', agent: 'codex', payload: ev }];
  }
}
