import type { LanguageModelV4 } from '@ai-sdk/provider';
import type { ModelCatalogEntry } from '@tale/shared/schemas/providers';
import type { Sql } from 'postgres';

import { isRecord } from '../../../lib/utils/type-utils.ts';
import { sanitizeError } from '../../core/lib/utils/sanitize_secrets.ts';
import { relayDeps } from '../llm_relay/deps.ts';
import { type UpstreamEndpoint, upstreamFor } from '../llm_relay/endpoint.ts';
import {
  type RelayCallOutcome,
  type RelayLifetime,
  relayPassthrough,
  type UpstreamFetch,
} from '../llm_relay/passthrough.ts';
import type { RelayHandlerDeps } from '../llm_relay/server.ts';
import type { RelayGrant } from '../llm_relay/store.ts';
import { relayTranslated } from '../llm_relay/translate/relay.ts';
import { costCents, type RelayUsage } from '../llm_relay/usage.ts';
import type { RelayWire } from '../llm_relay/wires.ts';
import type { ModelApiLease, ModelApiUsage } from './metering.ts';
import {
  type ModelApiWire,
  ModelApiRefusal,
  wireErrorBody,
  wireHeaders,
} from './wire.ts';

/**
 * The relay leg of a model-endpoint request: the caller's body, already
 * governed, goes to the organization's provider through the model relay
 * that runs in this process (`domains/llm_relay`) — passed through on the
 * caller's own wire where the provider speaks it, translated where it does
 * not — and the answer comes back to the caller in its own wire:
 *
 *  - the call is served as the request's key was minted: the model and the
 *    lane its lease names, the connector's credential the mint resolved;
 *  - the answer names the model id the caller sent, whatever id the
 *    provider knows the model by;
 *  - when the call ends, its cost at the catalog price is booked on the
 *    request's op row before the request is closed, so its settlement reads
 *    a figure that is already final. A call that ended early — even before
 *    its answer began — is booked at least at the prompt the provider read
 *    and the output it reported or the relay counted by then; a call that
 *    never reached a provider (the caller left before it was sent, no
 *    connection was made) or that the provider refused books nothing;
 *  - a refusal is said in the wire's error shape with Tale's code, and a
 *    message that would name the platform's internal addresses is replaced
 *    by a generic one;
 *  - a stream that breaks off while the caller reads ends with an error
 *    event in the wire's shape;
 *  - the caller hanging up stops the call at the provider, and no call
 *    outlives the relay's lifetime.
 *
 * Nothing of the caller's headers but the Anthropic version and betas
 * reaches the provider.
 */

/** How a relayed call ended, for the op row and the settlement. */
export interface RelayOutcome {
  status: 'completed' | 'failed' | 'cancelled';
  /** The counts the call was booked at: what the provider reported, and for
   * a call that ended early the relay's own count of what was sent and
   * received by then. Absent for a call that used nothing. */
  usage?: ModelApiUsage;
  /** What the call cost when the relay could not book it: the op row's
   * close carries the figure to the settlement instead. */
  unbookedCents?: number;
}

/**
 * What the relay leg reads and writes: the connector that serves a model,
 * with the model's catalog entry, and a call's booking — the relay's own
 * (`llm_relay/deps.ts`) — plus the unit layer's seams: the upstream call,
 * the model a translated call is made through, and the lifetime.
 */
export interface ModelApiRelayDeps {
  connectorFor: RelayHandlerDeps['connectorFor'];
  bookCall: RelayHandlerDeps['bookCall'];
  fetcher?: UpstreamFetch;
  model?: LanguageModelV4;
  lifetime?: Partial<RelayLifetime>;
}

const relayDepsBySql = new WeakMap<Sql, ModelApiRelayDeps>();

/** The relay's resolution and booking in the running backend: one per
 * database handle, so the short cache it keeps of each connector serves
 * every request rather than one. */
export function modelApiRelayDeps(sql: Sql): ModelApiRelayDeps {
  let deps = relayDepsBySql.get(sql);
  if (deps === undefined) {
    const { connectorFor, bookCall } = relayDeps(sql);
    deps = { connectorFor, bookCall };
    relayDepsBySql.set(sql, deps);
  }
  return deps;
}

