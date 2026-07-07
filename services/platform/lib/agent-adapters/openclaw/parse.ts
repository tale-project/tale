// OpenClaw `tale-openclaw-run` NDJSON → normalized AgentEvent[].
//
// The pinned OpenClaw CLI (2026.6.11) has no streaming output in headless
// mode: `openclaw agent --local --json` prints ONE final JSON envelope. The
// wrapper owns that translation and emits Tale NDJSON lifecycle events, so
// this parser sees (tale-openclaw-run dialect, hermes-style):
//   { schema_version, type: "run_start", session_id, model? }
//   { type: "assistant_message", text }
//   { type: "usage", input, output, cache_read?, cache_write?, model? }
//   { type: "run_end", status: "ok"|"error", session_id?, final_text?,
//     error?, duration_ms? }

import type {
  AgentEvent,
  AgentEventParser,
  AgentResultStatus,
} from '../events';
import { LineReassembler, parseJsonLine } from '../jsonl';

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function mapRunStatus(status: string | undefined): AgentResultStatus {
  if (status === 'ok' || status === 'success' || status === 'completed') {
    return 'completed';
  }
  return status ? 'error' : 'completed';
}

export class OpenClawParser implements AgentEventParser {
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
    const sid = str(ev.session_id);
    if (sid) this.sessionId = sid;
    if (this.started) return [];
    this.started = true;
    const out: AgentEvent = { type: 'run-started', agent: 'openclaw' };
    if (this.sessionId) out.agentSessionId = this.sessionId;
    const model = str(ev.model);
    if (model) out.model = model;
    return [out];
  }

  private line(line: string): AgentEvent[] {
    const ev = parseJsonLine(line);
    if (!ev) {
      console.warn('[openclaw parse] dropping unparseable line', {
        len: line.length,
        head: line.slice(0, 120),
      });
      return [];
    }

    const type = str(ev.type);

    if (type === 'run_start') {
      return this.maybeStart(ev);
    }

    if (type === 'assistant_message') {
      const events = this.maybeStart(ev);
      const text = str(ev.text);
      if (text) events.push({ type: 'text', text });
      return events;
    }

    if (type === 'usage') {
      const events = this.maybeStart(ev);
      const inputTokens = num(ev.input) ?? 0;
      const outputTokens = num(ev.output) ?? 0;
      // Zero-token runs emit NO usage event — a zero row would only pollute
      // metering (the gateway meters authoritatively either way).
      if (inputTokens + outputTokens > 0) {
        const usage: AgentEvent = { type: 'usage', inputTokens, outputTokens };
        const model = str(ev.model);
        if (model) usage.model = model;
        const cacheRead = num(ev.cache_read);
        if (cacheRead !== undefined && cacheRead > 0) {
          usage.cacheReadTokens = cacheRead;
        }
        const cacheWrite = num(ev.cache_write);
        if (cacheWrite !== undefined && cacheWrite > 0) {
          usage.cacheWriteTokens = cacheWrite;
        }
        events.push(usage);
      }
      return events;
    }

    if (type === 'run_end') {
      const events = this.maybeStart(ev);
      const sid = str(ev.session_id);
      if (sid) this.sessionId = sid;
      const err = str(ev.error);
      const result: AgentEvent = {
        type: 'result',
        status: mapRunStatus(str(ev.status)),
      };
      if (this.sessionId) result.agentSessionId = this.sessionId;
      const finalText = str(ev.final_text);
      if (finalText) result.finalText = finalText;
      const durationMs = num(ev.duration_ms);
      if (durationMs !== undefined) result.durationMs = durationMs;
      if (err) {
        result.isError = true;
        events.push({ type: 'error', message: err, raw: ev });
      }
      events.push(result);
      return events;
    }

    return [{ type: 'raw', agent: 'openclaw', payload: ev }];
  }
}
