import { createHash } from 'node:crypto';

import type { ModelCatalogEntry } from '@tale/shared/schemas/providers';

import { estimateTokens } from '../../../lib/chat/types.ts';
import { isRecord } from '../../../lib/utils/type-utils.ts';
import { sanitizeError } from '../../core/lib/utils/sanitize_secrets.ts';
import {
  type RelayConnector,
  type UpstreamEndpoint,
  upstreamFor,
  upstreamHeaders,
  upstreamUrl,
} from './endpoint.ts';
import { listedModels, matchRelayModel, type RelayModel } from './models.ts';
import {
  forwardedExtraHeaders,
  type RelayCallOutcome,
  type RelayLifetime,
  relayPassthrough,
  type UpstreamFetch,
} from './passthrough.ts';
import type { RelayGrant } from './store.ts';
import { relayTranslated } from './translate/relay.ts';
import { costCents, type RelayUsage } from './usage.ts';
import {
  errorResponse,
  presentedCredential,
  type RelayWire,
  routeOf,
} from './wires.ts';

/**
 * The model relay's door (tale-project/tale#4942): what a sandbox session's
 * harness reaches in place of the sandbox LLM gateway. A request presents
 * its turn's token; it may call the models the turn was granted, while the
 * turn's allowance lasts; the call goes to the organization's provider on
 * the provider's wire — passed through where the client speaks it, else
 * translated — and its cost is booked on the turn when it ends.
 */

export interface RelayHandlerDeps {
  /** The grant of a live token, by its SHA-256 hash (hex). */
  grantOf: (tokenHash: string) => Promise<RelayGrant | null>;
  /** What the turn behind a key may still spend; null when no op carries
   * the key. */
  remainingCents: (keyId: string) => Promise<number | null>;
  /** Book one call on the turn behind its key. */
  bookCall: (
    keyId: string,
    usage: RelayUsage,
    costCents: number,
  ) => Promise<void>;
  /** The connector that serves a model of the grant, with the credential
   * the grant names, and the model's catalog entry. */
  connectorFor: (
    grant: RelayGrant,
    providerSlug: string,
    modelId: string,
  ) => Promise<{
    connector: RelayConnector;
    entry: ModelCatalogEntry | undefined;
  }>;
  lifetime?: Partial<RelayLifetime>;
  fetcher?: UpstreamFetch;
}

/** The most of a request body the relay reads: a long agent conversation
 * with images, the bound the model endpoints use too. */
export const MAX_BODY_BYTES = 32 * 1024 * 1024;

/** How long a token's grant is remembered: short enough that a revoked or
 * ended turn's token stops working within seconds. */
const GRANT_CACHE_MS = 5_000;
const GRANT_CACHE_ENTRIES = 1_000;

