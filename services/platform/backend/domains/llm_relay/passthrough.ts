import { Agent } from 'undici';

import { estimateTokens } from '../../../lib/chat/types.ts';
import { isRecord } from '../../../lib/utils/type-utils.ts';
import { sanitizeError } from '../../core/lib/utils/sanitize_secrets.ts';
import {
  type UpstreamEndpoint,
  upstreamHeaders,
  upstreamUrl,
} from './endpoint.ts';
import {
  foldUsage,
  NO_USAGE,
  type RelayUsage,
  usageOfAnswer,
  usageOfEvent,
} from './usage.ts';
import { errorBody, errorResponse, type UpstreamWire } from './wires.ts';

/**
 * One call on the wire its client spoke, to an upstream that speaks it too
 * (tale-project/tale#4942): the body goes up as the client wrote it, with the
 * model's upstream id in place of the relay's name for it and the gateway's
 * own fields dropped; the answer comes back byte for byte.
 *
 * The usage the vendor reports is read on the way through, and the call
 * reports how it ended exactly once ({@link RelayCallOutcome}). A client
 * that hangs up aborts the call upstream; a call never outlives its
 * lifetime: a whole answer its request budget, a stream its idle budget
 * between two chunks and an overall ceiling.
 */

/** How a call ended, for the spend it books. */
export interface RelayCallOutcome {
  status: 'completed' | 'failed' | 'cancelled';
  usage: RelayUsage;
  /** The usage holds the relay's own count of what the vendor had not
   * reported when the call ended: output it relayed, input it was sent. */
  estimated: boolean;
  /** The upstream's HTTP status, when it answered. */
  upstreamStatus?: number;
}

/** How long one call may live. */
export interface RelayLifetime {
  /** A whole answer, start to end. */
  wholeMs: number;
  /** A stream, between two chunks from the upstream. */
  streamIdleMs: number;
  /** A stream, start to end. */
  streamMs: number;
}

const DEFAULT_IDLE_SECONDS = 600;
/** Past the vendor's own budgets, so the vendor's answer about a timeout
 * comes first. */
const LIFETIME_MARGIN_MS = 60_000;
const STREAM_CEILING_MS = 60 * 60_000;
/** The most of a refusal the relay reads before it answers. */
const MAX_ERROR_BODY_BYTES = 64 * 1024;

/** The idle budget between two chunks of a stream, in seconds:
 * `SANDBOX_LLM_GATEWAY_STREAM_IDLE_TIMEOUT_SECONDS` (the name operators set
 * for the gateway), else 600. */
export function streamIdleSeconds(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = (
    env.SANDBOX_LLM_GATEWAY_STREAM_IDLE_TIMEOUT_SECONDS ??
    env.LLM_GATEWAY_STREAM_IDLE_TIMEOUT_SECONDS
  )?.trim();
  const seconds = raw === undefined || raw === '' ? Number.NaN : Number(raw);
  return Number.isFinite(seconds) && seconds > 0
    ? seconds
    : DEFAULT_IDLE_SECONDS;
}

/** The budgets a call lives within: a whole answer and a stream's idle gap
 * at the idle budget (never below 600 s), plus the margin. */
export function relayLifetime(
  env: NodeJS.ProcessEnv = process.env,
): RelayLifetime {
  const idle = streamIdleSeconds(env);
  return {
    wholeMs: Math.max(DEFAULT_IDLE_SECONDS, idle) * 1000 + LIFETIME_MARGIN_MS,
    streamIdleMs: idle * 1000 + LIFETIME_MARGIN_MS,
    streamMs: STREAM_CEILING_MS,
  };
}

let dispatcher: Agent | undefined;

/** The connection pool to the upstreams, with the relay's budgets: undici
 * would otherwise give up after 300 s without headers or between two chunks,
 * while a slow model's prefill legitimately takes longer. */
function relayDispatcher(): Agent {
  if (dispatcher === undefined) {
    const lifetime = relayLifetime();
    dispatcher = new Agent({
      connectTimeout: 10_000,
      headersTimeout: lifetime.wholeMs,
      bodyTimeout: lifetime.streamIdleMs,
    });
  }
  return dispatcher;
}

/** The upstream call, a seam for the unit layer. */
export type UpstreamFetch = (
  url: string,
  init: RequestInit,
) => Promise<Response>;

const defaultFetch: UpstreamFetch = (url, init) =>
  fetch(url, { ...init, dispatcher: relayDispatcher() } as RequestInit & {
    dispatcher: Agent;
  });

