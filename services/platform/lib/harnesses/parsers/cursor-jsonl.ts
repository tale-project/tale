// Parser family `cursor-jsonl` — the Cursor `agent -p --output-format
// stream-json` NDJSON dialect. Families are keyed by the harness YAML's
// `parser` field; the slug is bound at creation so events attribute to the
// harness that ran.
//
// Native shapes:
//   system/init + session_id     → turn-started + sessionId
//   assistant (complete blocks)  → text
//   tool_call started/completed  → tool-use / tool-result
//   result (+ camelCase usage)   → usage + turn-ended + finalText + isError
//   unknown / missing call_id    → raw

import {
  asNumber,
  asRecord,
  asString,
  isRecord,
  LineReassembler,
  parseJsonLine,
} from '../jsonl';
import type { HarnessEvent, HarnessEventParser, HarnessSlug } from '../types';

function normalizeToolName(raw: string): string {
  if (raw === 'readToolCall') return 'Read';
  if (raw === 'writeToolCall') return 'Write';
  if (raw === 'shellToolCall') return 'Bash';
  // Generic `<verb>ToolCall` wrapper key → the bare verb (e.g. `lsToolCall`
  // → `ls`), so an unmapped tool still renders with a real name, never
  // blank.
  const m = /^(.+)ToolCall$/.exec(raw);
  return m?.[1] ?? raw;
}

/**
 * Cursor wraps each tool call as `tool_call: { <toolKey>: { args, result } }`
 * — the tool NAME is the single wrapper KEY (`shellToolCall`,
 * `readToolCall`, …) and its args/result live INSIDE, not on the wrapper.
 * Unwrap that here. Falls back to the flat `{ tool|name, input|args,
 * result|output }` shape so both are handled. (A blank name or a missing
 * input would make the persisted tool-call part fail message validation and
 * kill an otherwise successful turn.)
 */
function unwrapToolCall(wrapper: Record<string, unknown>): {
  name: string;
  inner: Record<string, unknown>;
} {
  const flatName = asString(wrapper.tool) ?? asString(wrapper.name);
  if (flatName) return { name: normalizeToolName(flatName), inner: wrapper };
  const keys = Object.keys(wrapper);
  const toolKey =
    keys.find((k) => k.endsWith('ToolCall')) ??
    keys.find((k) => isRecord(wrapper[k]));
  if (toolKey) {
    return {
      name: normalizeToolName(toolKey),
      inner: asRecord(wrapper[toolKey]) ?? wrapper,
    };
  }
  return { name: '', inner: wrapper };
}

class CursorJsonlParser implements HarnessEventParser {
  private readonly lines = new LineReassembler();
  private started = false;
  private sessionId: string | undefined;
  private finalTextParts: string[] = [];

  constructor(private readonly slug: HarnessSlug) {}

  feed(chunk: string): HarnessEvent[] {
    return this.lines.push(chunk).flatMap((line) => this.line(line));
  }

  end(): HarnessEvent[] {
    return this.lines.flush().flatMap((line) => this.line(line));
  }

