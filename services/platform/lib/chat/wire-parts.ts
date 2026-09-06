/**
 * Parts → wire turns.
 *
 * A stored chat message carries its whole turn as ORDERED PARTS — text
 * segments, tool calls, and tool results interleaved exactly as they were
 * authored. Provider wires do not accept that shape: a tool result must
 * arrive as its own turn (`role: 'tool'` on OpenAI, a `tool_result` block in
 * a USER turn on Anthropic), immediately after the assistant turn that
 * called. This module deterministically EXPLODES part sequences into that
 * alternation, so one persistence shape serves history replay and the
 * in-flight tool loop alike.
 *
 *   [text, tool-call, tool-result, text]
 *     → assistant(text + call) · tool(result) · assistant(text)
 *
 * Reasoning parts are skipped — thinking is display-only and never replayed.
 * Everything else that is not a tool part reads as its text surface, exactly
 * as `messageText` spells it.
 *
 * Layer A: pure data mapping, no I/O — tested without a provider.
 */

import { messageText, type ChatMessage } from './types';

/** One tool call an assistant wire turn carries. `input` is the parsed
 * arguments value; each dialect spells it its own way. */
export interface WireToolCall {
  id: string;
  name: string;
  input: unknown;
}

/** One tool result, answering the call with the same id. */
export interface WireToolResult {
  callId: string;
  content: string;
}

/** An image attachment on a user turn, as the pure explode lifts it: the
 * blob reference only — the HOST resolves bytes (or declines to, for a model
 * without vision) before the dialect body is built. */
export interface WireAttachmentRef {
  fileId: string;
  name: string;
  mediaType: string;
}

/** An image resolved for the wire, ready for either dialect to spell. */
export interface WireImage {
  mediaType: string;
  dataBase64: string;
}

/**
 * One conversation turn as the wire builder consumes it. A plain
 * `{role, content}` message (the automations builder's shape) is assignable
 * as-is; the tool fields exist only for the chat tool loop.
 */
export interface ChatWireMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** Tool calls this assistant turn made (assistant role only). */
  toolCalls?: WireToolCall[];
  /** Tool results this turn carries (role `tool` only). */
  toolResults?: WireToolResult[];
  /** Image attachments riding this user turn, by blob reference — lifted by
   * the explode, resolved (or textualized) by the host. */
  attachmentRefs?: WireAttachmentRef[];
  /** Images resolved to bytes for this user turn — what the dialect shaping
   * actually spells into content blocks. */
  images?: WireImage[];
}

/** A tool output as wire text: strings pass through, everything else is
 * JSON. Never throws — a result that cannot serialize reads as empty rather
 * than ending the turn. */
export function toolResultContent(output: unknown): string {
  if (typeof output === 'string') return output;
  try {
    return JSON.stringify(output) ?? '';
  } catch (error) {
    console.warn(
      `[chat] tool result could not be serialized for the wire: ${error instanceof Error ? error.name : 'unknown'}`,
    );
    return '';
  }
}

type Group =
  | { kind: 'assistant'; content: string; calls: WireToolCall[] }
  | { kind: 'results'; results: WireToolResult[] };

/** The answer a replayed tool call gets when its result never landed. */
const INTERRUPTED_TOOL_OUTPUT = {
  status: 'cancelled',
  message: 'This tool call was interrupted before it produced a result.',
} as const;

