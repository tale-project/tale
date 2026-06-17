// OpenCode `run --format json` JSONL → normalized AgentEvent[].
//
// Event shapes (verified against the OpenCode docs / stream-json cheatsheet):
//   { type: "step_start", sessionID }
//   { type: "text", part: { text } }
//   { type: "tool_use", part: { tool, state: { status, input, output } } }
//   { type: "step_finish", part: { cost, tokens: { input, output, reasoning,
//        cache: { read, write } }, reason: "stop"|"tool-calls" }, sessionID }
//   { type: "error", error: { name, data: { message } } }
//
// The first event carrying a sessionID seeds `run-started`; the terminal
// `step_finish` with reason "stop" is the run's accounting + result record.

import type { AgentEvent, AgentEventParser } from '../events';
import { isRecord, LineReassembler, parseJsonLine } from '../jsonl';

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}
function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}
function obj(v: unknown): Record<string, unknown> | undefined {
  return isRecord(v) ? v : undefined;
}

export class OpenCodeParser implements AgentEventParser {
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
    const sid = str(ev.sessionID);
    if (sid) this.sessionId = sid;
    if (this.started) return [];
    this.started = true;
    const out: AgentEvent = { type: 'run-started', agent: 'opencode' };
    if (this.sessionId) out.agentSessionId = this.sessionId;
    return [out];
  }

  private line(line: string): AgentEvent[] {
    const ev = parseJsonLine(line);
    if (!ev) {
      // Drop a malformed/truncated line, but log it so a real truncation
      // (e.g. the process died mid-record) isn't silently lost.
      console.warn('[opencode parse] dropping unparseable line', {
        len: line.length,
        head: line.slice(0, 120),
      });
      return [];
    }
    const type = str(ev.type);
    const part = obj(ev.part);

    if (type === 'step_start') {
      return this.maybeStart(ev);
    }

    if (type === 'text') {
      const events = this.maybeStart(ev);
      const text = str(part?.text);
      if (text) events.push({ type: 'text', text });
      return events;
    }

    if (type === 'tool_use') {
      const events = this.maybeStart(ev);
      const state = obj(part?.state);
      const status = str(state?.status);
      const toolUseId = str(part?.id) ?? str(part?.callID);
      if (!toolUseId) {
        // No correlation id — emitting a normalized tool-use/tool-result with
        // an empty id would corrupt downstream pairing. Forward verbatim
        // instead so nothing is silently dropped.
        events.push({ type: 'raw', agent: 'opencode', payload: ev });
        return events;
      }
      if (status === 'completed' || status === 'error') {
        const out: AgentEvent = { type: 'tool-result', toolUseId };
        if (state?.output !== undefined) out.output = state.output;
        if (status === 'error') out.isError = true;
        events.push(out);
      } else {
        events.push({
          type: 'tool-use',
          toolUseId,
          toolName: str(part?.tool) ?? '',
          input: state?.input,
        });
      }
      return events;
    }

    if (type === 'step_finish') {
      const events = this.maybeStart(ev);
      const tokens = obj(part?.tokens);
      const cache = obj(tokens?.cache);
      const costUsd = typeof part?.cost === 'number' ? part.cost : undefined;
      events.push({
        type: 'usage',
        inputTokens: num(tokens?.input),
        outputTokens: num(tokens?.output) + num(tokens?.reasoning),
        cacheReadTokens: num(cache?.read),
        cacheWriteTokens: num(cache?.write),
        ...(costUsd !== undefined ? { costEstimateUsd: costUsd } : {}),
      });
      if (str(part?.reason) === 'stop') {
        const result: AgentEvent = { type: 'result', status: 'completed' };
        if (this.sessionId) result.agentSessionId = this.sessionId;
        if (costUsd !== undefined) {
          result.usageTotals = {
            inputTokens: num(tokens?.input),
            outputTokens: num(tokens?.output) + num(tokens?.reasoning),
            costEstimateUsd: costUsd,
          };
        }
        events.push(result);
      }
      return events;
    }

    if (type === 'error') {
      const error = obj(ev.error);
      const data = obj(error?.data);
      return [
        {
          type: 'error',
          message: str(data?.message) ?? str(error?.name) ?? 'opencode error',
          raw: ev,
        },
      ];
    }

    return [{ type: 'raw', agent: 'opencode', payload: ev }];
  }
}
