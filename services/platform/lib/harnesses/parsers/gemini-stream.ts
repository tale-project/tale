// Parser family `gemini-stream` — the Gemini CLI `--output-format
// stream-json` NDJSON dialect, shared by the gemini harness and by qwen-code
// (a gemini-cli fork emitting the same stream shapes). Families are keyed by
// the harness YAML's `parser` field; the slug is bound at creation so events
// attribute to the harness that ran.
//
// Native shapes (verified against the pinned CLI's output types + real
// captured runs; see fixtures/gemini/shell-turn.yml):
//   { type: "init", timestamp, session_id, model }
//   { type: "message", timestamp, role: "user"|"assistant", content, delta? }
//   { type: "tool_use", timestamp, tool_name, tool_id, parameters }
//   { type: "tool_result", timestamp, tool_id, status: "success"|"error",
//     output?, error?: { type, message } }
//   { type: "error", timestamp, severity: "warning"|"error", message }
//   { type: "result", timestamp, status: "success"|"error", error?,
//     stats?: { total_tokens, input_tokens, output_tokens, cached, input,
//               duration_ms, tool_calls, models } }

import {
  asNumber,
  asString,
  isRecord,
  LineReassembler,
  parseJsonLine,
} from '../jsonl';
import type {
  HarnessEvent,
  HarnessEventParser,
  HarnessSlug,
  HarnessTurnStatus,
} from '../types';

/** The CLI's turn-cap error (FatalTurnLimitedError, exit code 53): "Reached
 * max session turns for this session. …". Deliberately narrow so a model
 * error mentioning "max_tokens" never reads as an exhausted loop. */
const MAX_TURNS_ERROR = /reached max session turns/i;

function mapRunStatus(
  status: string | undefined,
  error?: string,
): HarnessTurnStatus {
  if (status === 'success') return 'completed';
  if (error !== undefined && MAX_TURNS_ERROR.test(error)) return 'max-turns';
  return status ? 'error' : 'completed';
}

class GeminiStreamParser implements HarnessEventParser {
  private readonly lines = new LineReassembler();
  private started = false;
  private sessionId: string | undefined;
  /** Assistant text accumulated across the turn — the `result` event carries
   * no final text of its own, so the deltas ARE the reply. */
  private assistantText = '';

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

    if (type === 'init') {
      return this.maybeStart(ev);
    }

    if (type === 'message') {
      const events = this.maybeStart(ev);
      // The user message is the CLI echoing our own prompt back — not agent
      // output; emitting it would duplicate the user's bubble in the thread.
      if (asString(ev.role) !== 'assistant') return events;
      const text = asString(ev.content);
      if (text) {
        this.assistantText += text;
        events.push(
          ev.delta === true
            ? { type: 'text-delta', text }
            : { type: 'text', text },
        );
      }
      return events;
    }

    if (type === 'tool_use') {
      const events = this.maybeStart(ev);
      const toolUseId = asString(ev.tool_id);
      if (!toolUseId) {
        events.push({ type: 'raw', harness: this.slug, payload: ev });
        return events;
      }
      events.push({
        type: 'tool-use',
        toolUseId,
        toolName: asString(ev.tool_name) ?? '',
        input: ev.parameters,
      });
      return events;
    }

    if (type === 'tool_result') {
      const events = this.maybeStart(ev);
      const toolUseId = asString(ev.tool_id);
      if (!toolUseId) {
        events.push({ type: 'raw', harness: this.slug, payload: ev });
        return events;
      }
      const out: HarnessEvent = {
        type: 'tool-result',
        toolUseId,
        isError: asString(ev.status) === 'error',
      };
      const output =
        ev.output ??
        (isRecord(ev.error) ? asString(ev.error.message) : undefined);
      if (output !== undefined) out.output = output;
      events.push(out);
      return events;
    }

    if (type === 'error') {
      const events = this.maybeStart(ev);
      const message = asString(ev.message);
      if (message) events.push({ type: 'error', message, raw: ev });
      return events;
    }

    if (type === 'result') {
      const events = this.maybeStart(ev);
      const stats = isRecord(ev.stats) ? ev.stats : undefined;
      const inputTokens = asNumber(stats?.input_tokens) ?? 0;
      const outputTokens = asNumber(stats?.output_tokens) ?? 0;
      // Zero-token runs emit NO usage event — a zero row would only pollute
      // metering (the gateway meters authoritatively either way).
      if (stats && inputTokens + outputTokens > 0) {
        const usage: HarnessEvent = {
          type: 'usage',
          inputTokens,
          outputTokens,
        };
        const cached = asNumber(stats.cached);
        if (cached !== undefined && cached > 0) {
          usage.cacheReadTokens = cached;
        }
        events.push(usage);
      }
      const err = isRecord(ev.error) ? asString(ev.error.message) : undefined;
      const status = mapRunStatus(asString(ev.status), err);
      const result: HarnessEvent = { type: 'turn-ended', status };
      if (this.sessionId) result.sessionId = this.sessionId;
      if (this.assistantText) result.finalText = this.assistantText;
      const durationMs = asNumber(stats?.duration_ms);
      if (durationMs !== undefined) result.durationMs = durationMs;
      if (stats && inputTokens + outputTokens > 0) {
        result.usageTotals = { inputTokens, outputTokens };
      }
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
  return new GeminiStreamParser(slug);
}