/** Explode ONE assistant message's parts into alternating wire turns. */
function explodeAssistantMessage(message: ChatMessage): ChatWireMessage[] {
  const groups: Group[] = [];
  const assistantGroup = (): Extract<Group, { kind: 'assistant' }> => {
    const last = groups.at(-1);
    if (last?.kind === 'assistant') return last;
    const created: Group = { kind: 'assistant', content: '', calls: [] };
    groups.push(created);
    return created;
  };
  const resultsGroup = (): Extract<Group, { kind: 'results' }> => {
    const last = groups.at(-1);
    if (last?.kind === 'results') return last;
    const created: Group = { kind: 'results', results: [] };
    groups.push(created);
    return created;
  };
  const appendText = (text: string) => {
    if (text.length === 0) return;
    const group = assistantGroup();
    group.content =
      group.content.length > 0 ? `${group.content}\n\n${text}` : text;
  };

  for (const part of message.parts) {
    switch (part.type) {
      case 'reasoning':
        break; // display-only, never replayed
      case 'text':
        appendText(part.text);
        break;
      case 'tool-call':
        assistantGroup().calls.push({
          id: part.callId,
          name: part.capabilityId,
          input: part.input,
        });
        break;
      case 'tool-result':
        resultsGroup().results.push({
          callId: part.callId,
          content: toolResultContent(part.output),
        });
        break;
      default:
        // Attachments, approvals, human-input — their text surface, exactly
        // as sizing and guardrails read them.
        appendText(messageText({ role: message.role, parts: [part] }));
    }
  }

  // Every call must be answered before the next assistant or user turn —
  // both dialects reject an unanswered tool call. A stored row can carry
  // one (a reply the watchdog failed mid-round, a row from before the
  // pipeline answered stopped calls), and a transcript that replays it
  // would fail every later turn on the thread; the repair answers the
  // orphan with the same interrupted result the pipeline records.
  const answered = new Set<string>();
  for (const group of groups) {
    if (group.kind === 'results') {
      for (const result of group.results) answered.add(result.callId);
    }
  }
  const wire: ChatWireMessage[] = [];
  for (const group of groups) {
    if (group.kind === 'assistant') {
      if (group.content.length === 0 && group.calls.length === 0) continue;
      wire.push({
        role: 'assistant',
        content: group.content,
        ...(group.calls.length > 0 ? { toolCalls: group.calls } : {}),
      });
      const orphans = group.calls.filter((call) => !answered.has(call.id));
      if (orphans.length > 0) {
        wire.push({
          role: 'tool',
          content: '',
          toolResults: orphans.map((call) => ({
            callId: call.id,
            content: toolResultContent(INTERRUPTED_TOOL_OUTPUT),
          })),
        });
      }
      continue;
    }
    wire.push({ role: 'tool', content: '', toolResults: group.results });
  }
  // An assistant message with no renderable parts still occupies its turn —
  // the transcript's shape is part of the record.
  if (wire.length === 0) wire.push({ role: 'assistant', content: '' });
  return wire;
}

/**
 * Map a turn's system prompt and messages onto wire turns. Non-assistant
 * messages read as their text surface (the assembled system prompt is
 * prepended so the connector's dialect shaping — the system hoist on
 * Anthropic — applies to it too); assistant messages explode per their
 * parts, and a stored `tool` role message contributes its results.
 */
export function explodeMessagesForWire(
  system: string,
  messages: readonly ChatMessage[],
): ChatWireMessage[] {
  const wire: ChatWireMessage[] = [];
  if (system.trim().length > 0) {
    wire.push({ role: 'system', content: system });
  }
  for (const message of messages) {
    if (message.role === 'assistant') {
      wire.push(...explodeAssistantMessage(message));
      continue;
    }
    if (message.role === 'tool') {
      const results: WireToolResult[] = [];
      for (const part of message.parts) {
        if (part.type === 'tool-result') {
          results.push({
            callId: part.callId,
            content: toolResultContent(part.output),
          });
        }
      }
      if (results.length > 0) {
        wire.push({ role: 'tool', content: '', toolResults: results });
      }
      continue;
    }
    // Image attachments with a blob reference are LIFTED off the text
    // surface: the host either inlines their bytes (vision model) or puts a
    // readable placeholder back — either way that is the host's call, made
    // where the bytes and the model's capabilities are known. Every other
    // part keeps reading as its text surface.
    const refs: WireAttachmentRef[] = [];
    const textParts: (typeof message.parts)[number][] = [];
    for (const part of message.parts) {
      if (
        part.type === 'attachment' &&
        part.fileId !== undefined &&
        part.mediaType.startsWith('image/')
      ) {
        refs.push({
          fileId: part.fileId,
          name: part.name,
          mediaType: part.mediaType,
        });
        continue;
      }
      textParts.push(part);
    }
    wire.push({
      role: message.role === 'system' ? 'system' : 'user',
      content: messageText({ role: message.role, parts: textParts }),
      ...(refs.length > 0 ? { attachmentRefs: refs } : {}),
    });
  }
  return wire;
}