export interface PassthroughArgs {
  endpoint: UpstreamEndpoint;
  /** The client's body, parsed. */
  body: Record<string, unknown>;
  stream: boolean;
  /** `anthropic-version` / `anthropic-beta`, as the client sent them. */
  forwarded?: { anthropicVersion?: string; anthropicBeta?: string };
  /** Headers the client asked the relay to pass on (`x-bf-eh-*`). */
  extraHeaders?: Record<string, string>;
  /** The client's connection: aborted when it hangs up. */
  signal: AbortSignal;
  /** Called exactly once, however the call ended. */
  onDone: (outcome: RelayCallOutcome) => void;
  lifetime?: Partial<RelayLifetime>;
  fetcher?: UpstreamFetch;
}

/** The headers a client may hand on to the vendor through `x-bf-eh-<name>`
 * (the gateway's convention, which harness settings use): any but those that
 * carry a credential or shape the connection. */
const NOT_FORWARDED = new Set([
  'authorization',
  'x-api-key',
  'x-goog-api-key',
  'cookie',
  'host',
  'content-length',
  'content-type',
  'connection',
  'transfer-encoding',
  'proxy-authorization',
]);

/** The `x-bf-eh-<name>` headers of a request, as `<name>`. */
export function forwardedExtraHeaders(
  headers: Headers,
): Record<string, string> {
  const extra: Record<string, string> = {};
  headers.forEach((value, name) => {
    const lower = name.toLowerCase();
    if (!lower.startsWith('x-bf-eh-')) return;
    const target = lower.slice('x-bf-eh-'.length);
    if (target === '' || NOT_FORWARDED.has(target)) return;
    extra[target] = value;
  });
  return extra;
}

/** The body as it goes upstream. */
function upstreamBody(
  wire: UpstreamWire,
  body: Record<string, unknown>,
  modelId: string,
  stream: boolean,
): Record<string, unknown> {
  const { fallbacks: _fallbacks, ...rest } = body;
  const sent: Record<string, unknown> = { ...rest, model: modelId };
  if (wire === 'openai-chat' && stream) {
    // Chat Completions reports usage on a closing chunk only when asked.
    const options = isRecord(body.stream_options) ? body.stream_options : {};
    sent.stream_options = { ...options, include_usage: true };
  }
  return sent;
}

/** What the relay sent, estimated: the request's text at the usual rate. */
function estimatedInput(body: Record<string, unknown>): number {
  const { messages, input, system, instructions, tools } = body;
  return estimateTokens(
    JSON.stringify({ messages, input, system, instructions, tools }),
  );
}

/** The text an event carries, for the estimate of output the vendor never
 * reported: answer text, reasoning and tool arguments. */
function eventText(wire: UpstreamWire, event: Record<string, unknown>): string {
  switch (wire) {
    case 'anthropic': {
      if (event.type !== 'content_block_delta' || !isRecord(event.delta))
        return '';
      const delta = event.delta;
      for (const key of ['text', 'thinking', 'partial_json']) {
        if (typeof delta[key] === 'string') return delta[key];
      }
      return '';
    }
    case 'openai-chat': {
      const choices = Array.isArray(event.choices) ? event.choices : [];
      let text = '';
      for (const choice of choices) {
        const delta =
          isRecord(choice) && isRecord(choice.delta) ? choice.delta : {};
        for (const key of ['content', 'reasoning_content', 'reasoning']) {
          if (typeof delta[key] === 'string') text += delta[key];
        }
        for (const call of Array.isArray(delta.tool_calls)
          ? delta.tool_calls
          : []) {
          const fn =
            isRecord(call) && isRecord(call.function) ? call.function : {};
          if (typeof fn.arguments === 'string') text += fn.arguments;
        }
      }
      return text;
    }
    case 'openai-responses':
      return typeof event.type === 'string' &&
        event.type.endsWith('.delta') &&
        typeof event.delta === 'string'
        ? event.delta
        : '';
    default: {
      const _exhaustive: never = wire;
      return _exhaustive;
    }
  }
}

/** Splits a byte stream into server-sent events, each with its raw text
 * (terminator included) so it can be passed on unchanged. */
class EventSplitter {
  private readonly decoder = new TextDecoder();
  private buffer = '';

  push(chunk: Uint8Array): string[] {
    this.buffer += this.decoder.decode(chunk, { stream: true });
    return this.drain();
  }

  end(): string[] {
    this.buffer += this.decoder.decode();
    const events = this.drain();
    if (this.buffer !== '') events.push(this.buffer);
    this.buffer = '';
    return events;
  }

