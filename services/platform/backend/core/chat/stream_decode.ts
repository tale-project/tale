/**
 * How a streamed model answer is read, event by event, in the two dialects
 * the platform's chat speaks — OpenAI-compatible chat completions and
 * Anthropic Messages: the incremental text, the reasoning, the tool-call
 * fragments, the finish reason, the usage the provider reports, and a
 * failure it reports after the stream opened. The chat turn's stream reader
 * (`turn_action.ts` `streamSse`) folds a whole answer through it; the model
 * endpoints for API keys (`domains/model_api`) read the usage of the stream
 * they relay through the same decoder, so a relayed request books the counts
 * a chat turn would.
 *
 * Pure: no I/O.
 */

import type { ApiFormat } from '@tale/shared/schemas/providers';

import type { TurnFinishReason, TurnUsage } from '../../../lib/chat/types';
import { isRecord } from '../../../lib/utils/type-utils';

function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

/** Read a numeric token count a provider may or may not have sent. */
function tokenCount(usage: Record<string, unknown>, key: string): number {
  const value = usage[key];
  return typeof value === 'number' ? value : 0;
}

/**
 * The prompt an Anthropic usage frame reports, in full. Anthropic counts a
 * prompt in three parts — `input_tokens` (read fresh), `cache_read_input_
 * tokens` (served from the prompt cache) and `cache_creation_input_tokens`
 * (written to it) — and bills all three, so the prompt is their sum; the
 * cache read count rides along as the cached share. A server that folds the
 * cached parts into `input_tokens` reports no cache fields, and reads the
 * same.
 */
function anthropicPromptTokens(usage: Record<string, unknown>): number {
  return (
    tokenCount(usage, 'input_tokens') +
    tokenCount(usage, 'cache_read_input_tokens') +
    tokenCount(usage, 'cache_creation_input_tokens')
  );
}

/** Like {@link tokenCount}, but absence stays `undefined` — for the cache
 * and reasoning counts only some dialects report, where a made-up zero
 * would render as a fact in the message-info panel. */
function optionalTokenCount(
  usage: Record<string, unknown> | null,
  key: string,
): number | undefined {
  const value = usage?.[key];
  return typeof value === 'number' ? value : undefined;
}

/** One tool call as it accumulates across streamed events: both dialects
 * announce id/name once and then drip the arguments as JSON fragments. */
export interface ToolCallDraft {
  id: string;
  name: string;
  argumentsJson: string;
}

/** Mutable per-stream decode state: running usage plus the tool-call drafts,
 * keyed by the provider's block/call index. Cache and reasoning counts stay
 * absent until the dialect reports one — Anthropic sends
 * `cache_read_input_tokens` (thinking bills inside `output_tokens`, so no
 * reasoning count); OpenAI-compatible usage frames carry both details
 * objects. */
export interface StreamDecodeState {
  readonly running: {
    input: number;
    output: number;
    cached?: number;
    reasoning?: number;
  };
  readonly drafts: Map<number, ToolCallDraft>;
}

/** The OpenAI `finish_reason` vocabulary folded onto the platform's. */
function openAiFinishReason(value: unknown): TurnFinishReason | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  switch (value) {
    case 'stop':
      return 'stop';
    case 'length':
      return 'length';
    case 'tool_calls':
    case 'function_call':
      return 'tool-calls';
    case 'content_filter':
      return 'content-filter';
    default:
      return 'other';
  }
}

/** The Anthropic `stop_reason` vocabulary folded onto the platform's. */
function anthropicStopReason(value: unknown): TurnFinishReason | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  switch (value) {
    case 'end_turn':
    case 'stop_sequence':
      return 'stop';
    case 'max_tokens':
      return 'length';
    case 'tool_use':
      return 'tool-calls';
    case 'refusal':
      return 'content-filter';
    default:
      return 'other';
  }
}

/** Pull the incremental text, any usage, any finish reason, and any
 * tool-call fragments out of one streamed event, per the connector's
 * dialect. Returns empty text for the many control events (role
 * announcements, pings) that carry no content; tool fragments accumulate on
 * `state.drafts` and surface as one chunk when the stream ends. Exported
 * for its unit tests — fragment accumulation across events is exactly the
 * kind of seam a live stream hides. */
