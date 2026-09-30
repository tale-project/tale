/**
 * The harness's stand-in for the vendors a `backend:integration` run would
 * otherwise reach, so the check depends on nothing off the box but the
 * database and the object store it starts itself.
 *
 * Three lanes used to go out to real vendors. Every model resolution walks
 * the shipped connectors, and two of them list their catalogs live:
 * OpenRouter's public listings and the Vercel AI Gateway's `/models`. The AI
 * title lane asked `api.anthropic.com`, with the fake key the
 * provider-credentials lane leaves as the org's Anthropic default. Where a
 * vendor did not answer, a send sat out three 10 s connect timeouts and ended
 * on a 500, and the title lane lost its 10 s race. The video-link lanes
 * resolved `www.youtube.com` in public DNS.
 *
 * {@link routeVendorFetch} moves only the TRANSPORT of those origins to one
 * local stub: the URL, the host policy, the attribution headers and the
 * credential choice stay what production computes, so each lane still runs
 * the shipped path end to end. Repointing the shipped `baseUrl`s instead would
 * change what the code decides: attribution keys off the `openrouter.ai` host,
 * a loopback base needs the private-host opt-in, and OpenRouter's listing URLs
 * are constants no configuration names. {@link itestResolve} is the matching
 * DNS: no name ever reaches a real resolver.
 */

import { createServer } from 'node:http';

import type { ResolvedAddress } from '../lib/net/safe-fetch.ts';

/** RFC 5737 TEST-NET-3: public to every private-range check, routed nowhere.
 * The unit suites answer every name with it too (`tests/setup-server.ts`). */
export const ITEST_FIXTURE_ADDRESS = '203.0.113.10';

/**
 * The harness's DNS, for `safeFetch` and the video-link pre-resolution alike.
 * A lane names fixture hosts no resolver knows (`itest-crawl.example`) and
 * vendor hosts whose transport the stub answers; both read as
 * {@link ITEST_FIXTURE_ADDRESS}, and `localhost` stays loopback. The guards
 * that judge an answer are proven by their unit suites.
 */
export function itestResolve(
  hostname: string,
): Promise<readonly ResolvedAddress[]> {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost')) {
    return Promise.resolve([{ address: '127.0.0.1', family: 4 }]);
  }
  return Promise.resolve([{ address: ITEST_FIXTURE_ADDRESS, family: 4 }]);
}

/** The shipped vendor hosts the stub stands in for. */
export const ITEST_VENDOR_HOSTS: readonly string[] = [
  'api.anthropic.com',
  'openrouter.ai',
  'ai-gateway.vercel.sh',
];

/** One request the stub received. */
export interface VendorStubRequest {
  readonly method: string;
  /** The vendor host the request was addressed to. */
  readonly host: string;
  /** Path and query as the vendor would have seen them. */
  readonly path: string;
  /** Whether a credential header came along; its value is never kept. */
  readonly credentialed: boolean;
}

export interface VendorAnswer {
  readonly status: number;
  readonly body: unknown;
}

/** OpenRouter's four public listings, one model each: the default listing
 * (text output), and the embeddings, image and transcription populations it
 * serves only behind `output_modalities`. Shaped as the live API answers. */
const OPENROUTER_LISTINGS: Readonly<Record<string, readonly unknown[]>> = {
  '': [
    {
      id: 'itest-vendor/chat',
      name: 'Itest vendor chat',
      context_length: 32_768,
      architecture: {
        input_modalities: ['text'],
        output_modalities: ['text'],
      },
      pricing: { prompt: '0.000001', completion: '0.000002' },
      top_provider: { max_completion_tokens: 4096 },
      supported_parameters: ['max_tokens', 'temperature', 'tools'],
    },
  ],
  embeddings: [
    {
      id: 'itest-vendor/embed',
      context_length: 8192,
      architecture: {
        input_modalities: ['text'],
        output_modalities: ['embeddings'],
      },
      pricing: { prompt: '0.0000001', completion: '0' },
    },
  ],
  image: [
    {
      id: 'itest-vendor/image',
      context_length: 4096,
      architecture: {
        input_modalities: ['text'],
        output_modalities: ['image'],
      },
      pricing: { prompt: '0', completion: '0' },
    },
  ],
  transcription: [
    {
      id: 'itest-vendor/transcribe',
      context_length: 0,
      architecture: {
        input_modalities: ['audio'],
        output_modalities: ['transcription'],
      },
      pricing: { prompt: '0.1', completion: '0' },
    },
  ],
};