  private drain(): string[] {
    const events: string[] = [];
    for (;;) {
      const match = /\r?\n\r?\n/.exec(this.buffer);
      if (match === null) return events;
      const end = match.index + match[0].length;
      events.push(this.buffer.slice(0, end));
      this.buffer = this.buffer.slice(end);
    }
  }
}

/** The JSON an event's `data:` lines carry, or null (`[DONE]`, comments,
 * anything unparseable). */
function eventData(raw: string): Record<string, unknown> | null {
  const data = raw
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).replace(/^ /, ''))
    .join('\n');
  if (data === '' || data === '[DONE]') return null;
  try {
    const parsed: unknown = JSON.parse(data);
    return isRecord(parsed) ? parsed : null;
  } catch (error) {
    console.warn(
      `[llm-relay] an upstream event is not JSON (${error instanceof Error ? error.message : String(error)}); passed on unread`,
    );
    return null;
  }
}

/** A Chat Completions chunk that carries only the usage the relay asked for. */
function isUsageOnlyChunk(event: Record<string, unknown>): boolean {
  return (
    isRecord(event.usage) &&
    (!Array.isArray(event.choices) || event.choices.length === 0)
  );
}

/** Read at most `limit` bytes of a body as text. */
async function readCapped(response: Response, limit: number): Promise<string> {
  if (response.body === null) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let read = 0;
  try {
    while (read < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      read += value.byteLength;
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel().catch((error: unknown) => {
      console.warn('[llm-relay] could not release a refusal body:', error);
    });
  }
  return text.slice(0, limit);
}

/**
 * The client's answer to an upstream refusal. The vendor's own error body
 * goes back with its status where it is the wire's JSON — the client reads
 * it as it reads the vendor's — except a refusal of the organization's
 * credential (401, 403), which would read as the client's own token being
 * wrong: that one is said as the relay's 502.
 */
async function upstreamRefusal(
  wire: UpstreamWire,
  response: Response,
): Promise<Response> {
  const text = await readCapped(response, MAX_ERROR_BODY_BYTES);
  if (response.status === 401 || response.status === 403) {
    return errorResponse(
      wire,
      'upstream',
      `The model provider refused the organization's credential (HTTP ${response.status}): ${sanitizeError(text, 500)}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    console.warn(
      `[llm-relay] the provider's ${response.status} answer is not JSON (${error instanceof Error ? error.message : String(error)})`,
    );
  }
  const body = isRecord(parsed)
    ? parsed
    : errorBody(
        wire,
        response.status >= 500 ? 'upstream' : 'invalid_request',
        `The model provider answered HTTP ${response.status}: ${sanitizeError(text, 500)}`,
        response.status,
      );
  return Response.json(body, { status: response.status });
}

export async function relayPassthrough(
  args: PassthroughArgs,
): Promise<Response> {
  const { endpoint, stream } = args;
  const wire = endpoint.wire;
  const lifetime = { ...relayLifetime(), ...args.lifetime };
  const fetcher = args.fetcher ?? defaultFetch;
  const sentBody = upstreamBody(wire, args.body, endpoint.modelId, stream);
  const clientAskedUsage =
    isRecord(args.body.stream_options) &&
    args.body.stream_options.include_usage === true;

  let reported = NO_USAGE;
  let reportedInput = false;
  let reportedOutput = false;
  let countedOutput = 0;
  let done = false;
  // A completed answer books what the vendor reported; one that ended early
  // books at least what the relay counted, since a vendor reports output
  // only as it goes (Anthropic) or once at the end (Chat Completions).
  const finish = (
    status: RelayCallOutcome['status'],
    upstreamStatus?: number,
  ) => {
    if (done) return;
    done = true;
    const completed = status === 'completed';
    const inputTokens = reportedInput
      ? reported.inputTokens
      : estimatedInput(args.body);
    const outputTokens =
      completed && reportedOutput
        ? reported.outputTokens
        : Math.max(reported.outputTokens, countedOutput);
    args.onDone({
      status,
      usage: { ...reported, inputTokens, outputTokens },
      estimated: !reportedInput || !reportedOutput || !completed,
      ...(upstreamStatus !== undefined ? { upstreamStatus } : {}),
    });
  };
  const note = (reading: Partial<RelayUsage> | null) => {
    if (reading === null) return;
    reported = foldUsage(reported, reading);
    if (reading.inputTokens !== undefined) reportedInput = true;
    if (reading.outputTokens !== undefined) reportedOutput = true;
  };

  if (args.signal.aborted) {
    // The client left while the request was being governed: nothing was
    // sent, nothing is booked.
    done = true;
    args.onDone({ status: 'cancelled', usage: NO_USAGE, estimated: false });
    return new Response(null, { status: 499 });
  }

  const upstream = new AbortController();
  const onClientAbort = () => upstream.abort(new Error('the client hung up'));
  args.signal.addEventListener('abort', onClientAbort, { once: true });
  const timers: ReturnType<typeof setTimeout>[] = [];
  const clear = () => {
    for (const timer of timers) clearTimeout(timer);
    args.signal.removeEventListener('abort', onClientAbort);
  };
  timers.push(
    setTimeout(
      () => upstream.abort(new Error('the call outlived its lifetime')),
      stream ? lifetime.streamMs : lifetime.wholeMs,
    ),
  );

  let response: Response;
  try {
    response = await fetcher(upstreamUrl(endpoint), {
      method: 'POST',
      headers: upstreamHeaders(endpoint, args.forwarded, args.extraHeaders),
      body: JSON.stringify(sentBody),
      signal: upstream.signal,
    });
  } catch (error) {
    clear();
    if (args.signal.aborted) {
      finish('cancelled');
      return new Response(null, { status: 499 });
    }
    // Nothing reached a vendor that answered: nothing to book.
    done = true;
    args.onDone({ status: 'failed', usage: NO_USAGE, estimated: false });
    return errorResponse(
      wire,
      upstream.signal.aborted ? 'timeout' : 'upstream',
      `The model provider could not be reached: ${sanitizeError(error, 300)}`,
    );
  }

  if (!response.ok) {
    clear();
    done = true;
    // A refused request consumed nothing.
    args.onDone({
      status: 'failed',
      usage: NO_USAGE,
      estimated: false,
      upstreamStatus: response.status,
    });
    return upstreamRefusal(wire, response);
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (
    !stream ||
    !contentType.includes('text/event-stream') ||
    response.body === null
  ) {
    try {
      const text = await response.text();
      clear();
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(text);
      } catch (error) {
        console.warn(
          `[llm-relay] a whole answer from "${endpoint.connector}" is not JSON (${error instanceof Error ? error.message : String(error)})`,
        );
      }
      note(usageOfAnswer(wire, parsed));
      finish('completed', response.status);
      return new Response(text, {
        status: response.status,
        headers: { 'content-type': contentType || 'application/json' },
      });
    } catch (error) {
      clear();
      finish(args.signal.aborted ? 'cancelled' : 'failed', response.status);
      return errorResponse(
        wire,
        upstream.signal.aborted && !args.signal.aborted
          ? 'timeout'
          : 'upstream',
        `The model provider's answer broke off: ${sanitizeError(error, 300)}`,
      );
    }
  }

  // A stream: passed on event by event, its usage read on the way.
  const reader = response.body.getReader();
  const splitter = new EventSplitter();
  const encoder = new TextEncoder();
  let idle: ReturnType<typeof setTimeout> | undefined;
  const touch = () => {
    if (idle !== undefined) clearTimeout(idle);
    idle = setTimeout(
      () => upstream.abort(new Error('the stream went silent')),
      lifetime.streamIdleMs,
    );
    timers.push(idle);
  };
  touch();
  const pass = (raw: string): string | null => {
    const event = eventData(raw);
    if (event === null) return raw;
    note(usageOfEvent(wire, event));
    const text = eventText(wire, event);
    if (text !== '') countedOutput += estimateTokens(text);
    if (
      wire === 'openai-chat' &&
      !clientAskedUsage &&
      isUsageOnlyChunk(event)
    ) {
      return null;
    }
    return raw;
  };
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done: ended, value } = await reader.read();
        if (ended) {
          for (const raw of splitter.end()) {
            const kept = pass(raw);
            if (kept !== null) controller.enqueue(encoder.encode(kept));
          }
          clear();
          controller.close();
          finish('completed', response.status);
          return;
        }
        touch();
        for (const raw of splitter.push(value)) {
          const kept = pass(raw);
          if (kept !== null) controller.enqueue(encoder.encode(kept));
        }
      } catch (error) {
        clear();
        finish(args.signal.aborted ? 'cancelled' : 'failed', response.status);
        controller.error(error);
      }
    },
    async cancel(reason) {
      clear();
      upstream.abort(
        reason instanceof Error ? reason : new Error('the client hung up'),
      );
      finish('cancelled', response.status);
      await reader.cancel(reason).catch((error: unknown) => {
        console.warn('[llm-relay] could not cancel an upstream stream:', error);
      });
    },
  });
  return new Response(body, {
    status: response.status,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
    },
  });
}
