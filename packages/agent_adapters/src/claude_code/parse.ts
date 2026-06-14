// Claude Code `--output-format stream-json` → normalized AgentEvent[].
//
// Event shapes (verified against the headless docs):
//   { type: "system", subtype: "init", session_id, data: { model } }
//   { type: "stream_event", event: { delta: { type: "text_delta", text } } }
//   { type: "assistant", message: { id, usage, content: [ {type:"text"...},
//                                    {type:"tool_use", id, name, input} ] } }
//   { type: "user", message: { content: [ {type:"tool_result",
//                                          tool_use_id, is_error} ] } }
//   { type: "result", subtype: "success"|"error_max_turns"|..., session_id,
//                      total_cost_usd, result }
//   { type: "system", subtype: "api_retry", ... }  → raw
//
// Usage rides on assistant messages and is deduped by message.id: when Claude
// uses tools in parallel the same message id repeats, and counting each would
// double-bill.

import type {
  AgentEvent,
  AgentEventParser,
  AgentResultStatus,
} from '../events';
import { isRecord, LineReassembler, parseJsonLine } from '../jsonl';

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}
function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}
function obj(v: unknown): Record<string, unknown> | undefined {
  return isRecord(v) ? v : undefined;
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function mapResultStatus(subtype: string | undefined): AgentResultStatus {
  switch (subtype) {
    case 'success':
      return 'completed';
    case 'error_max_turns':
      return 'max-turns';
    default:
      return subtype ? 'error' : 'completed';
  }
}

export class ClaudeCodeParser implements AgentEventParser {
  private readonly lines = new LineReassembler();
  private readonly seenUsageMsgIds = new Set<string>();

  feed(chunk: string): AgentEvent[] {
    return this.lines.push(chunk).flatMap((line) => this.line(line));
  }

  end(): AgentEvent[] {
    return this.lines.flush().flatMap((line) => this.line(line));
  }

  private line(line: string): AgentEvent[] {
    const ev = parseJsonLine(line);
    if (!ev) {
      // A malformed/truncated line (e.g. the process died mid-record on the
      // end() flush) is dropped — but log it so a real truncation isn't silent.
      console.warn('[claude-code parse] dropping unparseable line', {
        len: line.length,
        head: line.slice(0, 120),
      });
      return [];
    }
    const type = str(ev.type);

    if (type === 'system') {
      const subtype = str(ev.subtype);
      if (subtype === 'init') {
        const data = obj(ev.data);
        const out: AgentEvent = {
          type: 'run-started',
          agent: 'claude-code',
        };
        const sid = str(ev.session_id);
        if (sid) out.agentSessionId = sid;
        const model = str(data?.model);
        if (model) out.model = model;
        return [out];
      }
      // Background-task ledger (verified on 2.1.173): task_started opens an
      // entry; task_notification (status completed|stopped) settles it. The
      // drain balances these to know whether a post-`result` process is
      // lingering on background work (no stdin EOF yet) or safe to close.
      if (subtype === 'task_started') {
        const taskId = str(ev.task_id);
        if (taskId) {
          const out: AgentEvent = { type: 'task-started', taskId };
          const description = str(ev.description);
          if (description) out.description = description;
          return [out];
        }
      }
      if (subtype === 'task_notification') {
        const taskId = str(ev.task_id);
        if (taskId) {
          const out: AgentEvent = { type: 'task-settled', taskId };
          const status = str(ev.status);
          if (status) out.status = status;
          return [out];
        }
      }
      // api_retry and other system events: pass through for observability.
      return [{ type: 'raw', agent: 'claude-code', payload: ev }];
    }

    if (type === 'stream_event') {
      const inner = obj(ev.event);
      const delta = obj(inner?.delta);
      if (str(delta?.type) === 'text_delta') {
        const text = str(delta?.text);
        if (text) {
          // Sub-agent deltas carry the parent Task's tool_use id at top level,
          // same as the completed assistant/user events — propagate it so the
          // drain doesn't count sub-agent streaming as main-loop activity.
          const parentToolUseId = str(ev.parent_tool_use_id);
          return [
            {
              type: 'text-delta',
              text,
              ...(parentToolUseId ? { parentToolUseId } : {}),
            },
          ];
        }
      }
      return [];
    }

    if (type === 'assistant') {
      const message = obj(ev.message);
      const events: AgentEvent[] = [];
      // Top-level (sibling of `message`): the parent Task's tool_use id when a
      // sub-agent emitted this message, `null`/absent for the main agent. `str`
      // coalesces `null` → undefined, so main-agent events carry no field.
      const parentToolUseId = str(ev.parent_tool_use_id);
      for (const block of arr(message?.content)) {
        const b = obj(block);
        const bt = str(b?.type);
        if (bt === 'text') {
          const text = str(b?.text);
          if (text) {
            events.push({
              type: 'text',
              text,
              ...(parentToolUseId ? { parentToolUseId } : {}),
            });
          }
        } else if (bt === 'tool_use') {
          events.push({
            type: 'tool-use',
            toolUseId: str(b?.id) ?? '',
            toolName: str(b?.name) ?? '',
            input: b?.input,
            ...(parentToolUseId ? { parentToolUseId } : {}),
          });
        }
      }
      // Usage, deduped by message id.
      const msgId = str(message?.id);
      const usage = obj(message?.usage);
      if (usage && (!msgId || !this.seenUsageMsgIds.has(msgId))) {
        if (msgId) this.seenUsageMsgIds.add(msgId);
        events.push({
          type: 'usage',
          ...(str(message?.model) ? { model: str(message?.model) } : {}),
          inputTokens: num(usage.input_tokens),
          outputTokens: num(usage.output_tokens),
          cacheReadTokens: num(usage.cache_read_input_tokens),
          cacheWriteTokens: num(usage.cache_creation_input_tokens),
          // Sub-agent usage must not read as main-loop activity (quiet-idle).
          ...(parentToolUseId ? { parentToolUseId } : {}),
        });
      }
      return events;
    }

    if (type === 'user') {
      const message = obj(ev.message);
      const events: AgentEvent[] = [];
      // A sub-agent's tool results arrive on a `user` event carrying the parent
      // Task's tool_use id at top level (same as the matching assistant events).
      const parentToolUseId = str(ev.parent_tool_use_id);
      for (const block of arr(message?.content)) {
        const b = obj(block);
        const bt = str(b?.type);
        if (bt === 'tool_result') {
          const out: AgentEvent = {
            type: 'tool-result',
            toolUseId: str(b?.tool_use_id) ?? '',
          };
          if (b?.content !== undefined) out.output = b.content;
          if (typeof b?.is_error === 'boolean') out.isError = b.is_error;
          if (parentToolUseId) out.parentToolUseId = parentToolUseId;
          events.push(out);
        } else if (bt === 'text') {
          // Steer-hook injection surfacing as a synthetic user message. Only
          // the Stop-hook path emits this ("Stop hook feedback:\n[TALE_STEER
          // ids=...] ..." — verified against CLI 2.1.173); PostToolUse
          // additionalContext never reaches stdout. Non-matching user text
          // blocks keep the previous behavior (dropped).
          const text = str(b?.text);
          const match = text?.match(/\[TALE_STEER ids=([^\]]*)\]/);
          if (text && match?.[1]) {
            events.push({
              type: 'steer-injected',
              messageIds: match[1].split(',').filter(Boolean),
              text,
            });
          }
        }
      }
      return events;
    }

    if (type === 'result') {
      const out: AgentEvent = {
        type: 'result',
        status: mapResultStatus(str(ev.subtype)),
      };
      const sid = str(ev.session_id);
      if (sid) out.agentSessionId = sid;
      const finalText = str(ev.result);
      if (finalText) out.finalText = finalText;
      if (typeof ev.duration_ms === 'number') out.durationMs = ev.duration_ms;
      if (typeof ev.total_cost_usd === 'number') {
        out.usageTotals = {
          inputTokens: 0,
          outputTokens: 0,
          costEstimateUsd: ev.total_cost_usd,
        };
      }
      return [out];
    }

    // Unmapped event type — forward verbatim so nothing is silently dropped.
    return [{ type: 'raw', agent: 'claude-code', payload: ev }];
  }
}
