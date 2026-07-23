// Parser family `opencode-jsonl` — the `opencode run --format json` JSONL
// dialect. Families are keyed by the harness YAML's `parser` field; the slug
// is bound at creation so events attribute to the harness that ran.
//
// Native shapes:
//   { type: "step_start", sessionID }
//   { type: "text", part: { text } }
//   { type: "tool_use", part: { tool, state: { status, input, output } } }
//   { type: "step_finish", part: { cost, tokens: { input, output, reasoning,
//        cache: { read, write } }, reason: "stop"|"tool-calls" }, sessionID }
//   { type: "error", error: { name, data: { message } } }
//
// The first event carrying a sessionID seeds `turn-started`; the terminal
// `step_finish` with reason "stop" is the run's accounting + result record.

import {
  asNumber,
  asRecord,
  asString,
  LineReassembler,
  parseJsonLine,
} from '../jsonl';
import type { HarnessEvent, HarnessEventParser, HarnessSlug } from '../types';

class OpenCodeJsonlParser implements HarnessEventParser {
  private readonly lines = new LineReassembler();
  private started = false;
  private sessionId: string | undefined;
  /** The most recent completed text part. The terminal step_finish carries
   * no text of its own, so the LAST text part IS the reply (the same
   * semantics as Codex's final agent_message). */
  private lastText: string | undefined;

  constructor(private readonly slug: HarnessSlug) {}

  feed(chunk: string): HarnessEvent[] {
    return this.lines.push(chunk).flatMap((line) => this.line(line));
  }

  end(): HarnessEvent[] {
    return this.lines.flush().flatMap((line) => this.line(line));
  }

  private maybeStart(ev: Record<string, unknown>): HarnessEvent[] {
    const sid = asString(ev.sessionID);
    if (sid) this.sessionId = sid;
    if (this.started) return [];
    this.started = true;
    const out: HarnessEvent = { type: 'turn-started', harness: this.slug };
    if (this.sessionId) out.sessionId = this.sessionId;
    return [out];
  }

  private line(line: string): HarnessEvent[] {
    const ev = parseJsonLine(line);
    if (!ev) {
      // Drop a malformed/truncated line, but log it so a real truncation
      // (e.g. the process died mid-record) isn't silently lost.
      console.warn(`[${this.slug} parse] dropping unparseable line`, {
        len: line.length,
        head: line.slice(0, 120),
      });
      return [];
    }
    const type = asString(ev.type);
    const part = asRecord(ev.part);

    if (type === 'step_start') {
      return this.maybeStart(ev);
    }

    if (type === 'text') {
      const events = this.maybeStart(ev);
      const text = asString(part?.text);
      if (text) {
        this.lastText = text;
        events.push({ type: 'text', text });
      }
      return events;
    }

    if (type === 'tool_use') {
      const events = this.maybeStart(ev);
      const state = asRecord(part?.state);
      const status = asString(state?.status);
      const toolUseId = asString(part?.id) ?? asString(part?.callID);
      if (!toolUseId) {
        // No correlation id — emitting a normalized tool-use/tool-result
        // with an empty id would corrupt downstream pairing. Forward
        // verbatim instead so nothing is silently dropped.
        events.push({ type: 'raw', harness: this.slug, payload: ev });
        return events;
      }
      if (status === 'completed' || status === 'error') {
        const out: HarnessEvent = { type: 'tool-result', toolUseId };
        if (state?.output !== undefined) out.output = state.output;
        if (status === 'error') out.isError = true;
        events.push(out);
      } else {
        events.push({
          type: 'tool-use',
          toolUseId,
          toolName: asString(part?.tool) ?? '',
          input: state?.input,
        });
      }
      return events;
    }

    if (type === 'step_finish') {
      const events = this.maybeStart(ev);
      const tokens = asRecord(part?.tokens);
      const cache = asRecord(tokens?.cache);
      const costUsd = typeof part?.cost === 'number' ? part.cost : undefined;
      events.push({
        type: 'usage',
        inputTokens: asNumber(tokens?.input) ?? 0,
        // Reasoning tokens are billed output — fold them in.
        outputTokens:
          (asNumber(tokens?.output) ?? 0) + (asNumber(tokens?.reasoning) ?? 0),
        cacheReadTokens: asNumber(cache?.read) ?? 0,
        cacheWriteTokens: asNumber(cache?.write) ?? 0,
        ...(costUsd !== undefined ? { costEstimateUsd: costUsd } : {}),
      });
      if (asString(part?.reason) === 'stop') {
        const result: HarnessEvent = {
          type: 'turn-ended',
          status: 'completed',
        };
        if (this.sessionId) result.sessionId = this.sessionId;
        if (this.lastText) result.finalText = this.lastText;
        if (costUsd !== undefined) {
          result.usageTotals = {
            inputTokens: asNumber(tokens?.input) ?? 0,
            outputTokens:
              (asNumber(tokens?.output) ?? 0) +
              (asNumber(tokens?.reasoning) ?? 0),
            costEstimateUsd: costUsd,
          };
        }
        events.push(result);
      }
      return events;
    }

    if (type === 'error') {
      const error = asRecord(ev.error);
      const data = asRecord(error?.data);
      return [
        {
          type: 'error',
          message:
            asString(data?.message) ??
            asString(error?.name) ??
            'opencode error',
          raw: ev,
        },
      ];
    }

    return [{ type: 'raw', harness: this.slug, payload: ev }];
  }
}

export function createParser(slug: HarnessSlug): HarnessEventParser {
  return new OpenCodeJsonlParser(slug);
}
