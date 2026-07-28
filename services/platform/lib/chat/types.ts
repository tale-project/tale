/**
 * The vocabulary the chat layer shares between the turn pipeline, the context
 * contract, and the capability surface.
 *
 * Message content is a list of ORDERED PARTS rather than a string, because the
 * context contract replays a conversation whole: a tool call, its result, an
 * approval card, and an attachment are all things the model saw, so they are
 * all parts of the record instead of being flattened into prose at write time
 * and guessed at on read.
 *
 * Pure data — no `node:*`, no Convex, no I/O — so every consumer (a node
 * action, a V8 query, a test) speaks the same shapes.
 */

/** One piece of a message, in the order it was authored. */
export type MessagePart =
  | { readonly type: 'text'; readonly text: string }
  | {
      readonly type: 'attachment';
      readonly name: string;
      readonly mediaType: string;
      /** Where the bytes live, for a model that fetches them itself. */
      readonly url?: string;
      /** Extracted text, for a model that cannot. */
      readonly text?: string;
    }
  | {
      readonly type: 'tool-call';
      readonly callId: string;
      readonly capabilityId: string;
      readonly input: unknown;
    }
  | {
      readonly type: 'tool-result';
      readonly callId: string;
      readonly capabilityId: string;
      readonly output: unknown;
      /** False when the capability declares no output schema. */
      readonly structured: boolean;
    }
  | {
      readonly type: 'approval';
      readonly approvalId: string;
      readonly question: string;
      readonly decision?: 'approved' | 'rejected';
    }
  | {
      readonly type: 'human-input';
      readonly requestId: string;
      readonly question: string;
      readonly answer?: string;
    };

export type MessageRole = 'user' | 'assistant' | 'tool' | 'system';

/** One message as the pipeline reads and writes it. Mirrors the `messages`
 * table without importing Convex, so the pipeline stays testable. */
export interface ChatMessage {
  readonly role: MessageRole;
  readonly parts: readonly MessagePart[];
  /** Monotonic within a thread; absent on a message not yet persisted. */
  readonly sequence?: number;
  readonly model?: string;
  readonly providerSlug?: string;
  /** Set when a guardrail refused, so the UI explains rather than showing an
   * empty turn. */
  readonly blockedReason?: string;
}

/** Token accounting for one turn. The timing fields ride along for the
 * message-info panel; ledger consumers read the token counts only. */
export interface TurnUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  /** Wall-clock from turn start to the assistant message settling. */
  readonly durationMs?: number;
  /** Wall-clock from turn start to the first cleared output chunk. */
  readonly timeToFirstTokenMs?: number;
}

/** Concatenate the text parts of a message — what token estimation and the
 * guardrail chain read. Non-text parts contribute their human-readable
 * surface so an attachment name or a tool result still counts. */
export function messageText(message: ChatMessage): string {
  const pieces: string[] = [];
  for (const part of message.parts) {
    switch (part.type) {
      case 'text':
        pieces.push(part.text);
        break;
      case 'attachment':
        pieces.push(part.text ?? `[attachment: ${part.name}]`);
        break;
      case 'tool-call':
        pieces.push(`${part.capabilityId}(${safeJson(part.input)})`);
        break;
      case 'tool-result':
        pieces.push(safeJson(part.output));
        break;
      case 'approval':
        pieces.push(part.question);
        break;
      case 'human-input':
        pieces.push([part.question, part.answer].filter(Boolean).join(' '));
        break;
      default: {
        // A new part kind must decide how it reads before it can ship.
        const exhaustive: never = part;
        throw new Error(
          `[chat] unhandled message part: ${JSON.stringify(exhaustive)}`,
        );
      }
    }
  }
  return pieces.join('\n');
}

/** JSON that never throws on a cycle — sizing and logging must not be able to
 * break a turn. */
function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch (error) {
    console.warn(
      `[chat] value could not be serialized for sizing: ${error instanceof Error ? error.name : 'unknown'}`,
    );
    return '';
  }
}

/**
 * Approximate characters per token by content type. Latin text averages ~4;
 * CJK characters often become 1-2 tokens EACH, so a flat ratio under-counts a
 * Chinese/Japanese/Korean conversation by more than 2× and the window
 * overflows before the budget reacts; JSON carries structural overhead.
 */
const CHARS_PER_TOKEN_LATIN = 4;
const CHARS_PER_TOKEN_CJK = 1.5;
const CHARS_PER_TOKEN_JSON = 3;

/** Per-message structural overhead (role, formatting) in tokens. */
export const MESSAGE_OVERHEAD_TOKENS = 4;

/** CJK Unified Ideographs (+ Ext A), Hiragana, Katakana, Hangul. */
const CJK_PATTERN =
  /[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/g;

/**
 * Approximate token count. Deliberately an estimator rather than a real
 * tokenizer: every provider tokenizes differently, and the only decision this
 * feeds is "does the conversation still fit", which is guarded by an output
 * reserve. CJK-aware, because that is where a flat character ratio is not
 * merely 10% off but 2.6× off.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const cjkCount = text.match(CJK_PATTERN)?.length ?? 0;
  const latinCount = text.length - cjkCount;
  return (
    Math.ceil(cjkCount / CHARS_PER_TOKEN_CJK) +
    Math.ceil(latinCount / CHARS_PER_TOKEN_LATIN)
  );
}

/** Token estimate for a structured value (tool payloads) at the JSON rate. */
export function estimateJsonTokens(value: unknown): number {
  return Math.ceil(safeJson(value).length / CHARS_PER_TOKEN_JSON);
}

/** Token estimate for a whole message: its readable surface plus the
 * structural overhead, with tool payloads charged at the JSON rate. */
export function estimateMessageTokens(message: ChatMessage): number {
  let tokens = MESSAGE_OVERHEAD_TOKENS;
  for (const part of message.parts) {
    switch (part.type) {
      case 'tool-call':
        tokens +=
          estimateJsonTokens(part.input) + estimateTokens(part.capabilityId);
        break;
      case 'tool-result':
        tokens += estimateJsonTokens(part.output);
        break;
      default:
        tokens += estimateTokens(
          messageText({ role: message.role, parts: [part] }),
        );
    }
  }
  return tokens;
}
