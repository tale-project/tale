// Parser family `claude-stream-json` — Claude Code's `--output-format
// stream-json` dialect, both directions: the stdout stream parser and the
// stream-json stdin line builders (initial prompt + mid-run steer pushes).
// Families are keyed by the harness YAML's `parser` field; the slug is bound
// at creation so events attribute to the harness that ran.
//
// Native shapes (verified against the headless docs + live pinned-CLI runs):
//   { type: "system", subtype: "init", session_id, model, data?: { model } }
//   { type: "stream_event", event: { delta: { type: "text_delta", text } } }
//   { type: "assistant", message: { id, usage, content: [ {type:"text"...},
//                                    {type:"tool_use", id, name, input} ] } }
//   { type: "user", message: { content: [ {type:"tool_result",
//                                          tool_use_id, is_error} ] } }
//   { type: "result", subtype: "success"|"error_max_turns"|..., session_id,
//                      total_cost_usd, result }
//   { type: "system", subtype: "api_retry", ... }  → raw
//
// Usage rides on assistant messages and is deduped by message.id: when the
// model uses tools in parallel the same message id repeats, and counting each
// would double-bill.

import {
  asArray,
  asNumber,
  asRecord,
  asString,
  LineReassembler,
  parseJsonLine,
} from '../jsonl';
import type {
  HarnessEvent,
  HarnessEventParser,
  HarnessSlug,
  HarnessTurnStatus,
} from '../types';

// ---------------------------------------------------------------------------
// stdin line shapes (stream-json input)
// ---------------------------------------------------------------------------
// Single source for the NDJSON user-message line so the initial prompt and
// the platform's mid-run steer pushes can't drift. Verified on the pinned
// CLI: it accepts {type:"user", message:{role, content:[{type:"text",…}]}}
// lines; a malformed line exits the whole process (the runner re-validates).

/** Max UTF-8 BYTES of steer text per batch. Mirrors the tale-steer-hook
 * payload cap so one steer batch can never blow the runner's stdin line cap
 * (64 KB) after JSON + base64 overhead. Must be a BYTE budget (not a char
 * count): the line is gated on its decoded byte length, so a char-count cap
 * would let a multibyte (CJK/emoji) batch silently exceed it and be rejected.
 * 16 KB leaves ample headroom for the JSON envelope + escaping. */
export const STEER_STDIN_TEXT_CAP = 16_000;

/** Truncate `text` to at most `maxBytes` UTF-8 bytes WITHOUT splitting a
 * codepoint (a half-emoji would corrupt the JSON line). Backs off past any
 * trailing continuation bytes (0b10xxxxxx) to the last whole codepoint. */
export function truncateToUtf8Bytes(text: string, maxBytes: number): string {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length <= maxBytes) return text;
  let end = maxBytes;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
  return new TextDecoder().decode(bytes.subarray(0, end));
}

/** One newline-terminated stream-json user message. */
export function buildStdinUserMessage(text: string): string {
  return `${JSON.stringify({
    type: 'user',
    message: { role: 'user', content: [{ type: 'text', text }] },
  })}\n`;
}

/** A steer batch as one stdin user message, wrapped in the same
 * `[TALE_STEER ids=...]` sentinel the in-image hook emits — the platform's
 * parser flips the queue rows to consumed when the sentinel surfaces in the
 * conversation, regardless of which channel delivered it. */
export function buildSteerStdinPayload(
  rows: Array<{ messageId: string; text: string }>,
): string {
  const ids = rows.map((r) => r.messageId).join(',');
  const body = rows.map((r) => r.text).join('\n\n');
  const payload =
    `[TALE_STEER ids=${ids}] The user sent the following message(s) while you were working. ` +
    `Adjust your current work to incorporate them now:\n\n${body}`;
  return buildStdinUserMessage(
    truncateToUtf8Bytes(payload, STEER_STDIN_TEXT_CAP),
  );
}

// ---------------------------------------------------------------------------
// stdout stream parser
// ---------------------------------------------------------------------------

function mapResultStatus(subtype: string | undefined): HarnessTurnStatus {
  switch (subtype) {
    case 'success':
      return 'completed';
    case 'error_max_turns':
      return 'max-turns';
    default:
      return subtype ? 'error' : 'completed';
  }
}