export function readEvent(
  apiFormat: ApiFormat,
  event: Record<string, unknown>,
  state: StreamDecodeState,
): {
  text: string;
  reasoning?: string;
  usage?: TurnUsage;
  finishReason?: TurnFinishReason;
} {
  const runningUsage = state.running;
  if (apiFormat === 'anthropic') {
    const type = event.type;
    if (type === 'message_start') {
      const message = asRecord(event.message);
      const usage = asRecord(message?.usage);
      if (usage) {
        runningUsage.input = anthropicPromptTokens(usage);
        const cached = optionalTokenCount(usage, 'cache_read_input_tokens');
        if (cached !== undefined) runningUsage.cached = cached;
        // Surfaced NOW, not on the closing delta: the prompt is billed in
        // full before the first output token, and a cancel that aborts the
        // fetch before `message_delta` used to lose the count entirely.
        return { text: '', usage: totals(runningUsage) };
      }
      return { text: '' };
    }
    if (type === 'content_block_start') {
      const block = asRecord(event.content_block);
      const index = typeof event.index === 'number' ? event.index : null;
      if (
        block?.type === 'tool_use' &&
        index !== null &&
        typeof block.id === 'string' &&
        typeof block.name === 'string'
      ) {
        state.drafts.set(index, {
          id: block.id,
          name: block.name,
          argumentsJson: '',
        });
      }
      return { text: '' };
    }
    if (type === 'content_block_delta') {
      const delta = asRecord(event.delta);
      if (delta?.type === 'thinking_delta') {
        const thinking =
          typeof delta.thinking === 'string' ? delta.thinking : '';
        return { text: '', ...(thinking ? { reasoning: thinking } : {}) };
      }
      if (delta?.type === 'input_json_delta') {
        const index = typeof event.index === 'number' ? event.index : null;
        const fragment =
          typeof delta.partial_json === 'string' ? delta.partial_json : '';
        const draft = index !== null ? state.drafts.get(index) : undefined;
        if (draft) draft.argumentsJson += fragment;
        return { text: '' };
      }
      const text = typeof delta?.text === 'string' ? delta.text : '';
      return { text };
    }
    if (type === 'message_delta') {
      const usage = asRecord(event.usage);
      if (usage) {
        runningUsage.output = tokenCount(usage, 'output_tokens');
        // The closing delta's counts are cumulative, and some servers report
        // the prompt only here (a gateway that converts another dialect's
        // stream puts its whole usage on this frame) — a prompt count on it
        // is the prompt's final figure.
        if (typeof usage.input_tokens === 'number') {
          runningUsage.input = anthropicPromptTokens(usage);
        }
        // Some Anthropic-compatible servers repeat the cache read count on
        // the closing delta rather than on message_start.
        const cached = optionalTokenCount(usage, 'cache_read_input_tokens');
        if (cached !== undefined) runningUsage.cached = cached;
      }
      const finishReason = anthropicStopReason(
        asRecord(event.delta)?.stop_reason,
      );
      return {
        text: '',
        usage: totals(runningUsage),
        ...(finishReason !== undefined ? { finishReason } : {}),
      };
    }
    return { text: '' };
  }

  const choices = Array.isArray(event.choices) ? event.choices : [];
  const delta = asRecord(asRecord(choices[0])?.delta);
  const toolCallDeltas = Array.isArray(delta?.tool_calls)
    ? delta.tool_calls
    : [];
  for (const raw of toolCallDeltas) {
    const fragment = asRecord(raw);
    if (!fragment) continue;
    const index = typeof fragment.index === 'number' ? fragment.index : 0;
    const draft = state.drafts.get(index) ?? {
      id: '',
      name: '',
      argumentsJson: '',
    };
    if (typeof fragment.id === 'string' && fragment.id.length > 0) {
      draft.id = fragment.id;
    }
    const fn = asRecord(fragment.function);
    if (fn) {
      if (typeof fn.name === 'string' && fn.name.length > 0) {
        draft.name = draft.name.length > 0 ? draft.name : fn.name;
      }
      if (typeof fn.arguments === 'string') {
        draft.argumentsJson += fn.arguments;
      }
    }
    state.drafts.set(index, draft);
  }
  const text = typeof delta?.content === 'string' ? delta.content : '';
  const reasoningDelta =
    typeof delta?.reasoning_content === 'string'
      ? delta.reasoning_content
      : typeof delta?.reasoning === 'string'
        ? delta.reasoning
        : '';
  // The reason rides the choice that ended, one event before (or on) the
  // usage frame; null on every earlier delta.
  const finishReason = openAiFinishReason(asRecord(choices[0])?.finish_reason);
  const usage = asRecord(event.usage);
  if (usage) {
    runningUsage.input = tokenCount(usage, 'prompt_tokens');
    runningUsage.output = tokenCount(usage, 'completion_tokens');
    const cached = optionalTokenCount(
      asRecord(usage.prompt_tokens_details),
      'cached_tokens',
    );
    if (cached !== undefined) runningUsage.cached = cached;
    const reasoning = optionalTokenCount(
      asRecord(usage.completion_tokens_details),
      'reasoning_tokens',
    );
    if (reasoning !== undefined) runningUsage.reasoning = reasoning;
    return {
      text,
      ...(reasoningDelta ? { reasoning: reasoningDelta } : {}),
      usage: totals(runningUsage),
      ...(finishReason !== undefined ? { finishReason } : {}),
    };
  }
  return {
    text,
    ...(reasoningDelta ? { reasoning: reasoningDelta } : {}),
    ...(finishReason !== undefined ? { finishReason } : {}),
  };
}

