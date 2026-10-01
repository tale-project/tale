/**
 * The harness's stand-in for the vendors a `backend:integration` run would
 * otherwise reach: with it, the suite's HTTP needs nothing off the box but
 * the object store the run is given.
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

import { Agent, getGlobalDispatcher, type Dispatcher } from 'undici';

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

/** A connection nothing answered, so a caller that reads the code (the
 * relay's never-connected check, the database-outage classifier) reads a
 * refusal as one. fetch rejects with it as the cause of `fetch failed`. */
function offBoxRefusal(host: string): Error {
  return Object.assign(
    new Error(
      `connect ECONNREFUSED ${host}: the integration check reaches nothing off the box`,
    ),
    { code: 'ECONNREFUSED', syscall: 'connect' },
  );
}

export interface VendorRouteOptions {
  /** The vendor stub's origin ({@link ItestVendorStub.origin}). */
  readonly stubOrigin: string;
  /** Origins that are part of the run although not loopback: the object
   * store `ITEST_S3_ENDPOINT` names may be a service or a LAN host. */
  readonly onTheBox?: readonly string[];
  readonly onOffBox: (request: OffBoxRequest) => void;
}

/** What fetch asks of the dispatcher it is given. */
type FetchDispatcher = Pick<Dispatcher, 'dispatch'> & {
  readonly isMockActive: boolean;
};

/**
 * The harness's outbound boundary, installed as `globalThis.fetch` for the
 * whole run. A lane's own fetch stub sits on top of it and answers its
 * fixture hosts first. What reaches this function goes on to the real fetch
 * as it came, and is judged where fetch hands it to the network: the
 * dispatcher, which sends the first request and every redirect fetch
 * follows. A request to
 *
 *  - loopback (the backend under test, every lane's stub) or an `onTheBox`
 *    origin goes on through the caller's own dispatcher, else the global one;
 *  - a shipped vendor host over `https` goes to the vendor stub instead,
 *    path and query unchanged;
 *  - anything else is off the box: refused the way a network without egress
 *    refuses it, before any lookup or socket, and handed to `onOffBox`,
 *    whatever the host would have answered — the lane's verdict never
 *    depends on it.
 *
 * Methods, bodies, headers, redirect modes and the response, clones
 * included, stay fetch's own. A `data:` or `blob:` URL never reaches a
 * dispatcher. A dispatcher a Request carries itself (none in the codebase)
 * gives way to the global one. Like `fetch` it answers a bad input with a
 * rejected promise, never a throw.
 */
export function routeVendorFetch(
  realFetch: typeof globalThis.fetch,
  options: VendorRouteOptions,
): typeof globalThis.fetch {
  const onTheBox = options.onTheBox ?? [];
  const isVendor = (url: URL): boolean =>
    url.protocol === 'https:' && ITEST_VENDOR_HOSTS.includes(url.hostname);
  const isOnTheBox = (url: URL): boolean =>
    isLoopbackHost(url.hostname) || onTheBox.includes(url.origin);
  // Every connection it is asked for fails in its connector: no lookup, no
  // socket, and undici reports it as any refused connection.
  const refusing = new Agent({
    connect: (target, callback) => {
      callback(offBoxRefusal(target.host ?? target.hostname), null);
    },
  });
  const gate = (inner: Pick<Dispatcher, 'dispatch'>): FetchDispatcher => ({
    dispatch: (opts, handler) => {
      const target = new URL(opts.origin ?? '');
      if (isVendor(target)) {
        return getGlobalDispatcher().dispatch(
          {
            ...opts,
            origin: options.stubOrigin,
            path: `/${target.hostname}${opts.path}`,
          },
          handler,
        );
      }
      if (isOnTheBox(target)) return inner.dispatch(opts, handler);
      options.onOffBox({ method: opts.method, origin: target.origin });
      return refusing.dispatch(opts, handler);
    },
    // fetch hands a mock agent the body as the caller gave it.
    get isMockActive(): boolean {
      return 'isMockActive' in inner && inner.isMockActive === true;
    },
  });

  const routed = async (
    input: Parameters<typeof globalThis.fetch>[0],
    init?: Parameters<typeof globalThis.fetch>[1],
  ): Promise<Response> => {
    // The request fetch builds first; handing fetch that request keeps every
    // rule for its body, headers and redirects fetch's own.
    const request = new Request(input, init);
    const {
      dispatcher: own,
    }: RequestInit & { dispatcher?: Pick<Dispatcher, 'dispatch'> } = init ?? {};
    const gated: RequestInit & { dispatcher: FetchDispatcher } = {
      dispatcher: gate(own ?? getGlobalDispatcher()),
      // Any init resets a Request's referrer and its policy: this one keeps
      // what fetch would have sent.
      referrer: request.referrer,
      referrerPolicy: request.referrerPolicy,
    };
    return realFetch(request, gated);
  };
  // `preconnect` rides along so the global keeps its full shape.
  return Object.assign(routed, { preconnect: realFetch.preconnect });
}
