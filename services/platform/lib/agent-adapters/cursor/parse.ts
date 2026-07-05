// Cursor `agent -p --output-format stream-json` NDJSON → AgentEvent[].
//
// Mapping contract (Phase 1):
//   system/init + session_id     → run-started + agentSessionId
//   assistant (complete blocks)  → text
//   tool_call started/completed  → tool-use / tool-result
//   result                       → result + finalText + isError
//   unknown / missing call_id    → raw

import type { AgentEvent, AgentEventParser } from '../events';
import { isRecord, LineReassembler, parseJsonLine } from '../jsonl';

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}
function obj(v: unknown): Record<string, unknown> | undefined {
  return isRecord(v) ? v : undefined;
}

function normalizeToolName(raw: string): string {
  if (raw === 'readToolCall') return 'Read';
  if (raw === 'writeToolCall') return 'Write';
  if (raw === 'shellToolCall') return 'Bash';
  // Generic `<verb>ToolCall` wrapper key → the bare verb (e.g. `lsToolCall` →
  // `ls`), so an unmapped tool still renders with a real name, never blank.
  const m = /^(.+)ToolCall$/.exec(raw);
  return m?.[1] ?? raw;
}

/**
 * Cursor wraps each tool call as `tool_call: { <toolKey>: { args, result } }` —
 * the tool NAME is the single wrapper KEY (`shellToolCall`, `readToolCall`, …)
 * and its args/result live INSIDE, not on the wrapper. Unwrap that here.
 * Falls back to the flat `{ tool|name, input|args, result|output }` shape (the
 * hand-authored fixture form) so both are handled.
 */
function unwrapToolCall(wrapper: Record<string, unknown>): {
  name: string;
  inner: Record<string, unknown>;
} {
  const flatName = str(wrapper.tool) ?? str(wrapper.name);
  if (flatName) return { name: normalizeToolName(flatName), inner: wrapper };
  const keys = Object.keys(wrapper);
  const toolKey =
    keys.find((k) => k.endsWith('ToolCall')) ??
    keys.find((k) => isRecord(wrapper[k]));
  if (toolKey) {
    return {
      name: normalizeToolName(toolKey),
      inner: obj(wrapper[toolKey]) ?? wrapper,
    };
  }
  return { name: '', inner: wrapper };
}

export class CursorParser implements AgentEventParser {
  private readonly lines = new LineReassembler();
  private started = false;
  private sessionId: string | undefined;
  private finalTextParts: string[] = [];

  feed(chunk: string): AgentEvent[] {
    return this.lines.push(chunk).flatMap((line) => this.line(line));
  }

  end(): AgentEvent[] {
    return this.lines.flush().flatMap((line) => this.line(line));
  }

  private maybeStart(sessionId?: string): AgentEvent[] {
    if (sessionId) this.sessionId = sessionId;
    if (this.started) return [];
    this.started = true;
    const out: AgentEvent = { type: 'run-started', agent: 'cursor' };
    if (this.sessionId) out.agentSessionId = this.sessionId;
    return [out];
  }

  private line(line: string): AgentEvent[] {
    const ev = parseJsonLine(line);
    if (!ev) {
      console.warn('[cursor parse] dropping unparseable line', {
        len: line.length,
        head: line.slice(0, 120),
      });
      return [];
    }

    const type = str(ev.type);
    const subtype = str(ev.subtype);

    if (type === 'system' && subtype === 'init') {
      const sid = str(ev.session_id) ?? str(ev.sessionId);
      return this.maybeStart(sid);
    }

    if (type === 'assistant') {
      const events = this.maybeStart(
        str(ev.session_id) ?? str(ev.sessionId) ?? this.sessionId,
      );
      const message = obj(ev.message);
      const content = message?.content;
      let text = '';
      if (typeof content === 'string') {
        text = content;
      } else if (Array.isArray(content)) {
        text = content
          .map((part) => {
            const p = obj(part);
            return str(p?.text) ?? '';
          })
          .join('');
      } else {
        text = str(ev.text) ?? str(message?.text) ?? '';
      }
      if (text) {
        events.push({ type: 'text', text });
        this.finalTextParts.push(text);
      }
      return events;
    }

    if (type === 'tool_call') {
      const events = this.maybeStart(this.sessionId);
      const callId = str(ev.call_id) ?? str(ev.callId) ?? str(ev.id);
      if (!callId) {
        events.push({ type: 'raw', agent: 'cursor', payload: ev });
        return events;
      }
      const toolCall = obj(ev.tool_call) ?? obj(ev.toolCall) ?? ev;
      const { name: unwrappedName, inner } = unwrapToolCall(toolCall);
      const toolName =
        unwrappedName ||
        normalizeToolName(str(ev.tool) ?? str(ev.tool_name) ?? '');
      if (subtype === 'completed' || subtype === 'complete') {
        const result: AgentEvent = {
          type: 'tool-result',
          toolUseId: callId,
        };
        const output =
          inner.result ?? inner.output ?? toolCall.result ?? ev.result;
        if (output !== undefined) result.output = output;
        // Shell/tool failure lives in the nested result (`failure`/`error` key
        // or a non-zero exitCode) as well as the top-level is_error flag.
        const innerResult = obj(inner.result);
        const success = obj(innerResult?.success);
        const hasFailure =
          innerResult?.failure !== undefined ||
          innerResult?.error !== undefined ||
          (success?.exitCode !== undefined && success.exitCode !== 0);
        if (ev.is_error === true || ev.isError === true || hasFailure) {
          result.isError = true;
        }
        events.push(result);
      } else {
        events.push({
          type: 'tool-use',
          toolUseId: callId,
          toolName,
          // Default to `{}` so the persisted tool-call part always carries an
          // `input` field (the message validator rejects a tool-call missing
          // both `input` and `args`; `undefined` is dropped on serialize).
          input: inner.args ?? inner.input ?? toolCall.input ?? ev.input ?? {},
        });
      }
      return events;
    }

    if (type === 'result') {
      const events = this.maybeStart(
        str(ev.session_id) ?? str(ev.sessionId) ?? this.sessionId,
      );
      const sid = str(ev.session_id) ?? str(ev.sessionId);
      if (sid) this.sessionId = sid;
      const isError =
        ev.is_error === true ||
        ev.isError === true ||
        str(ev.status) === 'error';
      const resultText =
        str(ev.result) ??
        str(ev.final_text) ??
        str(ev.finalText) ??
        this.finalTextParts.join('\n');
      const result: AgentEvent = {
        type: 'result',
        status: isError ? 'error' : 'completed',
        isError,
      };
      if (this.sessionId) result.agentSessionId = this.sessionId;
      if (resultText) result.finalText = resultText;
      events.push(result);
      return events;
    }

    if (type === 'error') {
      const events = this.maybeStart(this.sessionId);
      const message =
        str(ev.message) ?? str(obj(ev.error)?.message) ?? 'Cursor agent error';
      events.push({ type: 'error', message, raw: ev });
      return events;
    }

    return [{ type: 'raw', agent: 'cursor', payload: ev }];
  }
}