/** The Vercel AI Gateway's `/models`, in its OpenAI-compatible dialect. */
const VERCEL_LISTING: readonly unknown[] = [
  {
    id: 'itest-vendor/gateway-chat',
    object: 'model',
    owned_by: 'itest-vendor',
    name: 'Itest vendor gateway chat',
    type: 'language',
    context_window: 32_768,
    max_tokens: 4096,
    pricing: { input: '0.000001', output: '0.000002' },
  },
];

/** What the Messages API answers a key it does not know. Until this stub,
 * the title lane's CI log read `anthropic answered 401` with this body
 * (Checks job 109833026266). */
const ANTHROPIC_UNKNOWN_KEY = {
  type: 'error',
  error: { type: 'authentication_error', message: 'API key is invalid.' },
  request_id: null,
};

/**
 * The stub's answer for one request, or null for a vendor surface it does
 * not model: the harness counts those, so a lane that starts reaching for a
 * new vendor path is named instead of quietly degrading on a 404.
 */
export function vendorAnswer(
  method: string,
  host: string,
  path: string,
  query: URLSearchParams,
): VendorAnswer | null {
  if (
    host === 'openrouter.ai' &&
    method === 'GET' &&
    path === '/api/v1/models'
  ) {
    const listing = OPENROUTER_LISTINGS[query.get('output_modalities') ?? ''];
    return listing === undefined
      ? null
      : { status: 200, body: { data: listing } };
  }
  if (
    host === 'ai-gateway.vercel.sh' &&
    method === 'GET' &&
    path === '/v1/models'
  ) {
    return { status: 200, body: { object: 'list', data: VERCEL_LISTING } };
  }
  if (
    host === 'api.anthropic.com' &&
    method === 'POST' &&
    path === '/v1/messages'
  ) {
    return { status: 401, body: ANTHROPIC_UNKNOWN_KEY };
  }
  return null;
}

export interface ItestVendorStub {
  /** `http://127.0.0.1:<port>`: vendor paths live under `/<vendor host>`. */
  readonly origin: string;
  /** Every request the stub received, in order. */
  readonly requests: readonly VendorStubRequest[];
  /** The ones {@link vendorAnswer} does not model (answered 404). */
  readonly unexpected: readonly VendorStubRequest[];
  close(): Promise<void>;
}

/** Start the stub on a free loopback port, like every lane's own stub. */
export async function startItestVendorStub(
  log: (line: string) => void = console.log,
): Promise<ItestVendorStub> {
  const requests: VendorStubRequest[] = [];
  const unexpected: VendorStubRequest[] = [];
  const server = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://vendor-stub');
      const [, host = '', ...rest] = url.pathname.split('/');
      const path = `/${rest.join('/')}`;
      const request: VendorStubRequest = {
        method: req.method ?? 'GET',
        host,
        path: `${path}${url.search}`,
        credentialed:
          req.headers.authorization !== undefined ||
          req.headers['x-api-key'] !== undefined,
      };
      requests.push(request);
      const answer = vendorAnswer(request.method, host, path, url.searchParams);
      res.setHeader('content-type', 'application/json');
      if (answer === null) {
        unexpected.push(request);
        log(
          `[itest] vendor stub has no answer for ${request.method} ${host}${path}; answered 404`,
        );
        res.statusCode = 404;
        res.end(
          JSON.stringify({ error: 'not served by the itest vendor stub' }),
        );
        return;
      }
      log(
        `[itest] vendor stub answered ${request.method} ${host}${request.path} with ${answer.status}`,
      );
      res.statusCode = answer.status;
      res.end(JSON.stringify(answer.body));
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port =
    address !== null && typeof address === 'object' ? address.port : 0;
  return {
    origin: `http://127.0.0.1:${port}`,
    requests,
    unexpected,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

/** A request the boundary refused, named by its host alone: a path or a
 * query can carry a secret (a webhook URL, a bot token). */
export interface OffBoxRequest {
  readonly method: string;
  readonly origin: string;
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '::1' ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)
  );
}

/** undici's `fetch failed`, its cause coded as a connection nothing
 * answered, so a caller that reads the code (the relay's never-connected
 * check, the database-outage classifier) reads a refusal as one. */
