/**
 * Faults: what goes wrong, how often, and how a provider says so.
 *
 * Faults are sampled per request from the configured rates, or forced by
 * directives a driver writes into the LAST user message — `[[mock:429]]`,
 * `[[mock:500]]`, `[[mock:503]]` (any status 400-599 works),
 * `[[mock:midstream-error]]`, `[[mock:stall=<ms>]]` — next to the shaping
 * directives `[[mock:ttft=<ms>]]`, `[[mock:tokens=<n>]]`, `[[mock:tool]]`,
 * `[[mock:no-tool]]` and `[[mock:empty]]`. A directive is literal text in
 * the prompt, so it survives whatever the platform wraps around the
 * message and reaches the provider exactly as the driver wrote it.
 */

import type { MockOptions } from './config.ts';
import { chance, type Random } from './random.ts';

export type Dialect = 'openai' | 'anthropic';

export interface MockDirectives {
  /** An HTTP status to refuse the request with. */
  readonly status?: number;
  /** Fail the stream after some content. */
  readonly midstreamError?: boolean;
  /** Go silent this long once the stream has started. */
  readonly stallMs?: number;
  /** Exact time to first token. */
  readonly ttftMs?: number;
  /** Exact reply length in tokens (still capped by the request's ceiling). */
  readonly tokens?: number;
  /** `true` forces a tool call when tools are offered, `false` forbids one. */
  readonly tool?: boolean;
  /** Answer with no content at all. */
  readonly empty?: boolean;
}

const DIRECTIVE_PATTERN = /\[\[mock:([a-z0-9-]+)(?:=(\d{1,9}))?\]\]/gi;

/** The directives in `text`; later directives win over earlier ones. */
export function parseDirectives(
  text: string,
  defaultStallMs: number,
): MockDirectives {
  if (!text.includes('[[mock:')) return {};
  const directives: {
    -readonly [K in keyof MockDirectives]: MockDirectives[K];
  } = {};
  for (const match of text.matchAll(DIRECTIVE_PATTERN)) {
    const name = (match[1] ?? '').toLowerCase();
    const raw = match[2];
    const value = raw === undefined ? undefined : Number.parseInt(raw, 10);
    if (/^[45]\d\d$/.test(name)) {
      directives.status = Number.parseInt(name, 10);
      continue;
    }
    switch (name) {
      case 'midstream-error':
        directives.midstreamError = true;
        break;
      case 'stall':
        directives.stallMs = value ?? defaultStallMs;
        break;
      case 'ttft':
        if (value !== undefined) directives.ttftMs = value;
        break;
      case 'tokens':
        if (value !== undefined) directives.tokens = value;
        break;
      case 'tool':
        directives.tool = true;
        break;
      case 'no-tool':
        directives.tool = false;
        break;
      case 'empty':
        directives.empty = true;
        break;
      default:
        console.warn(`[mock] unknown directive [[mock:${name}]] ignored`);
    }
  }
  return directives;
}

/** `text` without its directives, for titles, keywords and language. */
export function stripDirectives(text: string): string {
  return text.includes('[[mock:')
    ? text.replace(DIRECTIVE_PATTERN, ' ').replace(/ {2,}/g, ' ').trim()
    : text;
}

export type Fault =
  | { readonly kind: 'none' }
  | { readonly kind: 'http'; readonly status: number }
  | { readonly kind: 'midstream' }
  | { readonly kind: 'stall'; readonly ms: number };

const NO_FAULT: Fault = { kind: 'none' };

type FaultRates = Pick<
  MockOptions,
  'rate429' | 'rate5xx' | 'midStreamErrorRate' | 'stallRate' | 'stallMs'
>;

/**
 * The fault one request meets. Directives win; otherwise ONE draw decides
 * between 429, 5xx and a mid-stream error so their rates never overlap,
 * and a second draw decides a stall.
 */
export function sampleFault(
  random: Random,
  rates: FaultRates,
  directives: MockDirectives,
): Fault {
  if (directives.status !== undefined) {
    return { kind: 'http', status: directives.status };
  }
  if (directives.midstreamError === true) return { kind: 'midstream' };
  if (directives.stallMs !== undefined) {
    return { kind: 'stall', ms: directives.stallMs };
  }
  const roll = random();
  if (roll < rates.rate429) return { kind: 'http', status: 429 };
  if (roll < rates.rate429 + rates.rate5xx) {
    return { kind: 'http', status: random() < 0.5 ? 500 : 503 };
  }
  if (roll < rates.rate429 + rates.rate5xx + rates.midStreamErrorRate) {
    return { kind: 'midstream' };
  }
  if (chance(random, rates.stallRate)) {
    return { kind: 'stall', ms: rates.stallMs };
  }
  return NO_FAULT;
}

