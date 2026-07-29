// Parser family `pi-jsonl` — the Pi `--mode json` NDJSON dialect as driven
// through the tale-pi-run wrapper. Families are keyed by the harness YAML's
// `parser` field; the slug is bound at creation so events attribute to the
// harness that ran.
//
// Native shapes (verified against the pinned CLI's json docs + typings, plus
// real captured runs; see fixtures/pi/shell-turn.yml):
//   { type: "session", version: 3, id, timestamp, cwd }        ← first line
//   { type: "agent_start" } / { type: "agent_end", messages }
//   { type: "turn_start" } / { type: "turn_end", message, toolResults }
//   { type: "message_start" | "message_end", message }
//   { type: "message_update", message, assistantMessageEvent:
//       { type: "text_delta" | "thinking_delta" | "toolcall_*", delta?, … } }
//   { type: "tool_execution_start", toolCallId, toolName, args }
//   { type: "tool_execution_end", toolCallId, toolName, result, isError }
//   { type: "auto_retry_start", attempt, maxAttempts, errorMessage }
//   { type: "auto_retry_end", success, attempt, finalError? }
// AssistantMessage: { role: "assistant", content: [text|thinking|toolCall],
//   model, usage: { input, output, cacheRead, cacheWrite, totalTokens,
//   cost: { total } }, stopReason: "stop"|"length"|"toolUse"|"error"|
//   "aborted", errorMessage? }
//
// Retry semantics (observed on a real dead-gateway run): a failed model call
// ends its cycle with a normal `agent_end`, then pi may retry —
// `auto_retry_start` → a fresh agent_start/agent_end cycle → `auto_retry_end`.
// So an ERROR `agent_end` is never terminal by itself: the parser HOLDS the
// error result and only emits it when the stream ends (or `auto_retry_end`
// reports failure); a successful retried cycle emits `completed` instead.
//
// The wrapper (tale-pi-run) reports its own failures as
// { type: "wrapper_error", message } — not a Pi event; defined by the
// wrapper.

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

/** Text blocks of an assistant message, joined. Pi's terminal `agent_end`
 * carries no final text of its own — the LAST assistant message IS the reply
 * (matches `pi -p` text mode, which prints the last message's text
 * blocks). */
function assistantText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .filter(
      (b): b is { type: string; text: string } =>
        isRecord(b) && b.type === 'text' && typeof b.text === 'string',
    )
    .map((b) => b.text)
    .join('');
}

class PiJsonlParser implements HarnessEventParser {
  private readonly lines = new LineReassembler();
  private started = false;
  private sessionId: string | undefined;
  private resultEmitted = false;
  /** Reply text = the LAST assistant message's text blocks (not a concat of
   * every cycle — an auto-retried turn must not repeat the failed cycle). */
  private lastText = '';
  /** Terminal state of the most recent assistant message. */
  private lastStopReason: string | undefined;
  private lastError: string | undefined;
  /** Turn totals across cycles — retried cycles consumed real tokens too. */
  private totalInput = 0;
  private totalOutput = 0;

  constructor(private readonly slug: HarnessSlug) {}

  feed(chunk: string): HarnessEvent[] {
    return this.lines.push(chunk).flatMap((line) => this.line(line));
  }

  end(): HarnessEvent[] {
    const events = this.lines.flush().flatMap((line) => this.line(line));
    // A held error `agent_end` with no retry (or a truncated retry loop) is
    // finalized here — the process exiting IS the terminal signal.
    if (!this.resultEmitted && this.lastStopReason !== undefined) {
      events.push(...this.result());
    }
    return events;
  }

  private maybeStart(ev: Record<string, unknown>): HarnessEvent[] {
    const sid = asString(ev.id);
    if (sid) this.sessionId = sid;
    if (this.started) return [];
    this.started = true;
    const out: HarnessEvent = { type: 'turn-started', harness: this.slug };
    if (this.sessionId) out.sessionId = this.sessionId;
    return [out];
  }

  private result(): HarnessEvent[] {
    this.resultEmitted = true;
    const isError =
      this.lastStopReason === 'error' || this.lastStopReason === 'aborted';
    const status: HarnessTurnStatus =
      this.lastStopReason === 'aborted'
        ? 'cancelled'
        : isError
          ? 'error'
          : 'completed';
    const events: HarnessEvent[] = [];
    const result: HarnessEvent = { type: 'turn-ended', status };
    if (this.sessionId) result.sessionId = this.sessionId;
    if (this.lastText) result.finalText = this.lastText;
    if (this.totalInput + this.totalOutput > 0) {
      result.usageTotals = {
        inputTokens: this.totalInput,
        outputTokens: this.totalOutput,
      };
    }
    if (isError) {
      result.isError = true;
      if (this.lastError) {
        events.push({ type: 'error', message: this.lastError });
      }
    }
    events.push(result);
    return events;
  }