function offBoxRefusal(host: string): TypeError {
  const cause = Object.assign(
    new Error(
      `connect ECONNREFUSED ${host}: the integration check reaches nothing off the box`,
    ),
    { code: 'ECONNREFUSED', syscall: 'connect' },
  );
  return new TypeError('fetch failed', { cause });
}

export interface VendorRouteOptions {
  /** The vendor stub's origin ({@link ItestVendorStub.origin}). */
  readonly stubOrigin: string;
  /** Origins that are part of the run although not loopback: the object
   * store `ITEST_S3_ENDPOINT` names may be a service or a LAN host. */
  readonly onTheBox?: readonly string[];
  readonly onOffBox: (request: OffBoxRequest) => void;
}

/** The statuses fetch follows, and how many of them it follows at most
 * (the fetch standard's HTTP-redirect fetch). */
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([
  301, 302, 303, 307, 308,
]);
const MAX_REDIRECTS = 20;
/** Dropped with the body when a redirect turns the request into a GET. */
const REQUEST_BODY_HEADERS = [
  'content-encoding',
  'content-language',
  'content-location',
  'content-type',
  'content-length',
];
/** Dropped when a redirect leaves the request's origin. */
const CROSS_ORIGIN_HEADERS = [
  'authorization',
  'proxy-authorization',
  'cookie',
  'host',
];

/** fetch's own failure for a redirect it does not follow. */
function redirectFailure(reason: string, cause?: unknown): TypeError {
  return new TypeError('fetch failed', {
    cause:
      cause === undefined ? new Error(reason) : new Error(reason, { cause }),
  });
}

/** A body fetch can extract again for the next hop; a stream it cannot. */
function replayableBody(body: RequestInit['body']): boolean {
  return (
    body === null ||
    body === undefined ||
    typeof body === 'string' ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body) ||
    body instanceof Blob ||
    body instanceof URLSearchParams ||
    body instanceof FormData
  );
}

/** fetch's method normalization: the six standard methods upper-cased. */
function normalizedMethod(method: string): string {
  const upper = method.toUpperCase();
  return ['DELETE', 'GET', 'HEAD', 'OPTIONS', 'POST', 'PUT'].includes(upper)
    ? upper
    : method;
}

/** A followed response reads as fetch's own: redirected, at the last URL. */
function redirectedResponse(response: Response, url: URL): Response {
  const last = new URL(url.href);
  last.hash = '';
  return Object.defineProperties(response, {
    redirected: { value: true },
    url: { value: last.href },
  });
}

async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch (error) {
    console.warn('[itest] could not discard a redirect response body:', error);
  }
}

/**
 * The harness's outbound boundary, installed as `globalThis.fetch` for the
 * whole run. A lane's own fetch stub sits on top of it and answers its
 * fixture hosts first; what reaches this function is:
 *
 *  - a loopback request (the backend under test, every lane's stub), one
 *    to an `onTheBox` origin, and a `data:` or `blob:` URL, which never
 *    leaves the process: passed through;
 *  - an `https` request to a shipped vendor host: sent to the vendor stub
 *    instead, path and query unchanged;
 *  - anything else: off the box, so refused the way a network without
 *    egress refuses it and handed to `onOffBox`, whatever the host would
 *    have answered — the lane's verdict never depends on it.
 *
 * A redirect is judged like a first request. When the caller follows
 * redirects (fetch's default), every hop goes out `manual` and its redirect
 * is followed here, by the fetch standard's rules for method, body and
 * headers, so a permitted origin cannot hand the request on to a host off the
 * box. A caller's `manual` or `error` mode reaches fetch unchanged.
 *
 * Like `fetch` itself it answers a bad input with a rejected promise, never
 * a throw.
 */
