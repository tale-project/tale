// Parser family `openclaw-jsonl` — the tale-openclaw-run NDJSON lifecycle
// dialect. The pinned OpenClaw CLI has no streaming output in headless mode
// (`openclaw agent --local --json` prints ONE final envelope); the wrapper
// owns that translation and emits Tale NDJSON lifecycle events, so a turn
// renders as turn-started → final text → usage → turn-ended and the in-run
// tool timeline is not observable. Close cousin of `hermes-jsonl` but NOT
// identical (see that module's header); kept separate so each harness's
// event handling is byte-for-byte what it was as a per-slug parser.
//
// Shapes (tale-openclaw-run dialect, hermes-style):
//   { schema_version, type: "run_start", session_id, model? }
//   { type: "assistant_message", text }
//   { type: "usage", input, output, cache_read?, cache_write?, model? }
//   { type: "run_end", status: "ok"|"error", session_id?, final_text?,
//     error?, duration_ms? }

import { asNumber, asString, LineReassembler, parseJsonLine } from '../jsonl';
import type {
  HarnessEvent,
  HarnessEventParser,
  HarnessSlug,
  HarnessTurnStatus,
} from '../types';

function mapRunStatus(status: string | undefined): HarnessTurnStatus {
  if (status === 'ok' || status === 'success' || status === 'completed') {
    return 'completed';
  }
  return status ? 'error' : 'completed';
}

class OpenClawJsonlParser implements HarnessEventParser {
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
    const sid = asString(ev.session_id);
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

    if (type === 'assistant_message') {
      const events = this.maybeStart(ev);
      const text = asString(ev.text);
      if (text) events.push({ type: 'text', text });
      return events;
    }

    if (type === 'usage') {
      const events = this.maybeStart(ev);
      const inputTokens = asNumber(ev.input) ?? 0;
      const outputTokens = asNumber(ev.output) ?? 0;
      // Zero-token runs emit NO usage event — a zero row would only pollute
      // metering (the gateway meters authoritatively either way).
      if (inputTokens + outputTokens > 0) {
        const usage: HarnessEvent = {
          type: 'usage',
          inputTokens,
          outputTokens,
        };
        const model = asString(ev.model);
        if (model) usage.model = model;
        const cacheRead = asNumber(ev.cache_read);
        if (cacheRead !== undefined && cacheRead > 0) {
          usage.cacheReadTokens = cacheRead;
        }
        const cacheWrite = asNumber(ev.cache_write);
        if (cacheWrite !== undefined && cacheWrite > 0) {
          usage.cacheWriteTokens = cacheWrite;
        }
        events.push(usage);
      }
      return events;
    }

    if (type === 'run_end') {
      const events = this.maybeStart(ev);
      const sid = asString(ev.session_id);
      if (sid) this.sessionId = sid;
      const err = asString(ev.error);
      const result: HarnessEvent = {
        type: 'turn-ended',
        status: mapRunStatus(asString(ev.status)),
      };
      if (this.sessionId) result.sessionId = this.sessionId;
      const finalText = asString(ev.final_text);
      if (finalText) result.finalText = finalText;
      const durationMs = asNumber(ev.duration_ms);
      if (durationMs !== undefined) result.durationMs = durationMs;
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
  return new OpenClawJsonlParser(slug);
}
