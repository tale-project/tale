import { Agent } from 'undici';

import { estimateTokens, type TurnUsage } from '../../../lib/chat/types.ts';
import { isRecord } from '../../../lib/utils/type-utils.ts';
import {
  readEvent,
  type StreamDecodeState,
} from '../../core/chat/stream_decode.ts';
import { sanitizeError } from '../../core/lib/utils/sanitize_secrets.ts';
import {
  gatewayInferenceUrl,
  gatewayRequestTimeoutSeconds,
  gatewayStreamIdleTimeoutSeconds,
} from '../../core/node_only/sandbox/llm_gateway_admin.ts';
import type { ModelApiUsage } from './metering.ts';
import {
  type ModelApiWire,
  ModelApiRefusal,
  wireErrorBody,
  wireHeaders,
} from './wire.ts';

/**
 * The relay leg of a model-endpoint request: the caller's body, already
 * governed, goes to the sandbox LLM gateway's own vendor-compatible door —
 * `/openai/v1/chat/completions` or `/anthropic/v1/messages`, the doors the
 * managed harnesses use — under the request's virtual key, and the answer
 * comes back to the caller in its own wire:
 *
 *  - the `model` it names is the id the caller asked for, never the
 *    gateway's routing name (which carries the organization's id);
 *  - the usage the answer reports is read on the way through, for the
 *    ledger; on an OpenAI stream the door asks for the closing usage chunk
 *    and drops it again when the caller did not ask for it;
 *  - a refusal the gateway or the vendor answers is said in the wire's error
 *    shape, with the routing names replaced and internal addresses kept out;
 *  - the caller hanging up aborts the request to the gateway, and the
 *    gateway cancels its call to the vendor, whole answer or stream — but
 *    books only the usage the vendor had reported by then (on an OpenAI
 *    stream, none). So an answer that ends early reports what the
 *    settlement books it at anyway (`metering.ts`): the output the relay
 *    counted, which on a whole answer is none. A caller that hung up
 *    before the request was sent — while it was being governed — is not
 *    sent at all, and reports nothing to book;
 *  - a request never outlives its lifetime: a whole answer the gateway's
 *    request timeout plus a margin, a stream its idle budget between two
 *    chunks and an overall ceiling — past either, the relay aborts the
 *    gateway call, ends the caller's answer and reports the ending.
 *
 * Nothing but the body, the key and the Anthropic version headers is sent
 * upstream: the gateway reads its own instructions from `x-bf-*` headers,
 * and no header of the caller's reaches it.
 */

/** How the answer ended, for the op row and the settlement. */
export interface RelayOutcome {
  status: 'completed' | 'failed' | 'cancelled';
  /** The counts the answer reported (the vendor's). */
  usage?: ModelApiUsage;
  /** Set on an answer that ended early: the tokens the relay counted in the
   * stream's text, reasoning and tool arguments by then — 0 on a whole
   * answer, which relays nothing before it is complete. Never set on a
   * request that did not leave this process. */
  countedOutputTokens?: number;
}

export interface RelayArgs {
  wire: ModelApiWire;
  /** The model id the caller named — what the answer says it came from. */
  publicModel: string;
  /** The model's gateway routing name, replaced wherever it shows. */
  gatewayModel: string;
  /** The request's virtual key. */
  token: string;
  body: Record<string, unknown>;
  stream: boolean;
  /** An OpenAI stream whose caller did not ask for the usage chunk. */
  dropUsageChunk: boolean;
  /** `anthropic-version` / `anthropic-beta`, as the caller sent them. */
  anthropicHeaders: Record<string, string>;
  requestId: string | undefined;
  /** The caller's connection: aborted when they hang up. */
  signal: AbortSignal;
  /** Called exactly once, when the answer has ended however it ended. */
  onDone: (outcome: RelayOutcome) => void;
  /** Lifetime overrides — the unit layer's; production reads the
   * gateway's budgets ({@link relayLifetime}). */
  lifetime?: Partial<RelayLifetime>;
}