export interface RelayArgs {
  wire: ModelApiWire;
  /** What the request's key serves, and where its call is booked. */
  lease: Pick<
    ModelApiLease,
    | 'organizationId'
    | 'sessionId'
    | 'execId'
    | 'keyId'
    | 'relayModel'
    | 'servingCredentials'
  >;
  /** The model id the caller named — what a translated answer says it came
   * from. */
  publicModel: string;
  body: Record<string, unknown>;
  stream: boolean;
  /** `anthropic-version` / `anthropic-beta`, as the caller sent them. */
  anthropicHeaders: Record<string, string>;
  requestId: string | undefined;
  /** The caller's connection: aborted when they hang up. */
  signal: AbortSignal;
  /** Called exactly once, after the call's booking, however the call ended
   * — a refusal this function throws included. */
  onDone: (outcome: RelayOutcome) => void;
  deps: ModelApiRelayDeps;
}

/** The relay wire each door speaks. */
const INBOUND: Readonly<Record<ModelApiWire, RelayWire>> = {
  openai: 'openai-chat',
  anthropic: 'anthropic',
};

/** The statuses a refusal keeps: the request's own fault, a rate limit, an
 * overloaded provider, and a call the relay stopped once it outlived its
 * lifetime. Any other says that the provider or the platform's wiring
 * failed, which the caller cannot act on: a 502. */
const KEPT_STATUSES: ReadonlySet<number> = new Set([
  400, 413, 422, 429, 503, 504, 529,
]);

/** The relay's answer to a caller who left before the call was made. */
const CALLER_GONE_STATUS = 499;

/** The most of a refusal body the door reads before it answers. */
const MAX_ERROR_BODY_BYTES = 64 * 1024;

/**
 * Text that tells where the platform's own traffic goes rather than what
 * was wrong with the request: an IP address, a host with a port, a URL on an
 * internal host, or a transport failure's wording (which names the address
 * it failed on), as a Go or Node proxy in front of a provider writes it. A
 * provider's refusal of the request itself — a field out of range, a model
 * it does not serve — carries none of it.
 */
