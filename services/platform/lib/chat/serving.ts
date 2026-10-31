/**
 * Where a model answer was served, as the provider's own response said.
 *
 * A response can name the upstream a gateway routed the request to, the
 * region that answered, and the exact model it served. The host reads those
 * statements off the response (`backend/core/chat/stream_decode.ts` for the
 * body, `turn_action.ts` for the headers); the pipeline folds them per round
 * and per turn here, and the settled reply carries the result in
 * `usage.serving` for the message-info panel.
 *
 * Every value is the provider's text, so it is bounded before it is kept:
 * trimmed, stripped of control characters, cut to a short label, and capped
 * to a few distinct values per turn. Nothing is inferred — a provider that
 * names nothing leaves nothing behind. The one fact configuration sets is
 * the regional endpoint: a host whose vendor documents that it processes
 * requests in one region ({@link REGIONAL_ENDPOINTS}). The same fact decides,
 * before a call, whether an endpoint may be called at all under the
 * model-access policy's EU/EEA processing rule ({@link euProcessingVerdict}).
 *
 * Pure: no I/O.
 */

import type {
  EndpointRegion,
  RegionalEndpoint,
  ServedBy,
  TurnServing,
} from './types';

/** The longest label kept — a provider name, a region, a model id. */
export const SERVING_LABEL_MAX_CHARS = 120;

/** The most distinct values one turn keeps per kind. A tool loop runs at most
 * a handful of rounds; more distinct values than this is noise. */
export const SERVING_VALUES_MAX = 4;

/** A provider's label as a person may read it: trimmed, free of control
 * characters, bounded. Undefined for anything that is not a non-empty
 * string. */
export function servingLabel(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const clean = value.replace(/\p{Cc}+/gu, ' ').trim();
  if (clean.length === 0) return undefined;
  return clean.length > SERVING_LABEL_MAX_CHARS
    ? clean.slice(0, SERVING_LABEL_MAX_CHARS).trimEnd()
    : clean;
}

/**
 * The hosts whose vendors document that a request sent there is processed
 * in one region, and that region. A provider's headquarters or the edge that
 * answered says nothing about where the model ran, so neither is listed —
 * only endpoints the vendor itself documents as regional:
 *
 * - OpenRouter in-region routing: a request is decrypted in the region and
 *   routed only to provider endpoints there
 *   (https://openrouter.ai/docs/guides/features/sovereign-ai).
 * - OpenAI data residency: storage and processing stay in the region; its
 *   Europe region is the EEA and Switzerland
 *   (https://developers.openai.com/api/docs/guides/your-data).
 * - Mistral regional inference: EU and EFTA countries, or the United States
 *   (https://docs.mistral.ai/inference/regional-inference).
 */
const REGIONAL_ENDPOINTS: Readonly<Record<string, EndpointRegion>> = {
  'eu.openrouter.ai': 'europe',
  'us.openrouter.ai': 'united-states',
  'eu.api.openai.com': 'europe',
  'us.api.openai.com': 'united-states',
  'api.eu.mistral.ai': 'europe',
  'api.us.mistral.ai': 'united-states',
};

/** The host a base URL points at, lowercase — undefined for anything that
 * is not a URL with a host. */
function endpointHost(baseUrl: string | undefined): string | undefined {
  if (baseUrl === undefined) return undefined;
  let host: string;
  try {
    host = new URL(baseUrl).hostname.toLowerCase();
  } catch {
    // Not a URL, so not an endpoint any vendor documents.
    return undefined;
  }
  return host === '' ? undefined : host;
}

/** The regional endpoint a base URL points at, or undefined for any other
 * host — and for anything that is not a URL. */
export function regionalEndpoint(
  baseUrl: string,
): RegionalEndpoint | undefined {
  const host = endpointHost(baseUrl);
  if (host === undefined) return undefined;
  const region = REGIONAL_ENDPOINTS[host];
  return region !== undefined ? { host, region } : undefined;
}

/**
 * The vendors whose EU endpoint above is one host of their own domain. Every
 * other host there — the global endpoint first of all — may process a
 * request anywhere, so under the EU/EEA processing rule only the EU host
 * counts, and no admin attestation makes another host of the domain count.
 */
const EU_HOST_VENDOR_DOMAINS = ['openrouter.ai', 'openai.com', 'mistral.ai'];

function vendorDomainOf(host: string): string | undefined {
  return EU_HOST_VENDOR_DOMAINS.find(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  );
}

/** The EU endpoint of the vendor `host` belongs to — `eu.openrouter.ai` for
 * `openrouter.ai` — or undefined for a host of no vendor listed above. */
export function vendorEuEndpoint(host: string): string | undefined {
  const domain = vendorDomainOf(host.toLowerCase());
  if (domain === undefined) return undefined;
  return Object.keys(REGIONAL_ENDPOINTS).find(
    (candidate) =>
      REGIONAL_ENDPOINTS[candidate] === 'europe' &&
      candidate.endsWith(`.${domain}`),
  );
}

