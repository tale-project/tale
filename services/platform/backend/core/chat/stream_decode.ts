/**
 * How a streamed model answer is read, event by event, in the three dialects
 * the platform's chat speaks — OpenAI-compatible chat completions, the
 * OpenAI Responses API (for a model whose tools work only there) and
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

import { servedBy } from '../../../lib/chat/serving';
import type {
  ServedBy,
  TurnFinishReason,
  TurnUsage,
} from '../../../lib/chat/types';
import { isRecord } from '../../../lib/utils/type-utils';

/** What a stream is read as: a connector's API format, or the OpenAI
 * Responses API an OpenAI-compatible connector speaks for a model whose
 * catalog entry declares `toolCallingApi: responses`. */
export type StreamDialect = ApiFormat | 'openai-responses';

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

/** Why a Responses API answer ended, read off its closing event: a completed
 * response that called tools ends on them, an incomplete one names its
 * reason (`max_output_tokens`, `content_filter`). */
function responsesFinishReason(
  type: string,
  response: Record<string, unknown> | null,
  calledTools: boolean,
): TurnFinishReason | undefined {
  if (type === 'response.completed') return calledTools ? 'tool-calls' : 'stop';
  if (type !== 'response.incomplete') return undefined;
  const reason = asRecord(response?.incomplete_details)?.reason;
  switch (reason) {
    case 'max_output_tokens':
      return 'length';
    case 'content_filter':
      return 'content-filter';
    default:
      return 'other';
  }
}

/**
 * One Responses API event, folded the way {@link readEvent} folds the other
 * dialects. Text and refusal deltas are the reply; reasoning deltas arrive
 * only for a request that asked for summaries. A function call is announced
 * by its output item (carrying `call_id` and `name`), drips its arguments as
 * deltas, and closes with the complete arguments, which win over what the
 * deltas put together. Usage arrives once, on the closing `response.*`
 * event — never earlier, as on Chat Completions.
 */