const INTERNAL_DETAIL: readonly RegExp[] = [
  /\b(?:\d{1,3}\.){3}\d{1,3}\b/,
  /\b[0-9a-f]{1,4}::[0-9a-f]{0,4}\b/i,
  /\[[0-9a-f:.]{3,}\]/i,
  /\b[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9-]+)*:\d{2,5}\b/i,
  /\bhttps?:\/\/(?:localhost|[a-z0-9-]+|[a-z0-9.-]+\.(?:internal|local|lan|svc|cluster\.local))(?:[:/?#]|$)/i,
  /\b(?:dial tcp|connection refused|connection reset|no such host|i\/o timeout|tls handshake|context deadline exceeded|broken pipe|unexpected eof)\b/i,
  /\b(?:getaddrinfo|econnrefused|econnreset|enotfound|eai_again|etimedout|ehostunreach|enetunreach|epipe|socket hang up|und_err_[a-z_]+)\b/i,
];

/** A relayed message with anything secret-shaped redacted — or `fallback`
 * whole when it would name an internal address or a transport failure (the
 * detail is logged for the operator): redacting pieces of it would still
 * leave the shape of the platform's network in the caller's hands. */
function callerMessage(text: string, fallback: string): string {
  const safe = sanitizeError(text, 2_000);
  if (INTERNAL_DETAIL.some((pattern) => pattern.test(safe))) {
    console.warn(
      `[model-api] an upstream message named internal detail; the caller reads a generic one instead: ${safe}`,
    );
    return fallback;
  }
  return safe;
}

/** The grant the relay resolves a connector by: the request's organization,
 * its one model, and the credential its key was minted with. */
function grantOf(lease: RelayArgs['lease']): RelayGrant {
  const model = lease.relayModel;
  return {
    organizationId: lease.organizationId,
    sessionId: lease.sessionId,
    keyId: lease.keyId,
    allowedModels: [
      {
        providerSlug: model.providerSlug,
        modelId: model.modelId,
        ...(model.anthropicLane ? { anthropicHarnessLane: true } : {}),
      },
    ],
    servingCredentials: lease.servingCredentials,
  };
}

function forwardedAnthropicHeaders(headers: Record<string, string>): {
  anthropicVersion?: string;
  anthropicBeta?: string;
} {
  const version = headers['anthropic-version'];
  const beta = headers['anthropic-beta'];
  return {
    ...(version !== undefined ? { anthropicVersion: version } : {}),
    ...(beta !== undefined ? { anthropicBeta: beta } : {}),
  };
}

function usedNothing(usage: RelayUsage): boolean {
  return (
    usage.inputTokens +
      usage.cacheReadTokens +
      usage.cacheWriteTokens +
      usage.outputTokens ===
    0
  );
}

/** The relay's counts as the op row and the ledger keep them: the whole
 * prompt, fresh or read from and written to the provider's cache, and the
 * output. */
function modelApiUsage(usage: RelayUsage): ModelApiUsage {
  return {
    inputTokens:
      usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens,
    outputTokens: usage.outputTokens,
  };
}

/** Book an ended call on the request's op row, at the catalog price, and
 * say how it ended. Never rejects: a booking that fails is logged, and its
 * figure rides the outcome to the op row's close. */
async function bookOutcome(
  deps: ModelApiRelayDeps,
  lease: RelayArgs['lease'],
  outcome: RelayCallOutcome,
  pricing: ModelCatalogEntry['pricing'] | undefined,
): Promise<RelayOutcome> {
  if (usedNothing(outcome.usage)) return { status: outcome.status };
  const usage = modelApiUsage(outcome.usage);
  const cents = costCents(outcome.usage, pricing);
  try {
    await deps.bookCall(lease.keyId, outcome.usage, cents);
  } catch (error) {
    console.error(
      `[model-api] ${lease.organizationId}: could not book request ${lease.execId} (${cents} cents); its close carries the figure to the settlement:`,
      error,
    );
    return {
      status: outcome.status,
      usage,
      ...(cents > 0 ? { unbookedCents: cents } : {}),
    };
  }
  return { status: outcome.status, usage };
}

/** Read at most {@link MAX_ERROR_BODY_BYTES} of a refusal's body. */
async function readRefusal(response: Response): Promise<string> {
  if (response.body === null) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let read = 0;
  try {
    while (read < MAX_ERROR_BODY_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      read += value.byteLength;
      text += decoder.decode(value, { stream: true });
    }
  } catch (error) {
    console.warn('[model-api] reading a relayed refusal failed:', error);
  } finally {
    await reader.cancel().catch((error: unknown) => {
      console.warn('[model-api] releasing a relayed refusal failed:', error);
    });
  }
  return text.slice(0, MAX_ERROR_BODY_BYTES);
}

/**
 * A refusal the relay answered — the provider's own, or the relay's — as the
 * door says it: the wire's error shape with `MODEL_API_UPSTREAM_ERROR`, the
 * message the refusal carried (without internal detail), its own `type`
 * where the status is kept, and a status the caller can act on.
 */
async function refusalAnswer(
  wire: ModelApiWire,
  response: Response,
  requestId: string | undefined,
): Promise<Response> {
  const text = await readRefusal(response);
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
      if (typeof error.type === 'string' && error.type !== '') {
        type = error.type;
      }
    } else if (typeof error === 'string' && error !== '') {
      message = error;
    }
  } catch (error) {
    if (text.trim() !== '') message = text.trim().slice(0, 500);
    console.warn(
      '[model-api] a relayed refusal was not JSON:',
      error instanceof Error ? error.message : error,
    );
  }
  const status = KEPT_STATUSES.has(response.status) ? response.status : 502;
  return Response.json(
    wireErrorBody(
      wire,
      {
        status,
        code: 'MODEL_API_UPSTREAM_ERROR',
        message: callerMessage(message, generic),
        ...(status === response.status && type !== undefined ? { type } : {}),
      },
      requestId,
    ),
    {
      status,
      headers: { 'cache-control': 'no-store', ...wireHeaders(wire, requestId) },
    },
  );
}

/** The event a stream that broke off ends with, in the wire's shape. */
function breakOffEvent(
  wire: ModelApiWire,
  requestId: string | undefined,
): string {
  const body = wireErrorBody(
    wire,
    {
      status: 502,
      code: 'MODEL_API_UPSTREAM_ERROR',
      message:
        'The model stream broke off, or went quiet for too long, before the answer was complete.',
    },
    requestId,
  );
  return wire === 'anthropic'
    ? `event: error\ndata: ${JSON.stringify(body)}\n\n`
    : `data: ${JSON.stringify(body)}\n\n`;
}

/**
 * The relay's stream as the caller receives it, chunk by chunk. A provider
 * stream that breaks off — or that the relay stops once it went quiet past
 * its idle budget — errors the relay's stream; while the caller still reads,
 * it is ended with the wire's error event instead, so the caller's SDK says
 * why the answer stopped rather than that the connection dropped.
 */