  private maybeStart(sessionId?: string): HarnessEvent[] {
    if (sessionId) this.sessionId = sessionId;
    if (this.started) return [];
    this.started = true;
    const out: HarnessEvent = { type: 'turn-started', harness: this.slug };
    if (this.sessionId) out.sessionId = this.sessionId;
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
    const subtype = asString(ev.subtype);

    if (type === 'system' && subtype === 'init') {
      const sid = asString(ev.session_id) ?? asString(ev.sessionId);
      return this.maybeStart(sid);
    }

    if (type === 'assistant') {
      const events = this.maybeStart(
        asString(ev.session_id) ?? asString(ev.sessionId) ?? this.sessionId,
      );
      const message = asRecord(ev.message);
      const content = message?.content;
      let text = '';
      if (typeof content === 'string') {
        text = content;
      } else if (Array.isArray(content)) {
        text = content
          .map((part) => {
            const p = asRecord(part);
            return asString(p?.text) ?? '';
          })
          .join('');
      } else {
        text = asString(ev.text) ?? asString(message?.text) ?? '';
      }
      if (text) {
        events.push({ type: 'text', text });
        this.finalTextParts.push(text);
      }
      return events;
    }

    if (type === 'tool_call') {
      const events = this.maybeStart(this.sessionId);
      const callId =
        asString(ev.call_id) ?? asString(ev.callId) ?? asString(ev.id);
      if (!callId) {
        events.push({ type: 'raw', harness: this.slug, payload: ev });
        return events;
      }
      const toolCall = asRecord(ev.tool_call) ?? asRecord(ev.toolCall) ?? ev;
      const { name: unwrappedName, inner } = unwrapToolCall(toolCall);
      const toolName =
        unwrappedName ||
        normalizeToolName(asString(ev.tool) ?? asString(ev.tool_name) ?? '');
      if (subtype === 'completed' || subtype === 'complete') {
        const result: HarnessEvent = {
          type: 'tool-result',
          toolUseId: callId,
        };
        const output =
          inner.result ?? inner.output ?? toolCall.result ?? ev.result;
        if (output !== undefined) result.output = output;
        // Shell/tool failure lives in the nested result (`failure`/`error`
        // key or a non-zero exitCode) as well as the top-level is_error flag.
        const innerResult = asRecord(inner.result);
        const success = asRecord(innerResult?.success);
        const hasFailure =
          innerResult?.failure !== undefined ||
          innerResult?.error !== undefined ||
          (success?.exitCode !== undefined && success.exitCode !== 0);
        if (ev.is_error === true || ev.isError === true || hasFailure) {
          result.isError = true;
        }
        events.push(result);
      } else {
        events.push({
          type: 'tool-use',
          toolUseId: callId,
          toolName,
          // Default to `{}` so the persisted tool-call part always carries an
          // `input` field (the message validator rejects a tool-call missing
          // both `input` and `args`; `undefined` is dropped on serialize).
          input: inner.args ?? inner.input ?? toolCall.input ?? ev.input ?? {},
        });
      }
      return events;
    }

    if (type === 'result') {
      const events = this.maybeStart(
        asString(ev.session_id) ?? asString(ev.sessionId) ?? this.sessionId,
      );
      const sid = asString(ev.session_id) ?? asString(ev.sessionId);
      if (sid) this.sessionId = sid;
      const isError =
        ev.is_error === true ||
        ev.isError === true ||
        asString(ev.status) === 'error';
      const resultText =
        asString(ev.result) ??
        asString(ev.final_text) ??
        asString(ev.finalText) ??
        this.finalTextParts.join('\n');
      // The result event carries the turn's accounting as a camelCase
      // `usage` block. Cursor is bring-your-own only, so no gateway meters
      // the turn — this block is the ONLY usage signal and must not be
      // dropped. Zero-token results emit no usage row (metering-pollution
      // posture shared with the other parsers).
      const usage = asRecord(ev.usage);
      const inputTokens = asNumber(usage?.inputTokens) ?? 0;
      const outputTokens = asNumber(usage?.outputTokens) ?? 0;
      const hasUsage = inputTokens + outputTokens > 0;
      if (usage && hasUsage) {
        const usageEvent: HarnessEvent = {
          type: 'usage',
          inputTokens,
          outputTokens,
        };
        const cacheRead = asNumber(usage.cacheReadTokens);
        if (cacheRead !== undefined && cacheRead > 0) {
          usageEvent.cacheReadTokens = cacheRead;
        }
        const cacheWrite = asNumber(usage.cacheWriteTokens);
        if (cacheWrite !== undefined && cacheWrite > 0) {
          usageEvent.cacheWriteTokens = cacheWrite;
        }
        events.push(usageEvent);
      }
      const result: HarnessEvent = {
        type: 'turn-ended',
        status: isError ? 'error' : 'completed',
        isError,
      };
      if (this.sessionId) result.sessionId = this.sessionId;
      if (resultText) result.finalText = resultText;
      if (usage && hasUsage) {
        result.usageTotals = { inputTokens, outputTokens };
      }
      events.push(result);
      return events;
    }

    if (type === 'error') {
      const events = this.maybeStart(this.sessionId);
      const message =
        asString(ev.message) ??
        asString(asRecord(ev.error)?.message) ??
        'Cursor agent error';
      events.push({ type: 'error', message, raw: ev });
      return events;
    }

    return [{ type: 'raw', harness: this.slug, payload: ev }];
  }
}

export function createParser(slug: HarnessSlug): HarnessEventParser {
  return new CursorJsonlParser(slug);
}