/** The label a fault is counted under in `faults_total`. */
export function faultLabel(fault: Fault): string | null {
  switch (fault.kind) {
    case 'http':
      return `http_${fault.status}`;
    case 'midstream':
      return 'midstream_error';
    case 'stall':
      return 'stall';
    default:
      return null;
  }
}

export interface ErrorReply {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
}

const OPENAI_ERRORS: Readonly<
  Record<number, { type: string; code: string | null; message: string }>
> = {
  400: {
    type: 'invalid_request_error',
    code: null,
    message: 'The request could not be understood.',
  },
  401: {
    type: 'invalid_request_error',
    code: 'invalid_api_key',
    message: 'Incorrect API key provided.',
  },
  402: {
    type: 'insufficient_quota',
    code: 'insufficient_quota',
    message: 'You exceeded your current quota, please check your plan.',
  },
  403: {
    type: 'invalid_request_error',
    code: 'unsupported_country_region_territory',
    message: 'Country, region, or territory not supported.',
  },
  404: {
    type: 'invalid_request_error',
    code: 'model_not_found',
    message: 'The model does not exist or you do not have access to it.',
  },
  429: {
    type: 'rate_limit_exceeded',
    code: 'rate_limit_exceeded',
    message:
      'Rate limit reached for requests. Please try again in a few seconds.',
  },
};

const ANTHROPIC_ERRORS: Readonly<
  Record<number, { type: string; message: string }>
> = {
  400: { type: 'invalid_request_error', message: 'Invalid request.' },
  401: { type: 'authentication_error', message: 'invalid x-api-key' },
  402: { type: 'billing_error', message: 'Your credit balance is too low.' },
  403: { type: 'permission_error', message: 'Permission denied.' },
  404: { type: 'not_found_error', message: 'model not found' },
  413: {
    type: 'request_too_large',
    message: 'Request exceeds the size limit.',
  },
  429: {
    type: 'rate_limit_error',
    message: 'Number of requests has exceeded your rate limit.',
  },
  500: { type: 'api_error', message: 'Internal server error' },
  529: { type: 'overloaded_error', message: 'Overloaded' },
};

/**
 * The refusal a provider of `dialect` answers with `status`, body and
 * headers included. A 503 on the Anthropic dialect becomes the 529
 * `overloaded_error` Anthropic actually sends.
 */
export function errorReply(
  dialect: Dialect,
  requested: number,
  retryAfterSeconds: number,
  message?: string,
): ErrorReply {
  const headers: Record<string, string> = {};
  if (dialect === 'anthropic') {
    const status = requested === 503 ? 529 : requested;
    const known =
      ANTHROPIC_ERRORS[status] ??
      (status >= 500
        ? { type: 'api_error', message: 'Internal server error' }
        : { type: 'invalid_request_error', message: 'Invalid request.' });
    if (status === 429) {
      headers['retry-after'] = String(retryAfterSeconds);
      headers['anthropic-ratelimit-requests-remaining'] = '0';
    }
    return {
      status,
      headers,
      body: {
        type: 'error',
        error: { type: known.type, message: message ?? known.message },
      },
    };
  }
  const status = requested;
  if (status >= 500) {
    return {
      status,
      headers,
      body: {
        error: {
          message:
            message ??
            'The server had an error while processing your request. Sorry about that!',
          type: 'server_error',
        },
      },
    };
  }
  const known = OPENAI_ERRORS[status] ?? {
    type: 'invalid_request_error',
    code: null,
    message: 'The request was refused.',
  };
  if (status === 429) {
    headers['retry-after'] = String(retryAfterSeconds);
    headers['x-ratelimit-limit-requests'] = '10000';
    headers['x-ratelimit-remaining-requests'] = '0';
    headers['x-ratelimit-reset-requests'] = `${retryAfterSeconds}s`;
  }
  return {
    status,
    headers,
    body: {
      error: {
        message: message ?? known.message,
        type: known.type,
        param: null,
        code: known.code,
      },
    },
  };
}