/** A failure a provider reported INSIDE a stream it had already opened. */
export interface StreamFailure {
  /** The provider's own sentence, or '' when it sent none. */
  readonly message: string;
  /** The provider's error code or type (`rate_limit_exceeded`,
   * `overloaded_error`), when it named one. */
  readonly code?: string;
  /** The HTTP status the failure stands for, when the provider's code is
   * one (OpenRouter reports the upstream's status as the code). */
  readonly status?: number;
}

/**
 * The failure one streamed event carries, or undefined for an ordinary
 * event.
 *
 * A stream's HTTP status is sent before the model writes its first token, so
 * everything that goes wrong afterwards — an upstream rate limit, an
 * overloaded or disconnected provider — arrives as an EVENT on a `200`
 * stream. OpenAI-compatible servers send `{"error": {…}}` (OpenRouter beside
 * a choice whose `finish_reason` is `error`); the Anthropic wire sends
 * `{"type": "error", "error": {…}}`. Read as an ordinary event it carries no
 * text and no usage, so the round used to end as a completed, empty reply:
 * the provider's words were dropped and the reader was shown nothing at all.
 */
export function readStreamFailure(
  apiFormat: ApiFormat,
  event: Record<string, unknown>,
): StreamFailure | undefined {
  const raw = event.error;
  const error = asRecord(raw);
  // An error that says something. Some servers stamp `"error": null` (or an
  // empty object) on every ordinary chunk, and that is no failure.
  const reported =
    (typeof raw === 'string' && raw.length > 0) ||
    (error !== null &&
      (typeof error.message === 'string' ||
        error.code != null ||
        error.type != null));
  const failed =
    apiFormat === 'anthropic'
      ? event.type === 'error'
      : reported ||
        (Array.isArray(event.choices) &&
          asRecord(event.choices[0])?.finish_reason === 'error');
  if (!failed) return undefined;
  if (typeof raw === 'string') return { message: raw };
  // The failure was announced with no body to go with it.
  if (!error) return { message: '' };
  const message = typeof error.message === 'string' ? error.message : '';
  const named = error.code ?? error.type;
  const code =
    typeof named === 'string' && named.length > 0
      ? named
      : typeof named === 'number'
        ? String(named)
        : undefined;
  const numeric =
    typeof error.code === 'number' ? error.code : Number(error.code);
  const status =
    Number.isInteger(numeric) && numeric >= 400 && numeric <= 599
      ? numeric
      : undefined;
  return {
    message,
    ...(code !== undefined ? { code } : {}),
    ...(status !== undefined ? { status } : {}),
  };
}

function totals(running: StreamDecodeState['running']): TurnUsage {
  return {
    inputTokens: running.input,
    outputTokens: running.output,
    totalTokens: running.input + running.output,
    ...(running.cached !== undefined
      ? { cachedInputTokens: running.cached }
      : {}),
    ...(running.reasoning !== undefined
      ? { reasoningTokens: running.reasoning }
      : {}),
  };
}