/** How long one relayed request may live. */
export interface RelayLifetime {
  /** A whole answer, start to end. */
  wholeMs: number;
  /** A stream, between two chunks from the gateway. */
  streamIdleMs: number;
  /** A stream, start to end. */
  streamMs: number;
}

/** The margin the relay gives the gateway past its own budgets, so the
 * gateway's own timeout (and its answer about it) comes first. */
const LIFETIME_MARGIN_MS = 60_000;
/** The longest a stream may run: generous for the longest answers a model
 * writes, and a bound on the heartbeat and the hold of a stream that never
 * ends. */
const STREAM_CEILING_MS = 60 * 60_000;

/** The gateway's budgets, plus the margin. */
export function relayLifetime(): RelayLifetime {
  return {
    wholeMs: gatewayRequestTimeoutSeconds() * 1000 + LIFETIME_MARGIN_MS,
    streamIdleMs: gatewayStreamIdleTimeoutSeconds() * 1000 + LIFETIME_MARGIN_MS,
    streamMs: STREAM_CEILING_MS,
  };
}

/** The gateway routes, per wire. */
const GATEWAY_ROUTES: Readonly<Record<ModelApiWire, string>> = {
  openai: '/openai/v1/chat/completions',
  anthropic: '/anthropic/v1/messages',
};

/** The most of a refusal body the door reads before it answers. */
const MAX_ERROR_BODY_BYTES = 64 * 1024;

let dispatcher: Agent | undefined;

/**
 * The connection pool to the gateway, with the gateway's own time budgets:
 * undici would give up after 300 s without response headers or between two
 * chunks, while the gateway waits up to its request timeout for a whole
 * answer and up to its idle budget for the next byte of a stream — a slow
 * model's prefill would otherwise be cut off here while it was still being
 * served (and billed).
 */
function gatewayDispatcher(): Agent {
  if (dispatcher === undefined) {
    dispatcher = new Agent({
      connectTimeout: 10_000,
      headersTimeout: (gatewayRequestTimeoutSeconds() + 60) * 1000,
      bodyTimeout: (gatewayStreamIdleTimeoutSeconds() + 60) * 1000,
    });
  }
  return dispatcher;
}

/** The system codes of a gateway connection that was never made: the
 * gateway refused or could not be found (a container being replaced by a
 * deploy refuses), or the connect timed out. */
const NOT_CONNECTED_CODES: ReadonlySet<string> = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
]);

/** Whether a failed gateway call never had a connection, so no request left
 * this process. undici's `fetch failed` carries the reason on its `cause`. */
function neverConnected(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && isRecord(current); depth++) {
    const code = current.code;
    if (typeof code === 'string' && NOT_CONNECTED_CODES.has(code)) return true;
    current = current.cause;
  }
  return false;
}

/** The gateway call, a seam for the unit layer. */
export type GatewayFetch = (
  url: string,
  init: RequestInit,
) => Promise<Response>;

let gatewayFetch: GatewayFetch = (url, init) =>
  fetch(url, {
    ...init,
    dispatcher: gatewayDispatcher(),
  } as RequestInit & { dispatcher: Agent });

/** Test seam: route the gateway call elsewhere; returns the restore. */
export function setGatewayFetchForTests(fetcher: GatewayFetch): () => void {
  const previous = gatewayFetch;
  gatewayFetch = fetcher;
  return () => {
    gatewayFetch = previous;
  };
}

/**
 * Text that tells where the platform's own traffic goes rather than what
 * was wrong with the request: an IP address, a host with a port, a URL on an
 * internal host, or a transport failure's wording (which names the address
 * it failed on). A vendor's refusal of the request itself — a field out of
 * range, a model it does not serve — carries none of it.
 */
