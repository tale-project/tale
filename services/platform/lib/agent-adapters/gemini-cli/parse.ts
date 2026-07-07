// Gemini CLI `--output-format stream-json` NDJSON → normalized AgentEvent[].
//
// Event shapes (verified against @google/gemini-cli 0.49.0 —
// packages/core/src/output/types.ts at tag v0.49.0, plus real captured runs;
// see fixtures/gemini/shell-turn.jsonl):
//   { type: "init", timestamp, session_id, model }
//   { type: "message", timestamp, role: "user"|"assistant", content, delta? }
//   { type: "tool_use", timestamp, tool_name, tool_id, parameters }
//   { type: "tool_result", timestamp, tool_id, status: "success"|"error",
//     output?, error?: { type, message } }
//   { type: "error", timestamp, severity: "warning"|"error", message }
//   { type: "result", timestamp, status: "success"|"error", error?,
//     stats?: { total_tokens, input_tokens, output_tokens, cached, input,
//               duration_ms, tool_calls, models } }

import type {
  AgentEvent,
  AgentEventParser,
  AgentResultStatus,
} from '../events';
import { isRecord, LineReassembler, parseJsonLine } from '../jsonl';

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** The CLI's turn-cap error (FatalTurnLimitedError, exit code 53): "Reached
 * max session turns for this session. …". Deliberately narrow so a model
 * error mentioning "max_tokens" never reads as an exhausted loop. */
const MAX_TURNS_ERROR = /reached max session turns/i;

function mapRunStatus(
  status: string | undefined,
  error?: string,
): AgentResultStatus {
  if (status === 'success') return 'completed';
  if (error !== undefined && MAX_TURNS_ERROR.test(error)) return 'max-turns';
  return status ? 'error' : 'completed';
}

export class GeminiCliParser implements AgentEventParser {
  private readonly lines = new LineReassembler();
  private started = false;
  private sessionId: string | undefined;
  /** Assistant text accumulated across the turn — the `result` event carries
   * no final text of its own, so the deltas ARE the reply. */
  private assistantText = '';

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
    const out: AgentEvent = { type: 'run-started', agent: 'gemini' };
    if (this.sessionId) out.agentSessionId = this.sessionId;
    const model = str(ev.model);
    if (model) out.model = model;
    return [out];
  }

  private line(line: string): AgentEvent[] {
    const ev = parseJsonLine(line);
    if (!ev) {
      console.warn('[gemini parse] dropping unparseable line', {
        len: line.length,
        head: line.slice(0, 120),
      });
      return [];
    }

    const type = str(ev.type);

    if (type === 'init') {
      return this.maybeStart(ev);
    }

    if (type === 'message') {
      const events = this.maybeStart(ev);
      // The user message is the CLI echoing our own prompt back — not agent
      // output; emitting it would duplicate the user's bubble in the thread.
      if (str(ev.role) !== 'assistant') return events;
      const text = str(ev.content);
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
      const toolUseId = str(ev.tool_id);
      if (!toolUseId) {
        events.push({ type: 'raw', agent: 'gemini', payload: ev });
        return events;
      }
      events.push({
        type: 'tool-use',
        toolUseId,
        toolName: str(ev.tool_name) ?? '',
        input: ev.parameters,
      });
      return events;
    }

    if (type === 'tool_result') {
      const events = this.maybeStart(ev);
      const toolUseId = str(ev.tool_id);
      if (!toolUseId) {
        events.push({ type: 'raw', agent: 'gemini', payload: ev });
        return events;
      }
      const out: AgentEvent = {
        type: 'tool-result',
        toolUseId,
        isError: str(ev.status) === 'error',
      };
      const output =
        ev.output ?? (isRecord(ev.error) ? str(ev.error.message) : undefined);
      if (output !== undefined) out.output = output;
      events.push(out);
      return events;
    }

    if (type === 'error') {
      const events = this.maybeStart(ev);
      const message = str(ev.message);
      if (message) events.push({ type: 'error', message, raw: ev });
      return events;
    }

    if (type === 'result') {
      const events = this.maybeStart(ev);
      const stats = isRecord(ev.stats) ? ev.stats : undefined;
      const inputTokens = num(stats?.input_tokens) ?? 0;
      const outputTokens = num(stats?.output_tokens) ?? 0;
      // Zero-token runs emit NO usage event — a zero row would only pollute
      // metering (the gateway meters authoritatively either way).
      if (stats && inputTokens + outputTokens > 0) {
        const usage: AgentEvent = {
          type: 'usage',
          inputTokens,
          outputTokens,
        };
        const cached = num(stats.cached);
        if (cached !== undefined && cached > 0) {
          usage.cacheReadTokens = cached;
        }
        events.push(usage);
      }
      const err = isRecord(ev.error) ? str(ev.error.message) : undefined;
      const status = mapRunStatus(str(ev.status), err);
      const result: AgentEvent = { type: 'result', status };
      if (this.sessionId) result.agentSessionId = this.sessionId;
      if (this.assistantText) result.finalText = this.assistantText;
      const durationMs = num(stats?.duration_ms);
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

    return [{ type: 'raw', agent: 'gemini', payload: ev }];
  }
}