function readResponsesEvent(
  event: Record<string, unknown>,
  state: StreamDecodeState,
): {
  text: string;
  reasoning?: string;
  usage?: TurnUsage;
  finishReason?: TurnFinishReason;
} {
  const type = typeof event.type === 'string' ? event.type : '';
  const delta = typeof event.delta === 'string' ? event.delta : '';
  const index =
    typeof event.output_index === 'number' ? event.output_index : null;
  switch (type) {
    case 'response.output_text.delta':
    case 'response.refusal.delta':
      return { text: delta };
    case 'response.reasoning_summary_text.delta':
    case 'response.reasoning_text.delta':
      return { text: '', ...(delta ? { reasoning: delta } : {}) };
    case 'response.output_item.added':
    case 'response.output_item.done': {
      const item = asRecord(event.item);
      if (item?.type !== 'function_call' || index === null) return { text: '' };
      const draft = state.drafts.get(index) ?? {
        id: '',
        name: '',
        argumentsJson: '',
      };
      // The call's own id is `call_id`; the item `id` names the stored item
      // and is never what a function result answers.
      if (typeof item.call_id === 'string' && item.call_id.length > 0) {
        draft.id = item.call_id;
      }
      if (typeof item.name === 'string' && item.name.length > 0) {
        draft.name = item.name;
      }
      if (
        type === 'response.output_item.done' &&
        typeof item.arguments === 'string'
      ) {
        draft.argumentsJson = item.arguments;
      }
      state.drafts.set(index, draft);
      return { text: '' };
    }
    case 'response.function_call_arguments.delta': {
      const draft = index !== null ? state.drafts.get(index) : undefined;
      if (draft) draft.argumentsJson += delta;
      return { text: '' };
    }
    case 'response.function_call_arguments.done': {
      const draft = index !== null ? state.drafts.get(index) : undefined;
      if (draft && typeof event.arguments === 'string') {
        draft.argumentsJson = event.arguments;
      }
      return { text: '' };
    }
    case 'response.completed':
    case 'response.incomplete':
    case 'response.failed': {
      const response = asRecord(event.response);
      const usage = asRecord(response?.usage);
      if (usage) {
        state.running.input = tokenCount(usage, 'input_tokens');
        state.running.output = tokenCount(usage, 'output_tokens');
        const cached = optionalTokenCount(
          asRecord(usage.input_tokens_details),
          'cached_tokens',
        );
        if (cached !== undefined) state.running.cached = cached;
        const reasoning = optionalTokenCount(
          asRecord(usage.output_tokens_details),
          'reasoning_tokens',
        );
        if (reasoning !== undefined) state.running.reasoning = reasoning;
      }
      const finishReason = responsesFinishReason(
        type,
        response,
        state.drafts.size > 0,
      );
      return {
        text: '',
        ...(usage ? { usage: totals(state.running) } : {}),
        ...(finishReason !== undefined ? { finishReason } : {}),
      };
    }
    default:
      return { text: '' };
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
  dialect: StreamDialect,
  event: Record<string, unknown>,
  state: StreamDecodeState,
): {
  text: string;
  reasoning?: string;
  usage?: TurnUsage;
  finishReason?: TurnFinishReason;
} {
  const runningUsage = state.running;
  if (dialect === 'openai-responses') return readResponsesEvent(event, state);
  if (dialect === 'anthropic') {
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

/**
 * What one streamed event says about where the answer is served: the model
 * id the provider reports, the upstream a gateway routed the request to, and
 * the region the provider names. OpenAI-compatible chunks carry `model`, and
 * OpenRouter adds `provider`, the upstream serving the request (`Anthropic`,
 * `Google Vertex`); the Responses API names the model on the response its
 * lifecycle events carry; the Anthropic wire names the model on
 * `message_start` and echoes the request's inference geography (`global`,
 * `us`) as `usage.inference_geo`. Undefined for an event that names nothing.
 */
export function readServedBy(
  dialect: StreamDialect,
  event: Record<string, unknown>,
): ServedBy | undefined {
  if (dialect === 'openai-responses') {
    if (
      event.type !== 'response.created' &&
      event.type !== 'response.completed'
    ) {
      return undefined;
    }
    return servedBy({ model: asRecord(event.response)?.model });
  }
  if (dialect === 'anthropic') {
    if (event.type === 'message_start') {
      const message = asRecord(event.message);
      return servedBy({
        model: message?.model,
        region: asRecord(message?.usage)?.inference_geo,
      });
    }
    if (event.type === 'message_delta') {
      return servedBy({ region: asRecord(event.usage)?.inference_geo });
    }
    return undefined;
  }
  return servedBy({ provider: event.provider, model: event.model });
}

/**
 * What a response's headers say about where it is served, read before the
 * first byte of the body. Azure OpenAI names the region of the resource that
 * processed the request in `x-ms-region` (`Sweden Central`,
 * `Switzerland North`). Undefined when the headers name nothing.
 */
export function readServedByHeaders(headers: Headers): ServedBy | undefined {
  return servedBy({ region: headers.get('x-ms-region') ?? undefined });
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
 * `{"type": "error", "error": {…}}`; the Responses API sends an `error` event
 * with its code and message on the event itself, or closes the response as
 * `response.failed` with them under `response.error`. Read as an ordinary
 * event it carries no text and no usage, so the round used to end as a
 * completed, empty reply: the provider's words were dropped and the reader
 * was shown nothing at all.
 */
export function readStreamFailure(
  dialect: StreamDialect,
  event: Record<string, unknown>,
): StreamFailure | undefined {
  if (dialect === 'openai-responses') return readResponsesFailure(event);
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
    dialect === 'anthropic'
      ? event.type === 'error'
      : reported ||
        (Array.isArray(event.choices) &&
          asRecord(event.choices[0])?.finish_reason === 'error');
  if (!failed) return undefined;
  if (typeof raw === 'string') return { message: raw };
  // The failure was announced with no body to go with it.
  if (!error) return { message: '' };
  return failureOf(error);
}

/** A Responses API failure: the `error` event (its code and message on the
 * event itself, or — from a server that wraps it — under `error`), or a
 * response that closed as `response.failed`. */
function readResponsesFailure(
  event: Record<string, unknown>,
): StreamFailure | undefined {
  if (event.type === 'error') {
    // The event's own `type` names the event, not the failure: only its
    // code may stand for one.
    return failureOf(
      asRecord(event.error) ?? { message: event.message, code: event.code },
    );
  }
  if (event.type === 'response.failed') {
    const error = asRecord(asRecord(event.response)?.error);
    return error ? failureOf(error) : { message: '' };
  }
  return undefined;
}

/** The provider's sentence, its code or type, and the HTTP status that code
 * stands for when it is one, read off one error object. */
function failureOf(error: Record<string, unknown>): StreamFailure {
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