const INTERNAL_DETAIL: readonly RegExp[] = [
  /\b(?:\d{1,3}\.){3}\d{1,3}\b/,
  /\b[0-9a-f]{1,4}::[0-9a-f]{0,4}\b/i,
  /\[[0-9a-f:.]{3,}\]/i,
  /\b[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9-]+)*:\d{2,5}\b/i,
  /\bhttps?:\/\/(?:localhost|[a-z0-9-]+|[a-z0-9.-]+\.(?:internal|local|lan|svc|cluster\.local))(?:[:/?#]|$)/i,
  /\b(?:dial tcp|connection refused|connection reset|no such host|i\/o timeout|tls handshake|context deadline exceeded|broken pipe|unexpected eof)\b/i,
];

/** Whether a relayed message would name the platform's internals. */
/**
 * Drop the gateway's own bookkeeping from an answer or a stream event. The
 * gateway adds `extra_fields` beside the vendor's fields — its routing name
 * for the provider (which carries the organization's id), the virtual key's
 * name, latency and chunk counters — none of which belongs to the OpenAI or
 * Anthropic shape the caller asked for, and none of which it should see.
 */
function withoutGatewayFields(
  record: Record<string, unknown>,
): Record<string, unknown> {
  delete record.extra_fields;
  return record;
}

function namesInternalDetail(text: string): boolean {
  return INTERNAL_DETAIL.some((pattern) => pattern.test(text));
}

/** Replace the gateway's routing names — the record carries the
 * organization's id — with what the caller named, and redact anything
 * secret-shaped. A message that would name an internal address or a
 * transport failure is replaced by `fallback` whole (the detail is logged
 * for the operator): redacting pieces of it would still leave the shape of
 * the platform's network in the caller's hands. */
function sanitizer({
  gatewayModel,
  publicModel,
}: {
  gatewayModel: string;
  publicModel: string;
}): (text: string, fallback: string) => string {
  const record = gatewayModel.slice(0, gatewayModel.indexOf('/'));
  const provider = publicModel.slice(0, publicModel.indexOf('/'));
  return (text, fallback) => {
    let out = text.split(gatewayModel).join(publicModel);
    if (record.length > 0) out = out.split(record).join(provider);
    const safe = sanitizeError(out, 2_000);
    if (namesInternalDetail(safe)) {
      console.warn(
        `[model-api] an upstream message named internal detail; the caller reads a generic one instead: ${safe}`,
      );
      return fallback;
    }
    return safe;
  };
}

function usageOf(usage: TurnUsage | undefined): ModelApiUsage | undefined {
  return usage === undefined
    ? undefined
    : {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        ...(usage.cachedInputTokens !== undefined
          ? { cachedInputTokens: usage.cachedInputTokens }
          : {}),
      };
}

/** The usage a whole (non-streamed) answer reports, through the same
 * decoder a stream's events go through. */
function answerUsage(
  wire: ModelApiWire,
  answer: Record<string, unknown>,
): ModelApiUsage | undefined {
  const state: StreamDecodeState = {
    running: { input: 0, output: 0 },
    drafts: new Map(),
  };
  if (wire === 'openai') {
    return usageOf(readEvent('openai', answer, state).usage);
  }
  if (!isRecord(answer.usage)) return undefined;
  readEvent('anthropic', { type: 'message_start', message: answer }, state);
  return usageOf(
    readEvent(
      'anthropic',
      { type: 'message_delta', usage: answer.usage },
      state,
    ).usage,
  );
}

/** The error an upstream refusal is relayed as: the vendor's message (the
 * routing names replaced), its own `type` when it named one, and a status
 * the caller can act on — a refusal of the request itself keeps its 4xx, a
 * vendor rate limit its 429, an overloaded vendor its 503/529; anything
 * that says the platform's own wiring failed (the key, the route, the
 * model's upstream name) is a 502. */
async function upstreamRefusal(
  wire: ModelApiWire,
  response: Response,
  sanitize: (text: string, fallback: string) => string,
  requestId: string | undefined,
): Promise<{ status: number; body: Record<string, unknown> }> {
  let text = '';
  try {
    const reader = response.body?.getReader();
    if (reader !== undefined) {
      const decoder = new TextDecoder();
      let read = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        read += value.byteLength;
        text += decoder.decode(value, { stream: true });
        if (read > MAX_ERROR_BODY_BYTES) {
          await reader.cancel();
          break;
        }
      }
    }
  } catch (error) {
    console.warn('[model-api] reading the gateway refusal failed:', error);
  }
  const generic = `The model provider refused the request (HTTP ${response.status}).`;
  let message = generic;
  let type: string | undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    const error = isRecord(parsed) ? parsed.error : undefined;
    if (isRecord(error)) {
      if (typeof error.message === 'string' && error.message !== '') {
        message = error.message;
      }
      if (typeof error.type === 'string' && error.type !== '')
        type = error.type;
    } else if (typeof error === 'string' && error !== '') {
      message = error;
    }
  } catch (error) {
    if (text.trim() !== '') message = text.trim().slice(0, 500);
    console.warn(
      '[model-api] the gateway refusal was not JSON:',
      error instanceof Error ? error.message : error,
    );
  }
  const upstream = response.status;
  const status =
    upstream === 400 || upstream === 413 || upstream === 422
      ? upstream
      : upstream === 429 || upstream === 503 || upstream === 529
        ? upstream
        : 502;
  return {
    status,
    body: wireErrorBody(
      wire,
      {
        status,
        code: 'MODEL_API_UPSTREAM_ERROR',
        message: sanitize(message, generic),
        ...(status === upstream && type !== undefined ? { type } : {}),
      },
      requestId,
    ),
  };
}