// Terminal background-task statuses. A `task_notification` carries
// completed|failed|stopped; a `task_updated` patch can carry any of these
// plus `killed` (its full enum, verified in the pinned CLI bundle). The
// non-terminal pending|running|paused states must NOT settle the ledger
// entry.
const TERMINAL_TASK_STATUSES: ReadonlySet<string> = new Set([
  'completed',
  'failed',
  'stopped',
  'killed',
]);

class ClaudeStreamJsonParser implements HarnessEventParser {
  private readonly lines = new LineReassembler();
  private readonly seenUsageMsgIds = new Set<string>();

  constructor(private readonly slug: HarnessSlug) {}

  feed(chunk: string): HarnessEvent[] {
    return this.lines.push(chunk).flatMap((line) => this.line(line));
  }

  end(): HarnessEvent[] {
    return this.lines.flush().flatMap((line) => this.line(line));
  }

  private line(line: string): HarnessEvent[] {
    const ev = parseJsonLine(line);
    if (!ev) {
      // A malformed/truncated line (e.g. the process died mid-record on the
      // end() flush) is dropped — but log it so a real truncation isn't
      // silent.
      console.warn(`[${this.slug} parse] dropping unparseable line`, {
        len: line.length,
        head: line.slice(0, 120),
      });
      return [];
    }
    const type = asString(ev.type);

    if (type === 'system') {
      const subtype = asString(ev.subtype);
      if (subtype === 'init') {
        const data = asRecord(ev.data);
        const out: HarnessEvent = { type: 'turn-started', harness: this.slug };
        const sid = asString(ev.session_id);
        if (sid) out.sessionId = sid;
        // The pinned CLI reports the model at the TOP level of the init
        // event (verified on a real 2.1.173 capture); the Agent-SDK shape
        // nests it under `data`. Read both so neither stream loses it.
        const model = asString(ev.model) ?? asString(data?.model);
        if (model) out.model = model;
        return [out];
      }
      // Background-task ledger: task_started opens an entry;
      // task_notification (status completed|stopped) settles it. The runner
      // balances these to know whether a post-result process is lingering on
      // background work (no stdin EOF yet) or safe to close.
      if (subtype === 'task_started') {
        const taskId = asString(ev.task_id);
        if (taskId) {
          const out: HarnessEvent = { type: 'task-started', taskId };
          const description = asString(ev.description);
          if (description) out.description = description;
          return [out];
        }
      }
      if (subtype === 'task_notification') {
        const taskId = asString(ev.task_id);
        if (taskId) {
          const out: HarnessEvent = { type: 'task-settled', taskId };
          const status = asString(ev.status);
          if (status) out.status = status;
          return [out];
        }
      }
      // A background task can report completion ONLY via task_updated (whose
      // `patch.status` reached a terminal state) without ever emitting a
      // task_notification — the Agent SDK documents this explicitly. Without
      // settling on it, a finished task lingers in the pending ledger forever
      // and the runner never sends stdin EOF, so the run hangs until its
      // budget. `patch` is a delta, so `status` is present only when it
      // changed; a non-terminal change (running/pending/paused) leaves the
      // entry open.
      if (subtype === 'task_updated') {
        const taskId = asString(ev.task_id);
        const status = asString(asRecord(ev.patch)?.status);
        if (taskId && status && TERMINAL_TASK_STATUSES.has(status)) {
          return [{ type: 'task-settled', taskId, status }];
        }
      }
      // api_retry and other system events: pass through for observability.
      return [{ type: 'raw', harness: this.slug, payload: ev }];
    }

    if (type === 'stream_event') {
      const inner = asRecord(ev.event);
      const delta = asRecord(inner?.delta);
      if (asString(delta?.type) === 'text_delta') {
        const text = asString(delta?.text);
        if (text) {
          // Sub-agent deltas carry the parent task's tool_use id at top
          // level, same as the completed assistant/user events — propagate it
          // so the runner doesn't count sub-agent streaming as main-loop
          // activity.
          const parentToolUseId = asString(ev.parent_tool_use_id);
          return [
            {
              type: 'text-delta',
              text,
              ...(parentToolUseId ? { parentToolUseId } : {}),
            },
          ];
        }
      }
      return [];
    }

    if (type === 'assistant') {
      const message = asRecord(ev.message);
      const events: HarnessEvent[] = [];
      // Top-level (sibling of `message`): the parent task's tool_use id when
      // a sub-agent emitted this message, `null`/absent for the main agent.
      // asString coalesces `null` → undefined, so main-agent events carry no
      // field.
      const parentToolUseId = asString(ev.parent_tool_use_id);
      for (const block of asArray(message?.content)) {
        const b = asRecord(block);
        const bt = asString(b?.type);
        if (bt === 'text') {
          const text = asString(b?.text);
          if (text) {
            events.push({
              type: 'text',
              text,
              ...(parentToolUseId ? { parentToolUseId } : {}),
            });
          }
        } else if (bt === 'tool_use') {
          events.push({
            type: 'tool-use',
            toolUseId: asString(b?.id) ?? '',
            toolName: asString(b?.name) ?? '',
            input: b?.input,
            ...(parentToolUseId ? { parentToolUseId } : {}),
          });
        }
      }
      // Usage, deduped by message id.
      const msgId = asString(message?.id);
      const usage = asRecord(message?.usage);
      if (usage && (!msgId || !this.seenUsageMsgIds.has(msgId))) {
        if (msgId) this.seenUsageMsgIds.add(msgId);
        const model = asString(message?.model);
        events.push({
          type: 'usage',
          ...(model ? { model } : {}),
          inputTokens: asNumber(usage.input_tokens) ?? 0,
          outputTokens: asNumber(usage.output_tokens) ?? 0,
          cacheReadTokens: asNumber(usage.cache_read_input_tokens) ?? 0,
          cacheWriteTokens: asNumber(usage.cache_creation_input_tokens) ?? 0,
          // Sub-agent usage must not read as main-loop activity (quiet-idle).
          ...(parentToolUseId ? { parentToolUseId } : {}),
        });
      }
      return events;
    }

    if (type === 'user') {
      const message = asRecord(ev.message);
      const events: HarnessEvent[] = [];
      // A sub-agent's tool results arrive on a `user` event carrying the
      // parent task's tool_use id at top level (same as the matching
      // assistant events).
      const parentToolUseId = asString(ev.parent_tool_use_id);
      for (const block of asArray(message?.content)) {
        const b = asRecord(block);
        const bt = asString(b?.type);
        if (bt === 'tool_result') {
          const out: HarnessEvent = {
            type: 'tool-result',
            toolUseId: asString(b?.tool_use_id) ?? '',
          };
          if (b?.content !== undefined) out.output = b.content;
          if (typeof b?.is_error === 'boolean') out.isError = b.is_error;
          if (parentToolUseId) out.parentToolUseId = parentToolUseId;
          events.push(out);
        } else if (bt === 'text') {
          // Steer-hook injection surfacing as a synthetic user message. Only
          // the Stop-hook path emits this ("Stop hook feedback:\n[TALE_STEER
          // ids=...] ...") — PostToolUse additionalContext never reaches
          // stdout. Non-matching user text blocks are dropped (they are the
          // CLI echoing synthetic input, not agent output).
          const text = asString(b?.text);
          const match = text?.match(/\[TALE_STEER ids=([^\]]*)\]/);
          if (text && match?.[1]) {
            events.push({
              type: 'steer-injected',
              messageIds: match[1].split(',').filter(Boolean),
              text,
            });
          }
        }
      }
      return events;
    }