/** A token's hash, as `app.sandbox_session_tokens` keeps it. */
export function tokenHashOf(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** The relay's answer when nothing it serves matches. */
function notServed(): Response {
  return Response.json(
    { error: { message: 'Not found.', type: 'not_found_error' } },
    { status: 404 },
  );
}

/** The body, read up to the bound: null when it is larger. */
async function readBody(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null;
  if (request.body === null) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel().catch((error: unknown) => {
        console.warn('[llm-relay] could not drop an oversized body:', error);
      });
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** A rough count of a request's prompt, for the token-counting doors of a
 * translated model, which the upstream cannot count in its own wire. */
function estimatedPromptTokens(body: Record<string, unknown>): number {
  const { system, messages, tools, contents, systemInstruction } = body;
  return estimateTokens(
    JSON.stringify({ system, messages, tools, contents, systemInstruction }),
  );
}

export function createRelayHandler(
  deps: RelayHandlerDeps,
): (request: Request) => Promise<Response> {
  const grants = new Map<string, { grant: RelayGrant | null; at: number }>();
  const grantFor = async (tokenHash: string): Promise<RelayGrant | null> => {
    const now = Date.now();
    const cached = grants.get(tokenHash);
    if (cached !== undefined && now - cached.at < GRANT_CACHE_MS) {
      return cached.grant;
    }
    const grant = await deps.grantOf(tokenHash);
    if (grants.size >= GRANT_CACHE_ENTRIES) grants.clear();
    grants.set(tokenHash, { grant, at: now });
    return grant;
  };

  return async (request) => {
    const url = new URL(request.url);
    const route = routeOf(request.method, url.pathname);
    if (route === null) return notServed();
    if (route.kind === 'health') return Response.json({ status: 'ok' });
    const wire: RelayWire =
      route.kind === 'models' ? 'openai-chat' : route.wire;

    const token = presentedCredential(request.headers, url.searchParams);
    if (token === null) {
      return errorResponse(
        wire,
        'authentication',
        "The request carries no key: send the turn's key as a bearer token.",
      );
    }
    let grant: RelayGrant | null;
    try {
      grant = await grantFor(tokenHashOf(token));
    } catch (error) {
      console.error('[llm-relay] could not read a grant:', error);
      return errorResponse(
        wire,
        'overloaded',
        'The relay cannot check keys right now.',
      );
    }
    if (grant === null) {
      return errorResponse(
        wire,
        'authentication',
        'The key is not valid, or the turn it was given to has ended.',
      );
    }

    if (route.kind === 'models') {
      return Response.json({
        object: 'list',
        data: listedModels(grant.organizationId, grant.allowedModels).map(
          (id) => ({ id, object: 'model', created: 0, owned_by: 'tale' }),
        ),
      });
    }

    const text = await readBody(request);
    if (text === null) {
      return errorResponse(
        wire,
        'too_large',
        `The request is larger than ${MAX_BODY_BYTES / 1024 / 1024} MiB.`,
      );
    }
    let body: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(text);
      if (!isRecord(parsed)) throw new SyntaxError('not a JSON object');
      body = parsed;
    } catch (error) {
      return errorResponse(
        wire,
        'invalid_request',
        `The request body is not a JSON object (${error instanceof Error ? error.message : String(error)}).`,
      );
    }
    const requested =
      route.path?.model ?? (typeof body.model === 'string' ? body.model : '');
    if (requested === '') {
      return errorResponse(
        wire,
        'invalid_request',
        'The request names no model.',
      );
    }
    const model = matchRelayModel(
      grant.organizationId,
      requested,
      grant.allowedModels,
      wire,
    );
    if (model === null) {
      return errorResponse(
        wire,
        'permission',
        `The model "${requested}" is not one this turn may call.`,
      );
    }

    let endpoint: UpstreamEndpoint;
    let entry: ModelCatalogEntry | undefined;
    try {
      const resolved = await deps.connectorFor(
        grant,
        model.providerSlug,
        model.modelId,
      );
      entry = resolved.entry;
      endpoint = upstreamFor(resolved.connector, model, wire, entry);
    } catch (error) {
      console.warn(
        `[llm-relay] provider "${model.providerSlug}" cannot serve "${model.modelId}":`,
        error,
      );
      return errorResponse(
        wire,
        'upstream',
        `The provider "${model.providerSlug}" cannot serve this turn: ${sanitizeError(error instanceof Error ? error.message : error, 300)}`,
      );
    }

    if (route.kind === 'count-tokens') {
      return countTokens(wire, endpoint, body, request, deps.fetcher);
    }

    // The allowance, read before every call: what the turn may still spend
    // after what the relay booked and the images it booked or holds. A
    // call that starts under it may end over it, as the gateway's did.
    let remaining: number | null;
    try {
      remaining = await deps.remainingCents(grant.keyId);
    } catch (error) {
      console.error('[llm-relay] could not read a turn’s allowance:', error);
      return errorResponse(
        wire,
        'overloaded',
        'The relay cannot check the allowance right now.',
      );
    }
    if (remaining === null) {
      return errorResponse(
        wire,
        'authentication',
        'The turn this key was given to has ended.',
      );
    }
    if (remaining <= 0) {
      return errorResponse(
        wire,
        'budget',
        "The turn's spend allowance is used up.",
      );
    }

    const onDone = book(deps, grant, model, entry);
    const stream =
      route.path !== undefined ? route.path.stream : body.stream === true;
    const extraHeaders = forwardedExtraHeaders(request.headers);
    if (endpoint.wire === wire) {
      return relayPassthrough({
        endpoint,
        body,
        stream,
        forwarded: anthropicHeadersOf(request.headers),
        extraHeaders,
        signal: request.signal,
        onDone,
        ...(deps.lifetime !== undefined ? { lifetime: deps.lifetime } : {}),
        ...(deps.fetcher !== undefined ? { fetcher: deps.fetcher } : {}),
      });
    }
    return relayTranslated({
      inbound: wire,
      endpoint,
      body,
      stream,
      requestedModel: requested,
      extraHeaders,
      signal: request.signal,
      onDone,
      ...(deps.lifetime !== undefined ? { lifetime: deps.lifetime } : {}),
      ...(deps.fetcher !== undefined ? { fetcher: deps.fetcher } : {}),
    });
  };
}

/** The Anthropic version and betas a client sent, for an Anthropic
 * upstream. */
function anthropicHeadersOf(headers: Headers): {
  anthropicVersion?: string;
  anthropicBeta?: string;
} {
  const version = headers.get('anthropic-version') ?? undefined;
  const beta = headers.get('anthropic-beta') ?? undefined;
  return {
    ...(version !== undefined ? { anthropicVersion: version } : {}),
    ...(beta !== undefined ? { anthropicBeta: beta } : {}),
  };
}

/** What a call books when it ends: its cost at the model's catalog price,
 * on the turn's op. A call that used nothing books nothing. */
function book(
  deps: RelayHandlerDeps,
  grant: RelayGrant,
  model: RelayModel,
  entry: ModelCatalogEntry | undefined,
): (outcome: RelayCallOutcome) => void {
  return (outcome) => {
    const { usage } = outcome;
    if (
      usage.inputTokens +
        usage.cacheReadTokens +
        usage.cacheWriteTokens +
        usage.outputTokens ===
      0
    ) {
      return;
    }
    const cents = costCents(usage, entry?.pricing);
    deps.bookCall(grant.keyId, usage, cents).catch((error: unknown) => {
      console.error(
        `[llm-relay] could not book a call of "${model.ref}" (${cents} cents, ${outcome.status}) on key ${grant.keyId}:`,
        error,
      );
    });
  };
}

/**
 * Count a request's tokens. An Anthropic upstream counts them itself
 * (`/v1/messages/count_tokens`, which costs nothing); anything else is
 * counted here, roughly, in the wire's answer shape.
 */
async function countTokens(
  wire: RelayWire,
  endpoint: UpstreamEndpoint,
  body: Record<string, unknown>,
  request: Request,
  fetcher: UpstreamFetch | undefined,
): Promise<Response> {
  if (wire === 'anthropic' && endpoint.wire === 'anthropic') {
    try {
      const answer = await (fetcher ?? fetch)(
        upstreamUrl(endpoint, 'count-tokens'),
        {
          method: 'POST',
          headers: upstreamHeaders(
            endpoint,
            anthropicHeadersOf(request.headers),
          ),
          body: JSON.stringify({ ...body, model: endpoint.modelId }),
          signal: request.signal,
        },
      );
      return new Response(await answer.text(), {
        status: answer.status,
        headers: { 'content-type': 'application/json' },
      });
    } catch (error) {
      return errorResponse(
        wire,
        'upstream',
        `The model provider could not be reached: ${sanitizeError(error, 300)}`,
      );
    }
  }
  const tokens = estimatedPromptTokens(body);
  return Response.json(
    wire === 'genai' ? { totalTokens: tokens } : { input_tokens: tokens },
  );
}