/** Rewrite one decoded event of a relayed stream. Answers null to drop it. */
type EventRewrite = (
  data: Record<string, unknown>,
) => Record<string, unknown> | null;

/** The generated text one streamed event carries — answer text, reasoning
 * and tool-call arguments alike, since the vendor bills them all as output —
 * for the relay's own count of a stream that ends early. */
function generatedText(
  wire: ModelApiWire,
  event: Record<string, unknown>,
): string {
  let text = '';
  if (wire === 'anthropic') {
    const delta = isRecord(event.delta) ? event.delta : undefined;
    if (event.type !== 'content_block_delta' || delta === undefined) return '';
    for (const key of ['text', 'thinking', 'partial_json']) {
      const value = delta[key];
      if (typeof value === 'string') text += value;
    }
    return text;
  }
  const choices = Array.isArray(event.choices) ? event.choices : [];
  for (const choice of choices) {
    const delta =
      isRecord(choice) && isRecord(choice.delta) ? choice.delta : undefined;
    if (delta === undefined) continue;
    for (const key of [
      'content',
      'reasoning_content',
      'reasoning',
      'refusal',
    ]) {
      const value = delta[key];
      if (typeof value === 'string') text += value;
    }
    const calls = Array.isArray(delta.tool_calls) ? delta.tool_calls : [];
    for (const call of calls) {
      const fn =
        isRecord(call) && isRecord(call.function) ? call.function : undefined;
      if (fn !== undefined && typeof fn.arguments === 'string') {
        text += fn.arguments;
      }
    }
  }
  return text;
}

/** What a relayed stream reports when it ends. */
interface StreamEnd {
  status: RelayOutcome['status'];
  usage?: ModelApiUsage;
  countedOutputTokens: number;
}

/**
 * The relayed stream: the gateway's Server-Sent Events, event by event, each
 * `data:` JSON passed through `rewrite` (and the usage read off it, and its
 * generated text counted), every other line kept as it came. Ends the
 * caller's stream with an error event in the wire's shape when the upstream
 * breaks off or the request outlives its lifetime.
 */
