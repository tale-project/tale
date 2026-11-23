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
//   { type: "entry_appended", … }                 ← a session entry (1.x)
//   { type: "agent_settled", aborted? }           ← LAST: nothing more follows
//     (1.0.x carries no `aborted`; observed on 1.0.1 and 1.6.0)
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
// No `agent_end` is terminal by itself either: a steer, a follow-up, a retry
// or a compaction can start another run after it. `agent_settled` says that
// nothing more will happen, so the turn ends there. A stream that ends
// without it (a CLI before 1.0) ends at its last clean `agent_end`.
//
// The wrapper (tale-pi-run) reports its own failures as
// { type: "wrapper_error", message } — not a Pi event; defined by the
// wrapper.
//
// RPC mode (`tale-pi-run --rpc`, the steerable one) streams the same events
// with no session header — the wrapper prints { type: "session", id } for
// the session it names — and answers each command on stdin:
//   { type: "response", command, success, data? | error? }
// A refused prompt starts no run, so it ends the turn with its error; a
// prompt Pi handled without a run (disposition "handled") ends it too. A
// steer's answer changes nothing; a refused one is surfaced as raw.

import { z } from 'zod';

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

/**
 * One newline-terminated command of Pi's RPC mode (`pi --mode rpc`): the
 * turn's prompt, and a steer the platform pushes while it runs, which Pi
 * delivers after the current assistant turn's tool calls, before its next
 * model call. The single source for both, so they cannot drift.
 */
export function buildPiRpcCommand(
  type: 'prompt' | 'steer',
  message: string,
): string {
  return `${JSON.stringify({ type, message })}\n`;
}

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

const checkpointSchema = z.object({
  lines: z.string(),
  started: z.boolean(),
  sessionId: z.string().optional(),
  resultEmitted: z.boolean(),
  lastText: z.string(),
  lastStopReason: z.string().optional(),
  lastError: z.string().optional(),
  cleanEnd: z.boolean().optional(),
  totalInput: z.number(),
  totalOutput: z.number(),
});

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
  /** Whether the last run ended cleanly (`agent_end` after a message that
   * was neither an error nor aborted): the end of a stream that never
   * settled. */
  private cleanEnd = false;
  /** Turn totals across cycles — retried cycles consumed real tokens too.
   * pi-ai's `input` is only the uncached remainder (it subtracts cached
   * tokens from an OpenAI prompt count and keeps Anthropic's split), so
   * the input total adds each message's cache reads and writes back. */
  private totalInput = 0;
  private totalOutput = 0;

  constructor(private readonly slug: HarnessSlug) {}

  snapshot(): Record<string, unknown> {
    return {
      lines: this.lines.snapshot(),
      started: this.started,
      sessionId: this.sessionId,
      resultEmitted: this.resultEmitted,
      lastText: this.lastText,
      lastStopReason: this.lastStopReason,
      lastError: this.lastError,
      cleanEnd: this.cleanEnd,
      totalInput: this.totalInput,
      totalOutput: this.totalOutput,
    };
  }

  restore(value: unknown): void {
    const state = checkpointSchema.parse(value);
    this.lines.restore(state.lines);
    this.started = state.started;
    this.sessionId = state.sessionId;
    this.resultEmitted = state.resultEmitted;
    this.lastText = state.lastText;
    this.lastStopReason = state.lastStopReason;
    this.lastError = state.lastError;
    this.cleanEnd = state.cleanEnd ?? false;
    this.totalInput = state.totalInput;
    this.totalOutput = state.totalOutput;
  }

  feed(chunk: string): HarnessEvent[] {
    return this.lines.push(chunk).flatMap((line) => this.line(line));
  }

  end(): HarnessEvent[] {
    const events = this.lines.flush().flatMap((line) => this.line(line));
    // A stream that never settled ends at a held failure or at its last
    // clean agent_end. A successful model message (including a toolUse stop)
    // with no agent_end after it does not finish the agent loop: the process
    // may have died before executing its tools. Leave that exit without a
    // result so the host reports an interrupted turn.
    if (
      !this.resultEmitted &&
      (this.cleanEnd ||
        this.lastStopReason === 'error' ||
        this.lastStopReason === 'aborted')
    ) {
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
      this.totalInput += inputTokens + (cacheRead ?? 0) + (cacheWrite ?? 0);
      this.totalOutput += outputTokens;
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
      // One run ended. Another may follow (an auto-retry after an error
      // cycle, a steer, a follow-up), so the turn ends at agent_settled.
      this.cleanEnd =
        this.lastStopReason !== 'error' && this.lastStopReason !== 'aborted';
      return this.maybeStart(ev);
    }

    if (type === 'agent_settled') {
      const events = this.maybeStart(ev);
      if (!this.resultEmitted) {
        if (ev.aborted === true) this.lastStopReason = 'aborted';
        events.push(...this.result());
      }
      return events;
    }

    if (type === 'agent_start') {
      this.cleanEnd = false;
      return this.maybeStart(ev);
    }

    if (type === 'auto_retry_start') {
      // A retry cycle follows — the held error is no longer terminal.
      this.lastStopReason = undefined;
      this.lastError = undefined;
      this.cleanEnd = false;
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

    if (type === 'response') {
      const events = this.maybeStart(ev);
      if (asString(ev.command) !== 'prompt') {
        // A steer queued, or a line Pi could not read: the run goes on.
        if (ev.success === false) {
          events.push({ type: 'raw', harness: this.slug, payload: ev });
        }
        return events;
      }
      if (this.resultEmitted) return events;
      if (ev.success === false) {
        // Refused before any run started: nothing else will come.
        this.lastStopReason = 'error';
        this.lastError = asString(ev.error) ?? 'Pi refused the prompt';
        events.push(...this.result());
      } else if (
        isRecord(ev.data) &&
        asString(ev.data.disposition) === 'handled'
      ) {
        // Handled without a run: there is no agent_settled to wait for.
        events.push(...this.result());
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
      type === 'entry_appended' ||
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
