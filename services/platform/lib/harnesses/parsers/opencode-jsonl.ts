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
// `step_finish` with reason "stop" is the result record, and the turn's
// accounting is the sum of every `step_finish` (one per model call).

import {
  asNumber,
  asRecord,
  asString,
  BoundedIdLedger,
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
  /** The CLI usually emits only a completed tool part; a running phase is
   * optional. Every result still needs one named call in the transcript. */
  private readonly toolStarted = new BoundedIdLedger();
  /** The turn's totals so far. Every step (one model call) finishes with
   * its own counts, so the turn's are their sum — the terminal step alone
   * is only the last call. */
  private turnInput = 0;
  private turnOutput = 0;
  private turnCostUsd: number | undefined;

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
      if (!this.toolStarted.has(toolUseId)) {
        this.toolStarted.add(toolUseId);
        events.push({
          type: 'tool-use',
          toolUseId,
          toolName: asString(part?.tool) ?? '',
          input: state?.input,
        });
      }
      if (status === 'completed' || status === 'error') {
        const out: HarnessEvent = { type: 'tool-result', toolUseId };
        const output = state?.output ?? state?.error;
        if (output !== undefined) out.output = output;
        if (status === 'error') out.isError = true;
        events.push(out);
      }
      return events;
    }

    if (type === 'step_finish') {
      const events = this.maybeStart(ev);
      const tokens = asRecord(part?.tokens);
      const cache = asRecord(tokens?.cache);
      const costUsd = typeof part?.cost === 'number' ? part.cost : undefined;
      const inputTokens = asNumber(tokens?.input) ?? 0;
      const cacheReadTokens = asNumber(cache?.read) ?? 0;
      const cacheWriteTokens = asNumber(cache?.write) ?? 0;
      // Reasoning tokens are billed output — fold them in.
      const outputTokens =
        (asNumber(tokens?.output) ?? 0) + (asNumber(tokens?.reasoning) ?? 0);
      events.push({
        type: 'usage',
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheWriteTokens,
        ...(costUsd !== undefined ? { costEstimateUsd: costUsd } : {}),
      });
      // OpenCode's `input` is the uncached remainder (1.17.3 reports a
      // 1000-token prompt with 400 cached as input 600, cache read 400).
      this.turnInput += inputTokens + cacheReadTokens + cacheWriteTokens;
      this.turnOutput += outputTokens;
      if (costUsd !== undefined) {
        this.turnCostUsd = (this.turnCostUsd ?? 0) + costUsd;
      }
      if (asString(part?.reason) === 'stop') {
        const result: HarnessEvent = {
          type: 'turn-ended',
          status: 'completed',
        };
        if (this.sessionId) result.sessionId = this.sessionId;
        if (this.lastText) result.finalText = this.lastText;
        if (this.turnCostUsd !== undefined) {
          result.usageTotals = {
            inputTokens: this.turnInput,
            outputTokens: this.turnOutput,
            costEstimateUsd: this.turnCostUsd,
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
