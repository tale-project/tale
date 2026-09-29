import { Agent } from 'undici';

import type { TurnUsage } from '../../../lib/chat/types.ts';
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
 *    shape, with the routing names replaced;
 *  - the caller hanging up aborts the upstream request, so the vendor stops
 *    generating what nobody will read.
 *
 * Nothing but the body, the key and the Anthropic version headers is sent
 * upstream: the gateway reads its own instructions from `x-bf-*` headers,
 * and no header of the caller's reaches it.
 */

/** How the answer ended, for the op row and the settlement. */
export interface RelayOutcome {
  status: 'completed' | 'failed' | 'cancelled';
  usage?: ModelApiUsage;
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

/** Replace the gateway's routing names — the record carries the
 * organization's id — with what the caller named, and redact anything
 * secret-shaped. */
function sanitizer(args: {
  gatewayModel: string;
  publicModel: string;
}): (text: string) => string {
  const record = args.gatewayModel.slice(0, args.gatewayModel.indexOf('/'));
  return (text) => {
    let out = text.split(args.gatewayModel).join(args.publicModel);
    if (record.length > 0) {
      const provider = args.publicModel.slice(0, args.publicModel.indexOf('/'));
      out = out.split(record).join(provider);
    }
    return sanitizeError(out, 2_000);
  };
}

function usageOf(usage: TurnUsage | undefined): ModelApiUsage | undefined {
  return usage === undefined
    ? undefined
    : { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens };
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
  sanitize: (text: string) => string,
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
  let message = `The model provider refused the request (HTTP ${response.status}).`;
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
        message: sanitize(message),
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

/**
 * The relayed stream: the gateway's Server-Sent Events, event by event, each
 * `data:` JSON passed through `rewrite` (and the usage read off it), every
 * other line kept as it came. Ends the caller's stream with an error event
 * in the wire's shape when the upstream breaks off.
 */
function relayEventStream(
  upstream: ReadableStream<Uint8Array>,
  args: {
    wire: ModelApiWire;
    rewrite: EventRewrite;
    sanitize: (text: string) => string;
    abortUpstream: () => void;
    /** Whether the caller has hung up — a read that fails then is the
     * abort, not a broken upstream. */
    callerGone: () => boolean;
    requestId: string | undefined;
    onEnd: (status: RelayOutcome['status'], usage?: ModelApiUsage) => void;
  },
): ReadableStream<Uint8Array> {
  const reader = upstream.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const state: StreamDecodeState = {
    running: { input: 0, output: 0 },
    drafts: new Map(),
  };
  let usage: TurnUsage | undefined;
  let buffer = '';
  let ended = false;
  const end = (status: RelayOutcome['status']) => {
    if (ended) return;
    ended = true;
    args.onEnd(status, usageOf(usage));
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
      args.wire === 'openai' ? 'openai' : 'anthropic',
      event,
      state,
    );
    if (read.usage !== undefined) usage = read.usage;
    const error = event.error;
    if (isRecord(error) && typeof error.message === 'string') {
      error.message = args.sanitize(error.message);
    }
    const rewritten = args.rewrite(event);
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
    const message =
      'The model stream broke off before the answer was complete.';
    const body = wireErrorBody(
      args.wire,
      { status: 502, code: 'MODEL_API_UPSTREAM_ERROR', message },
      args.requestId,
    );
    return args.wire === 'anthropic'
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
          buffer += decoder.decode(value, { stream: true });
          const out = drain();
          if (out !== '') {
            controller.enqueue(encoder.encode(out));
            return;
          }
        }
      } catch (error) {
        if (ended || args.callerGone()) {
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
        console.warn('[model-api] the gateway stream broke off:', error);
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
      // The caller hung up: stop the vendor too.
      args.abortUpstream();
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
 * {@link ModelApiRefusal} only when the gateway could not be reached at all
 * (`onDone` has been called by then); every other ending — a refusal
 * upstream, a finished or broken stream, the caller hanging up — calls
 * `onDone` once.
 */
export async function relayToGateway(args: RelayArgs): Promise<Response> {
  const sanitize = sanitizer(args);
  const upstreamAbort = new AbortController();
  const abortUpstream = () => upstreamAbort.abort();
  if (args.signal.aborted) abortUpstream();
  args.signal.addEventListener('abort', abortUpstream, { once: true });
  let settled = false;
  const done = (outcome: RelayOutcome) => {
    if (settled) return;
    settled = true;
    args.signal.removeEventListener('abort', abortUpstream);
    args.onDone(outcome);
  };
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    authorization: `Bearer ${args.token}`,
    accept: args.stream ? 'text/event-stream' : 'application/json',
    ...(args.wire === 'anthropic' ? args.anthropicHeaders : {}),
  };
  let upstream: Response;
  try {
    upstream = await gatewayFetch(
      gatewayInferenceUrl(GATEWAY_ROUTES[args.wire]),
      {
        method: 'POST',
        headers,
        body: JSON.stringify(args.body),
        signal: upstreamAbort.signal,
      },
    );
  } catch (error) {
    const cancelled = args.signal.aborted;
    done({ status: cancelled ? 'cancelled' : 'failed' });
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
  const answerHeaders = wireHeaders(args.wire, args.requestId);
  if (!upstream.ok) {
    const refusal = await upstreamRefusal(
      args.wire,
      upstream,
      sanitize,
      args.requestId,
    );
    done({ status: 'failed' });
    return new Response(JSON.stringify(refusal.body), {
      status: refusal.status,
      headers: { 'content-type': 'application/json', ...answerHeaders },
    });
  }

  const publicModel = args.publicModel;
  if (args.stream && upstream.body !== null) {
    const rewrite: EventRewrite =
      args.wire === 'openai'
        ? (event) => {
            if (
              args.dropUsageChunk &&
              Array.isArray(event.choices) &&
              event.choices.length === 0 &&
              isRecord(event.usage)
            ) {
              return null;
            }
            if (typeof event.model === 'string') event.model = publicModel;
            return event;
          }
        : (event) => {
            if (
              event.type === 'message_start' &&
              isRecord(event.message) &&
              typeof event.message.model === 'string'
            ) {
              event.message.model = publicModel;
            }
            return event;
          };
    const body = relayEventStream(upstream.body, {
      wire: args.wire,
      rewrite,
      sanitize,
      abortUpstream,
      callerGone: () => args.signal.aborted,
      requestId: args.requestId,
      onEnd: (status, usage) =>
        done({ status, ...(usage !== undefined ? { usage } : {}) }),
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
    const cancelled = args.signal.aborted;
    done({ status: cancelled ? 'cancelled' : 'failed' });
    console.warn('[model-api] reading the gateway answer failed:', error);
    throw new ModelApiRefusal(
      502,
      'MODEL_API_UPSTREAM_ERROR',
      'The model answer could not be read from the gateway; try again.',
    );
  }
  let answer: unknown;
  try {
    answer = JSON.parse(text);
  } catch (error) {
    done({ status: 'failed' });
    console.warn('[model-api] the gateway answer was not JSON:', error);
    throw new ModelApiRefusal(
      502,
      'MODEL_API_UPSTREAM_ERROR',
      'The model gateway answered something that is not JSON.',
    );
  }
  if (!isRecord(answer)) {
    done({ status: 'failed' });
    throw new ModelApiRefusal(
      502,
      'MODEL_API_UPSTREAM_ERROR',
      'The model gateway answered something that is not a JSON object.',
    );
  }
  const usage = answerUsage(args.wire, answer);
  if (typeof answer.model === 'string') answer.model = publicModel;
  done({ status: 'completed', ...(usage !== undefined ? { usage } : {}) });
  return new Response(JSON.stringify(answer), {
    status: 200,
    headers: { 'content-type': 'application/json', ...answerHeaders },
  });
}