  private assistantEnd(message: Record<string, unknown>): HarnessEvent[] {
    const events: HarnessEvent[] = [];
    this.lastStopReason = asString(message.stopReason) ?? 'stop';
    this.lastError = asString(message.errorMessage);
    const text = assistantText(message.content);
    if (text) this.lastText = text;
    const usage = isRecord(message.usage) ? message.usage : undefined;
    const inputTokens = asNumber(usage?.input) ?? 0;
    const outputTokens = asNumber(usage?.output) ?? 0;
    // Zero-token messages (e.g. a failed call that never reached the model)
    // emit NO usage event — a zero row would only pollute metering (the
    // gateway meters authoritatively either way).
    if (usage && inputTokens + outputTokens > 0) {
      this.totalInput += inputTokens;
      this.totalOutput += outputTokens;
      const out: HarnessEvent = { type: 'usage', inputTokens, outputTokens };
      const model = asString(message.model);
      if (model) out.model = model;
      const cacheRead = asNumber(usage.cacheRead);
      if (cacheRead !== undefined && cacheRead > 0) {
        out.cacheReadTokens = cacheRead;
      }
      const cacheWrite = asNumber(usage.cacheWrite);
      if (cacheWrite !== undefined && cacheWrite > 0) {
        out.cacheWriteTokens = cacheWrite;
      }
      const cost = isRecord(usage.cost)
        ? asNumber(usage.cost.total)
        : undefined;
      if (cost !== undefined && cost > 0) out.costEstimateUsd = cost;
      events.push(out);
    }
    return events;
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

    if (type === 'session') {
      return this.maybeStart(ev);
    }

    if (type === 'message_update') {
      const events = this.maybeStart(ev);
      const ame = isRecord(ev.assistantMessageEvent)
        ? ev.assistantMessageEvent
        : undefined;
      // Only assistant TEXT streams to the UI — thinking + toolcall deltas
      // stay internal (tool_execution_start carries the parsed call).
      if (ame && asString(ame.type) === 'text_delta') {
        const delta = asString(ame.delta);
        if (delta) events.push({ type: 'text-delta', text: delta });
      }
      return events;
    }

    if (type === 'message_end') {
      const events = this.maybeStart(ev);
      const message = isRecord(ev.message) ? ev.message : undefined;
      // user message_end is the CLI echoing our own prompt back; toolResult
      // message_end duplicates tool_execution_end — both are not agent
      // output.
      if (message && asString(message.role) === 'assistant') {
        events.push(...this.assistantEnd(message));
      }
      return events;
    }

    if (type === 'tool_execution_start') {
      const events = this.maybeStart(ev);
      const toolUseId = asString(ev.toolCallId);
      if (!toolUseId) {
        events.push({ type: 'raw', harness: this.slug, payload: ev });
        return events;
      }
      events.push({
        type: 'tool-use',
        toolUseId,
        toolName: asString(ev.toolName) ?? '',
        input: ev.args,
      });
      return events;
    }

    if (type === 'tool_execution_end') {
      const events = this.maybeStart(ev);
      const toolUseId = asString(ev.toolCallId);
      if (!toolUseId) {
        events.push({ type: 'raw', harness: this.slug, payload: ev });
        return events;
      }
      const out: HarnessEvent = {
        type: 'tool-result',
        toolUseId,
        isError: ev.isError === true,
      };
      if (ev.result !== undefined) out.output = ev.result;
      events.push(out);
      return events;
    }

    if (type === 'agent_end') {
      const events = this.maybeStart(ev);
      // An error cycle may be followed by an auto-retry — hold the error
      // result until the stream ends. A clean cycle is terminal: print mode
      // sends exactly one prompt, so nothing follows a successful agent_end.
      if (
        !this.resultEmitted &&
        this.lastStopReason !== 'error' &&
        this.lastStopReason !== 'aborted'
      ) {
        events.push(...this.result());
      }
      return events;
    }

    if (type === 'auto_retry_start') {
      // A retry cycle follows — the held error is no longer terminal.
      this.lastStopReason = undefined;
      this.lastError = undefined;
      return this.maybeStart(ev);
    }

    if (type === 'auto_retry_end') {
      const events = this.maybeStart(ev);
      if (ev.success !== true && !this.resultEmitted) {
        const finalError = asString(ev.finalError);
        if (finalError) {
          this.lastStopReason = 'error';
          this.lastError = finalError;
        }
        if (this.lastStopReason !== undefined) events.push(...this.result());
      }
      return events;
    }

    // Wrapper-reported failure (tale-pi-run dialect, not a Pi event).
    if (type === 'wrapper_error') {
      const events = this.maybeStart(ev);
      const message = asString(ev.message) ?? 'tale-pi-run wrapper failure';
      events.push({ type: 'error', message, raw: ev });
      if (!this.resultEmitted) {
        this.resultEmitted = true;
        const result: HarnessEvent = {
          type: 'turn-ended',
          status: 'error',
          isError: true,
        };
        if (this.sessionId) result.sessionId = this.sessionId;
        events.push(result);
      }
      return events;
    }

    // Known high-frequency lifecycle noise — consumed, not surfaced.
    if (
      type === 'agent_start' ||
      type === 'turn_start' ||
      type === 'turn_end' ||
      type === 'message_start' ||
      type === 'tool_execution_update' ||
      type === 'queue_update' ||
      type === 'compaction_start' ||
      type === 'compaction_end'
    ) {
      return this.maybeStart(ev);
    }

    return [{ type: 'raw', harness: this.slug, payload: ev }];
  }
}

export function createParser(slug: HarnessSlug): HarnessEventParser {
  return new PiJsonlParser(slug);
}