/** Why the EU/EEA processing rule refuses an endpoint. */
export type EuProcessingRefusal =
  /** No base URL, or not a URL: nothing says where the request would go. */
  | 'unknown-endpoint'
  /** A vendor's regional endpoint for a region outside the EU/EEA. */
  | 'regional-outside-eu'
  /** Another host of a vendor whose EU endpoint is known — its global
   * endpoint, which may process anywhere. */
  | 'vendor-global'
  /** Any other host, which no admin has attested. */
  | 'not-attested';

export type EuProcessingVerdict =
  | { readonly allowed: true; readonly host: string }
  | {
      readonly allowed: false;
      readonly host: string | undefined;
      readonly reason: EuProcessingRefusal;
    };

/**
 * Whether a model call to `baseUrl` is processed in the EU/EEA, under the
 * model-access policy's rule that it must be: a vendor's EU endpoint is, and
 * so is a host an admin attests (`attestedHosts` — a custom provider's server
 * or an Azure resource in an EU/EEA region, which no URL tells apart from
 * one elsewhere). Everything else is refused, an unknown endpoint included,
 * and a host of a vendor whose EU endpoint is known counts only as that
 * endpoint, attested or not.
 */
export function euProcessingVerdict(
  baseUrl: string | undefined,
  attestedHosts: readonly string[],
): EuProcessingVerdict {
  const host = endpointHost(baseUrl);
  if (host === undefined) {
    return { allowed: false, host: undefined, reason: 'unknown-endpoint' };
  }
  const region = REGIONAL_ENDPOINTS[host];
  if (region === 'europe') return { allowed: true, host };
  if (region !== undefined) {
    return { allowed: false, host, reason: 'regional-outside-eu' };
  }
  if (vendorDomainOf(host) !== undefined) {
    return { allowed: false, host, reason: 'vendor-global' };
  }
  return attestedHosts.includes(host)
    ? { allowed: true, host }
    : { allowed: false, host, reason: 'not-attested' };
}

/** Whether attesting `host` would let calls to it through — false for a
 * vendor's endpoint the rule refuses whatever an admin says. */
export function isAttestableEndpointHost(host: string): boolean {
  const verdict = euProcessingVerdict(`https://${host}`, [host]);
  return verdict.allowed && verdict.host === host;
}

/** Build a `ServedBy` from raw values, keeping only the usable ones —
 * undefined when none is. */
export function servedBy(raw: {
  provider?: unknown;
  region?: unknown;
  model?: unknown;
}): ServedBy | undefined {
  const provider = servingLabel(raw.provider);
  const region = servingLabel(raw.region);
  const model = servingLabel(raw.model);
  if (provider === undefined && region === undefined && model === undefined) {
    return undefined;
  }
  return {
    ...(provider !== undefined ? { provider } : {}),
    ...(region !== undefined ? { region } : {}),
    ...(model !== undefined ? { model } : {}),
  };
}

/** One round's facts with a later statement folded in: each field the later
 * statement makes wins, the rest stand. A response states its headers before
 * its body, and a gateway may repeat its fields on every chunk. */
export function mergeServedBy(
  base: ServedBy | undefined,
  next: ServedBy | undefined,
): ServedBy | undefined {
  if (next === undefined) return base;
  if (base === undefined) return next;
  return { ...base, ...next };
}

/** Whether two statements say the same thing — the stream reader reports a
 * change only, not every chunk that repeats it. */
export function sameServedBy(
  a: ServedBy | undefined,
  b: ServedBy | undefined,
): boolean {
  return (
    a?.provider === b?.provider &&
    a?.region === b?.region &&
    a?.model === b?.model &&
    a?.endpoint?.host === b?.endpoint?.host
  );
}

function pushDistinct(list: string[], value: string | undefined): void {
  if (value === undefined || list.length >= SERVING_VALUES_MAX) return;
  const key = value.toLowerCase();
  if (list.some((existing) => existing.toLowerCase() === key)) return;
  list.push(value);
}

/**
 * The turn's tally: the distinct providers, regions and models its rounds
 * reported, in the order they first appeared. A model id equal to the one
 * the turn requested says nothing new, so it is not kept.
 */
export function createServingTally(requestedModel: string): {
  add(served: ServedBy | undefined): void;
  stamp(): TurnServing | undefined;
} {
  const providers: string[] = [];
  const regions: string[] = [];
  const models: string[] = [];
  let endpoint: RegionalEndpoint | undefined;
  const requested = requestedModel.toLowerCase();
  return {
    add(served) {
      if (served === undefined) return;
      pushDistinct(providers, served.provider);
      pushDistinct(regions, served.region);
      if (served.model !== undefined) {
        if (served.model.toLowerCase() !== requested) {
          pushDistinct(models, served.model);
        }
      }
      // Every round of a turn goes out over the same wire.
      endpoint ??= served.endpoint;
    },
    stamp() {
      if (
        providers.length + regions.length + models.length === 0 &&
        endpoint === undefined
      ) {
        return undefined;
      }
      return {
        ...(providers.length > 0 ? { providers: [...providers] } : {}),
        ...(regions.length > 0 ? { regions: [...regions] } : {}),
        ...(models.length > 0 ? { models: [...models] } : {}),
        ...(endpoint !== undefined ? { endpoint: { ...endpoint } } : {}),
      };
    },
  };
}
