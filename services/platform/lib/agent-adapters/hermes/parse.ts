// Hermes `tale-hermes-run` NDJSON → normalized AgentEvent[].
//
// Event shapes (tale-hermes-run / Hermes lifecycle proposal):
//   { schema_version, type: "run_start", model?, session_id? }
//   { type: "text_delta", text }
//   { type: "tool_call_start", call_id, tool, summary? }
//   { type: "tool_call_end", call_id, status, duration_ms? }
//   { type: "assistant_message", text }
//   { type: "session_id", session_id }
//   { type: "run_end", status, session_id?, final_text?, error? }

import type {
  AgentEvent,
  AgentEventParser,
  AgentResultStatus,
} from '../events';
import { LineReassembler, parseJsonLine } from '../jsonl';

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

/** A turn-cap error, not any error that merely mentions "max" (e.g.
 * "max_tokens exceeded" is a model error, not an exhausted loop). */
const MAX_TURNS_ERROR = /max[ _-]?(turn|iteration)/i;

function mapRunStatus(
  status: string | undefined,
  error?: string,
): AgentResultStatus {
  if (status === 'ok' || status === 'success' || status === 'completed') {
    return 'completed';
  }
  if (error !== undefined && MAX_TURNS_ERROR.test(error)) return 'max-turns';
  return status ? 'error' : 'completed';
}

export class HermesParser implements AgentEventParser {
  private readonly lines = new LineReassembler();
  private started = false;
  private sessionId: string | undefined;

  feed(chunk: string): AgentEvent[] {
    return this.lines.push(chunk).flatMap((line) => this.line(line));
  }

  end(): AgentEvent[] {
    return this.lines.flush().flatMap((line) => this.line(line));
  }

  private maybeStart(ev: Record<string, unknown>): AgentEvent[] {
    const sid = str(ev.session_id) ?? str(ev.sessionId);
    if (sid) this.sessionId = sid;
    if (this.started) return [];
    this.started = true;
    const out: AgentEvent = { type: 'run-started', agent: 'hermes' };
    if (this.sessionId) out.agentSessionId = this.sessionId;
    const model = str(ev.model);
    if (model) out.model = model;
    return [out];
  }

  private line(line: string): AgentEvent[] {
    const ev = parseJsonLine(line);
    if (!ev) {
      console.warn('[hermes parse] dropping unparseable line', {
        len: line.length,
        head: line.slice(0, 120),
      });
      return [];
    }

    const type = str(ev.type);

    if (type === 'run_start') {
      return this.maybeStart(ev);
    }

    if (type === 'text_delta') {
      const events = this.maybeStart(ev);
      const text = str(ev.text);
      if (text) events.push({ type: 'text-delta', text });
      return events;
    }

    if (type === 'assistant_message') {
      const events = this.maybeStart(ev);
      const text = str(ev.text);
      if (text) events.push({ type: 'text', text });
      return events;
    }

    if (type === 'tool_call_start') {
      const events = this.maybeStart(ev);
      const callId = str(ev.call_id);
      if (!callId) {
        events.push({ type: 'raw', agent: 'hermes', payload: ev });
        return events;
      }
      events.push({
        type: 'tool-use',
        toolUseId: callId,
        toolName: str(ev.tool) ?? '',
        input: ev.summary ?? ev.input,
      });
      return events;
    }

    if (type === 'tool_call_end') {
      const events = this.maybeStart(ev);
      const callId = str(ev.call_id);
      if (!callId) {
        events.push({ type: 'raw', agent: 'hermes', payload: ev });
        return events;
      }
      const out: AgentEvent = {
        type: 'tool-result',
        toolUseId: callId,
        isError: str(ev.status) === 'error',
      };
      if (ev.output !== undefined) out.output = ev.output;
      events.push(out);
      // No usage event here: tale-hermes-run carries no per-call token counts,
      // and a zero-token usage row would only pollute metering.
      return events;
    }

    if (type === 'session_id') {
      const sid = str(ev.session_id);
      if (sid) this.sessionId = sid;
      return this.maybeStart(ev);
    }

    if (type === 'run_end') {
      const events = this.maybeStart(ev);
      const sid = str(ev.session_id);
      if (sid) this.sessionId = sid;
      const err = str(ev.error);
      const status = mapRunStatus(str(ev.status), err);
      const result: AgentEvent = { type: 'result', status };
      if (this.sessionId) result.agentSessionId = this.sessionId;
      const finalText = str(ev.final_text);
      if (finalText) result.finalText = finalText;
      if (err) {
        result.isError = true;
        events.push({ type: 'error', message: err, raw: ev });
      }
      events.push(result);
      return events;
    }

    return [{ type: 'raw', agent: 'hermes', payload: ev }];
  }
}
