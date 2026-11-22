import type { ApiFormat } from '@tale/shared/schemas/providers';

import { checkProviderHostPolicy } from '../../../lib/net/host-policy.ts';
import { providerAttributionHeaders } from '../../../lib/shared/providers/attribution.ts';
import type { RelayModel } from './models.ts';
import type { RelayWire, UpstreamWire } from './wires.ts';

/** The Anthropic API version a request is sent with when its client named
 * none (the version every Anthropic client of this era sends). */
export const DEFAULT_ANTHROPIC_VERSION = '2023-06-01';

/** What the relay knows of a connector when it calls it: where, on which
 * wire, with which key — the facts the sandbox LLM gateway was given as a
 * provider record. */
export interface RelayConnector {
  name: string;
  apiFormat: ApiFormat;
  baseUrl: string | undefined;
  /** The credential's secret: the upstream's API key. */
  apiKey: string;
  /** The connector's native Anthropic endpoint for harnesses that speak
   * Anthropic Messages, when it declares one. */
  harnessEndpoint?: { baseUrl: string; apiFormat: ApiFormat };
}

/** Where one call goes upstream, and how it is authenticated. */
export interface UpstreamEndpoint {
  wire: UpstreamWire;
  connector: string;
  /** The model's id at the upstream (never the relay's `<record>/` name). */
  modelId: string;
  /** Without a trailing slash; the wire's path is appended. */
  baseUrl: string;
  apiKey: string;
  /** Headers the upstream is always sent: the vendor's attribution. */
  headers: Record<string, string>;
}

/** Why an upstream cannot be reached for a model. */
export class UpstreamUnavailableError extends Error {}

/**
 * Where a request for `model` goes, given the wire it arrived on.
 *
 * The Anthropic lane goes to the connector's harness endpoint; otherwise the
 * connector's own endpoint on its own wire. A Responses request stays on the
 * Responses API where the upstream serves it — OpenAI's own API, or a model
 * whose tools work only there — and is translated onto Chat Completions
 * everywhere else. The URL is held to the provider host policy before
 * anything is sent: no cloud metadata endpoint, and a private address only
 * where the operator admitted them.
 */
export function upstreamFor(
  connector: RelayConnector,
  model: RelayModel,
  inbound: RelayWire,
  catalog: { toolCallingApi?: 'responses' } | undefined,
): UpstreamEndpoint {
  let wire: UpstreamWire;
  let baseUrl: string | undefined;
  if (model.anthropicLane) {
    const native = connector.harnessEndpoint;
    if (native === undefined || native.apiFormat !== 'anthropic') {
      throw new UpstreamUnavailableError(
        `provider "${connector.name}" declares no Anthropic endpoint for harnesses`,
      );
    }
    wire = 'anthropic';
    baseUrl = native.baseUrl;
  } else if (connector.apiFormat === 'anthropic') {
    wire = 'anthropic';
    baseUrl = connector.baseUrl;
  } else {
    const responses =
      inbound === 'openai-responses' &&
      (connector.name === 'openai' || catalog?.toolCallingApi === 'responses');
    wire = responses ? 'openai-responses' : 'openai-chat';
    baseUrl = connector.baseUrl;
  }
  if (baseUrl === undefined || baseUrl.trim() === '') {
    throw new UpstreamUnavailableError(
      `provider "${connector.name}" has no API endpoint configured`,
    );
  }
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  checkProviderHostPolicy(trimmed);
  return {
    wire,
    connector: connector.name,
    modelId: model.modelId,
    baseUrl: trimmed,
    apiKey: connector.apiKey,
    headers: providerAttributionHeaders({
      providerName: connector.name,
      baseUrl: trimmed,
    }),
  };
}

/** The upstream URL of a call on the endpoint's wire. */
export function upstreamUrl(
  endpoint: UpstreamEndpoint,
  call: 'generate' | 'count-tokens' = 'generate',
): string {
  switch (endpoint.wire) {
    case 'anthropic':
      return call === 'count-tokens'
        ? `${endpoint.baseUrl}/v1/messages/count_tokens`
        : `${endpoint.baseUrl}/v1/messages`;
    case 'openai-chat':
      return `${endpoint.baseUrl}/chat/completions`;
    case 'openai-responses':
      return `${endpoint.baseUrl}/responses`;
    default: {
      const _exhaustive: never = endpoint.wire;
      return _exhaustive;
    }
  }
}

/**
 * The headers an upstream call carries: the wire's own authentication and
 * content type, the vendor's attribution, and — on the Anthropic wire — the
 * API version and betas the client asked for.
 */
export function upstreamHeaders(
  endpoint: UpstreamEndpoint,
  forwarded: { anthropicVersion?: string; anthropicBeta?: string } = {},
  extra: Record<string, string> = {},
): Record<string, string> {
  const auth: Record<string, string> =
    endpoint.wire === 'anthropic'
      ? {
          'x-api-key': endpoint.apiKey,
          'anthropic-version':
            forwarded.anthropicVersion ?? DEFAULT_ANTHROPIC_VERSION,
          ...(forwarded.anthropicBeta !== undefined
            ? { 'anthropic-beta': forwarded.anthropicBeta }
            : {}),
        }
      : { authorization: `Bearer ${endpoint.apiKey}` };
  return {
    'content-type': 'application/json',
    ...endpoint.headers,
    ...extra,
    ...auth,
  };
}
