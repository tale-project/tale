// Parser family `hermes-jsonl` — the tale-hermes-run NDJSON lifecycle
// dialect. Close cousin of `openclaw-jsonl` (both are Tale wrapper dialects
// sharing the run_start/assistant_message/run_end skeleton) but NOT
// identical: hermes streams text deltas and tool_call_start/_end events and
// classifies a max-turns error; openclaw has neither and instead carries
// usage and run duration. Kept separate so each harness's event handling is
// byte-for-byte what it was as a per-slug parser.
//
// Native shapes (the tale-hermes-run lifecycle dialect):
//   { schema_version, type: "run_start", model?, session_id? }
//   { type: "text_delta", text }
//   { type: "tool_call_start", call_id, tool, summary? }
//   { type: "tool_call_end", call_id, status, duration_ms? }
//   { type: "assistant_message", text }
//   { type: "session_id", session_id }
//   { type: "run_end", status, session_id?, final_text?, error? }

import { asString, LineReassembler, parseJsonLine } from '../jsonl';
import type {
  HarnessEvent,
  HarnessEventParser,
  HarnessSlug,
  HarnessTurnStatus,
} from '../types';

/** A turn-cap error, not any error that merely mentions "max" (e.g.
 * "max_tokens exceeded" is a model error, not an exhausted loop). */
const MAX_TURNS_ERROR = /max[ _-]?(turn|iteration)/i;

function mapRunStatus(
  status: string | undefined,
  error?: string,
): HarnessTurnStatus {
  if (status === 'ok' || status === 'success' || status === 'completed') {
    return 'completed';
  }
  if (error !== undefined && MAX_TURNS_ERROR.test(error)) return 'max-turns';
  return status ? 'error' : 'completed';
}

class HermesJsonlParser implements HarnessEventParser {
  private readonly lines = new LineReassembler();
  private started = false;
  private sessionId: string | undefined;

  constructor(private readonly slug: HarnessSlug) {}

  feed(chunk: string): HarnessEvent[] {
    return this.lines.push(chunk).flatMap((line) => this.line(line));
  }

  end(): HarnessEvent[] {
    return this.lines.flush().flatMap((line) => this.line(line));
  }

  private maybeStart(ev: Record<string, unknown>): HarnessEvent[] {
    const sid = asString(ev.session_id) ?? asString(ev.sessionId);
    if (sid) this.sessionId = sid;
    if (this.started) return [];
    this.started = true;
    const out: HarnessEvent = { type: 'turn-started', harness: this.slug };
    if (this.sessionId) out.sessionId = this.sessionId;
    const model = asString(ev.model);
    if (model) out.model = model;
    return [out];
  }

  private line(line: string): HarnessEvent[] {
    const ev = parseJsonLine(line);
    if (!ev) {
      console.warn(`[${this.slug} parse] dropping unparseable line`, {
        len: line.length,
        head: line.slice(0, 120),
      });
      return [];
    }

    const type = asString(ev.type);

    if (type === 'run_start') {
      return this.maybeStart(ev);
    }

    if (type === 'text_delta') {
      const events = this.maybeStart(ev);
      const text = asString(ev.text);
      if (text) events.push({ type: 'text-delta', text });
      return events;
    }

    if (type === 'assistant_message') {
      const events = this.maybeStart(ev);
      const text = asString(ev.text);
      if (text) events.push({ type: 'text', text });
      return events;
    }

    if (type === 'tool_call_start') {
      const events = this.maybeStart(ev);
      const callId = asString(ev.call_id);
      if (!callId) {
        events.push({ type: 'raw', harness: this.slug, payload: ev });
        return events;
      }
      events.push({
        type: 'tool-use',
        toolUseId: callId,
        toolName: asString(ev.tool) ?? '',
        input: ev.summary ?? ev.input,
      });
      return events;
    }

    if (type === 'tool_call_end') {
      const events = this.maybeStart(ev);
      const callId = asString(ev.call_id);
      if (!callId) {
        events.push({ type: 'raw', harness: this.slug, payload: ev });
        return events;
      }
      const out: HarnessEvent = {
        type: 'tool-result',
        toolUseId: callId,
        isError: asString(ev.status) === 'error',
      };
      if (ev.output !== undefined) out.output = ev.output;
      events.push(out);
      // No usage event here: tale-hermes-run carries no per-call token
      // counts, and a zero-token usage row would only pollute metering.
      return events;
    }

    if (type === 'session_id') {
      const sid = asString(ev.session_id);
      if (sid) this.sessionId = sid;
      return this.maybeStart(ev);
    }

    if (type === 'run_end') {
      const events = this.maybeStart(ev);
      const sid = asString(ev.session_id);
      if (sid) this.sessionId = sid;
      const err = asString(ev.error);
      const status = mapRunStatus(asString(ev.status), err);
      const result: HarnessEvent = { type: 'turn-ended', status };
      if (this.sessionId) result.sessionId = this.sessionId;
      const finalText = asString(ev.final_text);
      if (finalText) result.finalText = finalText;
      if (err) {
        result.isError = true;
        events.push({ type: 'error', message: err, raw: ev });
      }
      events.push(result);
      return events;
    }

    return [{ type: 'raw', harness: this.slug, payload: ev }];
  }
}

export function createParser(slug: HarnessSlug): HarnessEventParser {
  return new HermesJsonlParser(slug);
}