function relayEventStream(
  upstream: ReadableStream<Uint8Array>,
  args: {
    wire: ModelApiWire;
    rewrite: EventRewrite;
    sanitize: (text: string, fallback: string) => string;
    abortUpstream: () => void;
    /** Whether the caller has hung up — a read that fails then is the
     * abort, not a broken upstream. */
    callerGone: () => boolean;
    /** Whether the relay itself stopped the request (its lifetime ran
     * out): the break-off then says so. */
    expired: () => boolean;
    /** Called on every chunk from the gateway — the idle deadline's reset. */
    onChunk: () => void;
    requestId: string | undefined;
    onEnd: (end: StreamEnd) => void;
  },
): ReadableStream<Uint8Array> {
  const {
    wire,
    rewrite,
    sanitize,
    abortUpstream,
    callerGone,
    expired,
    onChunk,
    requestId,
    onEnd,
  } = args;
  const reader = upstream.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const state: StreamDecodeState = {
    running: { input: 0, output: 0 },
    drafts: new Map(),
  };
  let usage: TurnUsage | undefined;
  let countedOutputTokens = 0;
  let buffer = '';
  let ended = false;
  const end = (status: RelayOutcome['status']) => {
    if (ended) return;
    ended = true;
    const reported = usageOf(usage);
    onEnd({
      status,
      ...(reported !== undefined ? { usage: reported } : {}),
      countedOutputTokens,
    });
  };

  /** One event block (its lines, without the blank line that ended it), as
   * the caller receives it — or '' to drop it. */
  const renderEvent = (block: string): string => {
    const lines = block.split('\n');
    const data = lines
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(line.startsWith('data: ') ? 6 : 5));
    if (data.length === 0) return `${block}\n\n`;
    const payload = data.join('\n');
    if (payload.trim() === '[DONE]') return `${block}\n\n`;
    let event: unknown;
    try {
      event = JSON.parse(payload);
    } catch (error) {
      console.warn(
        '[model-api] relaying an event whose data is not JSON unchanged:',
        error instanceof Error ? error.message : error,
      );
      return `${block}\n\n`;
    }
    if (!isRecord(event)) return `${block}\n\n`;
    const read = readEvent(
      wire === 'openai' ? 'openai' : 'anthropic',
      event,
      state,
    );
    if (read.usage !== undefined) usage = read.usage;
    const generated = generatedText(wire, event);
    if (generated !== '') countedOutputTokens += estimateTokens(generated);
    const error = event.error;
    if (isRecord(error) && typeof error.message === 'string') {
      error.message = sanitize(
        error.message,
        'The model provider stopped the answer with an error.',
      );
    }
    const rewritten = rewrite(event);
    if (rewritten === null) return '';
    const kept = lines.filter((line) => !line.startsWith('data:'));
    return `${[...kept, `data: ${JSON.stringify(rewritten)}`].join('\n')}\n\n`;
  };

  /** Every complete event in the buffer, rendered; the unfinished tail
   * stays buffered. */
  const drain = (): string => {
    // One line ending: CRLF and a lone CR read as LF; a CR at the very end
    // may be half of a CRLF still in flight, so it waits.
    const pendingCr = buffer.endsWith('\r');
    let text = pendingCr ? buffer.slice(0, -1) : buffer;
    text = text.replace(/\r\n?/g, '\n');
    let out = '';
    let boundary = text.indexOf('\n\n');
    while (boundary !== -1) {
      out += renderEvent(text.slice(0, boundary));
      text = text.slice(boundary + 2);
      boundary = text.indexOf('\n\n');
    }
    buffer = pendingCr ? `${text}\r` : text;
    return out;
  };

  const breakOff = (): string => {
    const lapsed = expired();
    const body = wireErrorBody(
      wire,
      {
        status: lapsed ? 504 : 502,
        code: 'MODEL_API_UPSTREAM_ERROR',
        message: lapsed
          ? 'The model stream went quiet for too long, or ran past the longest answer this endpoint relays; it was stopped.'
          : 'The model stream broke off before the answer was complete.',
      },
      requestId,
    );
    return wire === 'anthropic'
      ? `event: error\ndata: ${JSON.stringify(body)}\n\n`
      : `data: ${JSON.stringify(body)}\n\n`;
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) {
            buffer += decoder.decode();
            const rest = drain();
            const tail = buffer.replace(/\r\n?/g, '\n').trim();
            const out = rest + (tail === '' ? '' : renderEvent(tail));
            if (out !== '') controller.enqueue(encoder.encode(out));
            controller.close();
            end('completed');
            return;
          }
          onChunk();
          buffer += decoder.decode(value, { stream: true });
          const out = drain();
          if (out !== '') {
            controller.enqueue(encoder.encode(out));
            return;
          }
        }
      } catch (error) {
        if (ended || (callerGone() && !expired())) {
          // The caller hung up (the upstream read failed on the abort):
          // nobody reads on, so the stream is ended — never left open for
          // another pull to read the aborted upstream again.
          end('cancelled');
          try {
            controller.error(error);
          } catch (closeError) {
            console.warn(
              '[model-api] the caller stream was already closed:',
              closeError,
            );
          }
          return;
        }
        console.warn(
          expired()
            ? '[model-api] the gateway stream outlived its lifetime and was stopped:'
            : '[model-api] the gateway stream broke off:',
          error,
        );
        try {
          controller.enqueue(encoder.encode(breakOff()));
          controller.close();
        } catch (closeError) {
          console.warn(
            '[model-api] the caller stream closed before the break-off event:',
            closeError,
          );
        }
        end('failed');
      }
    },
    async cancel() {
      // The caller hung up: stop the gateway call (on a stream, the gateway
      // cancels the vendor's in turn).
      abortUpstream();
      await reader.cancel().catch((error: unknown) => {
        console.warn(
          '[model-api] cancelling the gateway stream failed:',
          error,
        );
      });
      end('cancelled');
    },
  });
}