export function routeVendorFetch(
  realFetch: typeof globalThis.fetch,
  options: VendorRouteOptions,
): typeof globalThis.fetch {
  const onTheBox = options.onTheBox ?? [];
  const isVendor = (url: URL): boolean =>
    url.protocol === 'https:' && ITEST_VENDOR_HOSTS.includes(url.hostname);
  const isPermitted = (url: URL): boolean =>
    isLoopbackHost(url.hostname) ||
    onTheBox.includes(url.origin) ||
    isVendor(url);
  /** What a hop is sent to: the stub's copy of a vendor URL, else the URL. */
  const wire = (url: URL): string =>
    isVendor(url)
      ? `${options.stubOrigin}/${url.hostname}${url.pathname}${url.search}`
      : url.href;
  const refuse = (method: string, url: URL): TypeError => {
    options.onOffBox({ method, origin: url.origin });
    return offBoxRefusal(url.host);
  };

  const routed = async (
    input: Parameters<typeof globalThis.fetch>[0],
    init?: Parameters<typeof globalThis.fetch>[1],
  ): Promise<Response> => {
    const url = new URL(
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return realFetch(input, init);
    }
    let method = normalizedMethod(
      init?.method ?? (input instanceof Request ? input.method : 'GET'),
    );
    if (!isPermitted(url)) throw refuse(method, url);
    const mode =
      init?.redirect ?? (input instanceof Request ? input.redirect : 'follow');
    // A Request's own body is gone once sent: a redirect that keeps it sends
    // this copy, taken before the first hop.
    const requestCopy =
      mode === 'follow' &&
      init?.body === undefined &&
      input instanceof Request &&
      input.body !== null
        ? input.clone()
        : null;
    // `safeFetch` pins the vendor host's checked address on a dispatcher of
    // its own; the stub is a loopback literal and needs none.
    const {
      dispatcher,
      ...rest
    }: RequestInit & {
      dispatcher?: unknown;
    } = init ?? {};
    const firstMode = mode === 'follow' ? 'manual' : mode;
    let response: Response;
    if (isVendor(url)) {
      response =
        input instanceof Request
          ? await realFetch(new Request(wire(url), input), {
              ...rest,
              redirect: firstMode,
            })
          : await realFetch(wire(url), { ...rest, redirect: firstMode });
    } else {
      response = await realFetch(input, { ...init, redirect: firstMode });
    }
    if (mode !== 'follow') return response;

    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    const signal =
      init?.signal ?? (input instanceof Request ? input.signal : undefined);
    let body: RequestInit['body'] = init?.body ?? null;
    let hasBody = body !== null || requestCopy !== null;
    const replayable = requestCopy !== null || replayableBody(init?.body);
    let current = url;
    for (let redirects = 0; ; redirects += 1) {
      const location = REDIRECT_STATUSES.has(response.status)
        ? response.headers.get('location')
        : null;
      if (location === null) {
        return redirects === 0
          ? response
          : redirectedResponse(response, current);
      }
      const status = response.status;
      await discardBody(response);
      let next: URL;
      try {
        next = new URL(location, current);
      } catch (error) {
        throw redirectFailure('invalid redirect location', error);
      }
      if (next.hash === '') next.hash = current.hash;
      if (next.protocol !== 'http:' && next.protocol !== 'https:') {
        throw redirectFailure('URL scheme must be a HTTP(S) scheme');
      }
      if (redirects === MAX_REDIRECTS) {
        throw redirectFailure('redirect count exceeded');
      }
      if (next.username !== '' || next.password !== '') {
        throw redirectFailure('redirect location cannot contain credentials');
      }
      const toGet =
        ((status === 301 || status === 302) && method === 'POST') ||
        (status === 303 && method !== 'GET' && method !== 'HEAD');
      if (!isPermitted(next)) throw refuse(toGet ? 'GET' : method, next);
      if (status !== 303 && hasBody && !replayable) {
        throw redirectFailure('the request body cannot be sent again');
      }
      if (toGet) {
        method = 'GET';
        body = null;
        hasBody = false;
        for (const name of REQUEST_BODY_HEADERS) headers.delete(name);
      } else if (hasBody && requestCopy !== null && body === null) {
        body = await requestCopy.arrayBuffer();
      }
      if (next.origin !== current.origin) {
        for (const name of CROSS_ORIGIN_HEADERS) headers.delete(name);
      }
      current = next;
      const hop: RequestInit & { dispatcher?: unknown } = {
        method,
        headers,
        body,
        redirect: 'manual',
        ...(signal !== undefined ? { signal } : {}),
        ...(dispatcher !== undefined && !isVendor(next) ? { dispatcher } : {}),
      };
      response = await realFetch(wire(next), hop);
    }
  };
  // `preconnect` rides along so the global keeps its full shape.
  return Object.assign(routed, { preconnect: realFetch.preconnect });
}