    if (type === 'result') {
      const out: HarnessEvent = {
        type: 'turn-ended',
        status: mapResultStatus(asString(ev.subtype)),
      };
      const sid = asString(ev.session_id);
      if (sid) out.sessionId = sid;
      const finalText = asString(ev.result);
      if (finalText) out.finalText = finalText;
      // The CLI reports a turn-terminating API error via `is_error` +
      // `api_error_status` while LEAVING `subtype:'success'` — surface both
      // so a caller can classify (e.g. rotate the token on a 429/401). The
      // status code is absent (null) for mid-stream failures.
      if (typeof ev.is_error === 'boolean') out.isError = ev.is_error;
      if (typeof ev.api_error_status === 'number') {
        out.apiErrorStatus = ev.api_error_status;
      }
      if (typeof ev.duration_ms === 'number') out.durationMs = ev.duration_ms;
      if (typeof ev.total_cost_usd === 'number') {
        out.usageTotals = {
          inputTokens: 0,
          outputTokens: 0,
          costEstimateUsd: ev.total_cost_usd,
        };
      }
      return [out];
    }

    // Unmapped event type — forward verbatim so nothing is silently dropped.
    return [{ type: 'raw', harness: this.slug, payload: ev }];
  }
}

export function createParser(slug: HarnessSlug): HarnessEventParser {
  return new ClaudeStreamJsonParser(slug);
}