/**
 * Relay one governed request to the gateway and answer the caller. Throws a
 * {@link ModelApiRefusal} only when the gateway call failed before an answer
 * could begin (`onDone` has been called by then); every other ending — a
 * refusal upstream, a finished or broken stream, the caller hanging up, the
 * lifetime running out — calls `onDone` once.
 *
 * Nothing the returned stream keeps alive holds the request body: every
 * closure below reads the few scalars copied out of `args` first, so a
 * multi-megabyte image payload is released once it has been sent, however
 * long the answer streams.
 */
export async function relayToGateway(args: RelayArgs): Promise<Response> {
  const {
    wire,
    publicModel,
    stream,
    dropUsageChunk,
    requestId,
    signal,
    onDone,
  } = args;
  const lifetime = { ...relayLifetime(), ...args.lifetime };
  const sanitize = sanitizer(args);
  const upstreamAbort = new AbortController();
  const abortUpstream = () => upstreamAbort.abort();
  let lapsed = false;
  const expire = () => {
    lapsed = true;
    abortUpstream();
  };
  const lifetimeTimer = setTimeout(
    expire,
    stream ? lifetime.streamMs : lifetime.wholeMs,
  );
  lifetimeTimer.unref?.();
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const armIdle = () => {
    if (idleTimer !== undefined) clearTimeout(idleTimer);
    idleTimer = setTimeout(expire, lifetime.streamIdleMs);
    idleTimer.unref?.();
  };
  signal.addEventListener('abort', abortUpstream, { once: true });
  let settled = false;
  const done = (outcome: RelayOutcome) => {
    if (settled) return;
    settled = true;
    clearTimeout(lifetimeTimer);
    if (idleTimer !== undefined) clearTimeout(idleTimer);
    signal.removeEventListener('abort', abortUpstream);
    onDone(outcome);
  };
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    authorization: `Bearer ${args.token}`,
    accept: stream ? 'text/event-stream' : 'application/json',
    ...(wire === 'anthropic' ? args.anthropicHeaders : {}),
  };
  const payload = JSON.stringify(args.body);
  if (stream) armIdle();
  let upstream: Response;
  // Whether the request may have left this process: set as the gateway call
  // is made, never before.
  let dispatched = false;
  try {
    // A caller that hung up while the request was being governed — its
    // guardrails judging it, its hold being taken, its key being minted — is
    // not sent at all.
    signal.throwIfAborted();
    dispatched = true;
    upstream = await gatewayFetch(gatewayInferenceUrl(GATEWAY_ROUTES[wire]), {
      method: 'POST',
      headers,
      body: payload,
      signal: upstreamAbort.signal,
    });
  } catch (error) {
    const cancelled = signal.aborted && !lapsed;
    // A request that never left this process — the caller hung up before it
    // was sent, or it never got a connection — costs nothing. Any other may
    // have reached the gateway, and the vendor its prompt, before the call
    // failed.
    done({
      status: cancelled ? 'cancelled' : 'failed',
      ...(dispatched && !neverConnected(error)
        ? { countedOutputTokens: 0 }
        : {}),
    });
    if (lapsed) {
      console.warn(
        '[model-api] the gateway call outlived its lifetime:',
        error,
      );
      throw new ModelApiRefusal(
        504,
        'MODEL_API_UPSTREAM_ERROR',
        'The model did not answer in time; the request was stopped.',
      );
    }
    if (!cancelled) {
      console.error(
        '[model-api] the model gateway could not be reached:',
        error,
      );
    }
    throw new ModelApiRefusal(
      502,
      'MODEL_API_UPSTREAM_ERROR',
      'The model gateway could not be reached; try again shortly.',
    );
  }
  const answerHeaders = wireHeaders(wire, requestId);
  if (!upstream.ok) {
    const refusal = await upstreamRefusal(wire, upstream, sanitize, requestId);
    done({ status: 'failed' });
    return new Response(JSON.stringify(refusal.body), {
      status: refusal.status,
      headers: { 'content-type': 'application/json', ...answerHeaders },
    });
  }

  if (stream && upstream.body !== null) {
    const rewrite: EventRewrite =
      wire === 'openai'
        ? (event) => {
            if (
              dropUsageChunk &&
              Array.isArray(event.choices) &&
              event.choices.length === 0 &&
              isRecord(event.usage)
            ) {
              return null;
            }
            if (typeof event.model === 'string') event.model = publicModel;
            return withoutGatewayFields(event);
          }
        : (event) => {
            if (
              event.type === 'message_start' &&
              isRecord(event.message) &&
              typeof event.message.model === 'string'
            ) {
              event.message.model = publicModel;
            }
            if (isRecord(event.message)) withoutGatewayFields(event.message);
            return withoutGatewayFields(event);
          };
    const body = relayEventStream(upstream.body, {
      wire,
      rewrite,
      sanitize,
      abortUpstream,
      callerGone: () => signal.aborted,
      expired: () => lapsed,
      onChunk: armIdle,
      requestId,
      onEnd: (end) => done(end),
    });
    return new Response(body, {
      status: 200,
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        'x-accel-buffering': 'no',
        ...answerHeaders,
      },
    });
  }

  let text: string;
  try {
    text = await upstream.text();
  } catch (error) {
    const cancelled = signal.aborted && !lapsed;
    done({
      status: cancelled ? 'cancelled' : 'failed',
      countedOutputTokens: 0,
    });
    console.warn('[model-api] reading the gateway answer failed:', error);
    throw new ModelApiRefusal(
      lapsed ? 504 : 502,
      'MODEL_API_UPSTREAM_ERROR',
      lapsed
        ? 'The model did not answer in time; the request was stopped.'
        : 'The model answer could not be read from the gateway; try again.',
    );
  }
  let answer: unknown;
  try {
    answer = JSON.parse(text);
  } catch (error) {
    done({ status: 'failed', countedOutputTokens: 0 });
    console.warn('[model-api] the gateway answer was not JSON:', error);
    throw new ModelApiRefusal(
      502,
      'MODEL_API_UPSTREAM_ERROR',
      'The model gateway answered something that is not JSON.',
    );
  }
  if (!isRecord(answer)) {
    done({ status: 'failed', countedOutputTokens: 0 });
    throw new ModelApiRefusal(
      502,
      'MODEL_API_UPSTREAM_ERROR',
      'The model gateway answered something that is not a JSON object.',
    );
  }
  const usage = answerUsage(wire, answer);
  if (typeof answer.model === 'string') answer.model = publicModel;
  withoutGatewayFields(answer);
  done({ status: 'completed', ...(usage !== undefined ? { usage } : {}) });
  return new Response(JSON.stringify(answer), {
    status: 200,
    headers: { 'content-type': 'application/json', ...answerHeaders },
  });
}