function guardedStream(
  wire: ModelApiWire,
  relayed: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  requestId: string | undefined,
): ReadableStream<Uint8Array> {
  const reader = relayed.getReader();
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        if (signal.aborted) {
          // The caller hung up: nobody reads on.
          controller.error(error);
          return;
        }
        console.warn('[model-api] the relayed stream broke off:', error);
        try {
          controller.enqueue(encoder.encode(breakOffEvent(wire, requestId)));
          controller.close();
        } catch (closeError) {
          console.warn(
            '[model-api] the caller stream closed before the break-off event:',
            closeError,
          );
        }
      }
    },
    async cancel(reason) {
      // The caller hung up: the relay stops the provider's call in turn.
      await reader.cancel(reason).catch((error: unknown) => {
        console.warn(
          '[model-api] cancelling the relayed stream failed:',
          error,
        );
      });
    },
  });
}

/**
 * Relay one governed request and answer the caller. Throws a
 * {@link ModelApiRefusal} only when no call could be made — the provider
 * cannot serve the model, or the relay failed before it answered; every
 * other ending is an answer: the provider's, a refusal in the wire's shape,
 * or a stream that ends however it ended. `onDone` is called for each of
 * them, a thrown refusal's included.
 */
export async function relayModelApiCall(args: RelayArgs): Promise<Response> {
  const { wire, lease, deps, signal, requestId, stream } = args;
  const inbound = INBOUND[wire];
  const model = lease.relayModel;
  let endpoint: UpstreamEndpoint;
  let entry: ModelCatalogEntry | undefined;
  try {
    const resolved = await deps.connectorFor(
      grantOf(lease),
      model.providerSlug,
      model.modelId,
    );
    entry = resolved.entry;
    endpoint = upstreamFor(resolved.connector, model, inbound, entry);
  } catch (error) {
    // The detail (a credential, a host the policy blocks) is the
    // operator's: the caller reads that the provider cannot be used now.
    console.error(
      `[model-api] ${lease.organizationId}: provider "${model.providerSlug}" cannot serve ${args.publicModel} for request ${lease.execId}:`,
      error,
    );
    args.onDone({ status: 'failed' });
    throw new ModelApiRefusal(
      503,
      'MODEL_API_UNAVAILABLE',
      `The provider that serves ${args.publicModel} cannot be used right now. Try again shortly; if it persists, ask an admin to check it under Settings → AI providers.`,
      { headers: { 'retry-after': '10' } },
    );
  }

  const pricing = entry?.pricing;
  let reported = false;
  const onDone = (outcome: RelayCallOutcome) => {
    if (reported) return;
    reported = true;
    void bookOutcome(deps, lease, outcome, pricing)
      .then((booked) => args.onDone(booked))
      .catch((error: unknown) => {
        console.error(
          `[model-api] closing request ${lease.execId} failed; the watchdog closes it once it is stale:`,
          error,
        );
      });
  };
  const seams = {
    ...(deps.lifetime !== undefined ? { lifetime: deps.lifetime } : {}),
    ...(deps.fetcher !== undefined ? { fetcher: deps.fetcher } : {}),
  };

  let response: Response;
  try {
    response =
      endpoint.wire === inbound
        ? await relayPassthrough({
            endpoint,
            body: args.body,
            stream,
            ...(wire === 'anthropic'
              ? { forwarded: forwardedAnthropicHeaders(args.anthropicHeaders) }
              : {}),
            signal,
            onDone,
            // The door promises its caller the model id it asked for.
            answerModel: args.publicModel,
            ...seams,
          })
        : await relayTranslated({
            inbound,
            endpoint,
            body: args.body,
            stream,
            requestedModel: args.publicModel,
            signal,
            onDone,
            ...seams,
            ...(deps.model !== undefined ? { model: deps.model } : {}),
          });
  } catch (error) {
    console.error(
      `[model-api] the model relay failed request ${lease.execId} before it answered:`,
      error,
    );
    // A relay that throws has not reported, so nothing reached a provider;
    // one that reported first closes the request through its booking.
    if (!reported) {
      reported = true;
      args.onDone({ status: 'failed' });
    }
    throw new ModelApiRefusal(
      502,
      'MODEL_API_UPSTREAM_ERROR',
      'The model call could not be made; try again shortly.',
    );
  }

  if (!response.ok) {
    // A caller who left before the call was made reads nothing.
    if (response.status === CALLER_GONE_STATUS) return response;
    return refusalAnswer(wire, response, requestId);
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (
    !stream ||
    response.body === null ||
    !contentType.includes('text/event-stream')
  ) {
    return response;
  }
  return new Response(guardedStream(wire, response.body, signal, requestId), {
    status: response.status,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      'x-accel-buffering': 'no',
      ...wireHeaders(wire, requestId),
    },
  });
}
