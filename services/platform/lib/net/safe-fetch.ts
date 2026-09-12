/**
 * SSRF-safe HTTP client for outbound calls from Convex actions.
 *
 * Rejects loopback, RFC1918 private ranges, link-local, and the
 * cloud metadata address (169.254.169.254). Follows redirects manually
 * and re-validates every hop. Enforces body size caps pre-read via
 * Content-Length and post-read while streaming. Refuses plaintext
 * `http://` to public hosts so bearer-bearing requests cannot cross
 * the open internet unencrypted; local self-hosted providers (private
 * IP or explicit `allowedHosts` entry) may still use `http://`.
 *
 * DNS rebinding is closed at the dial: before every hop the hostname is
 * resolved here, every address it answers is checked (loopback, private,
 * link-local, CGNAT, ULA, IPv4-mapped — and the cloud metadata addresses
 * whatever the caller admits), and the checked addresses are PINNED for
 * the connect through an undici dispatcher whose `lookup` hands them to
 * the socket. The hostname string policy stays (a name that is itself a
 * private literal, the allowlist, plaintext refusals); what it could not
 * see — a public-looking name whose record points inside the network, or
 * flips between the check and the dial — is refused with `private_ip`,
 * and a second resolution never happens.
 *
 * Extracted from images/http_actions.ts so chat-filter's moderation
 * provider and any future outbound caller share one audited implementation.
 */

import dns from 'node:dns';
import type { LookupFunction } from 'node:net';

import { Agent } from 'undici';

import { isMetadataAddress, isPrivateIp } from '../shared/net/private-ip';

export type SafeFetchErrorKind =
  | 'invalid_url'
  | 'unsupported_protocol'
  | 'insecure_public_http'
  | 'private_ip'
  | 'dns_failed'
  | 'redirect_missing_location'
  | 'redirect_limit_exceeded'
  | 'response_too_large'
  | 'response_too_small'
  | 'network_error'
  | 'timeout'
  | 'aborted';

export class SafeFetchError extends Error {
  readonly kind: SafeFetchErrorKind;
  readonly status?: number;

  constructor(kind: SafeFetchErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'SafeFetchError';
    this.kind = kind;
    this.status = status;
  }
}

export interface SafeFetchOptions {
  /** The verb is forwarded to `fetch` unchanged; PATCH is here because
   * connector bodies issue partial updates (GitHub issue edits,
   * for one) through this same audited client. */
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';
  headers?: Record<string, string>;
  body?: string | FormData;
  timeoutMs?: number;
  maxResponseBytes?: number;
  maxRedirects?: number;
  allowedHosts?: string[];
  /** A caller's own deadline. When it fires the request is torn down at once
   * (kind `aborted`) instead of running on to `timeoutMs` — a caller that has
   * already given up on the reply must not keep the provider working. */
  signal?: AbortSignal;
  /** Admit a host that RESOLVES to a loopback, private-network, link-local
   * or CGNAT address — an intranet crawl, a self-hosted provider behind an
   * internal name. The hostname policy still applies, and the cloud
   * metadata addresses stay refused whatever this says. */
  allowPrivateAddresses?: boolean;
  /** Refuse every plaintext `http:` URL — the initial one and every
   * redirect hop, whatever `allowedHosts` admits — for a lane that never
   * needs cleartext (the crawler): a redirect onto port 80 is otherwise the
   * hop that reaches a metadata service. */
  httpsOnly?: boolean;
}

/** One address a hostname resolved to. */
export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export type SafeFetchResolver = (
  hostname: string,
) => Promise<readonly ResolvedAddress[]>;

/** The OS resolver — `/etc/hosts` and `nsswitch` included, exactly what
 * the socket would consult — every address, in answer order. */
export async function lookupHostAddresses(
  hostname: string,
): Promise<readonly ResolvedAddress[]> {
  const found = await dns.promises.lookup(hostname, { all: true });
  return found.map(({ address, family }) => ({
    address,
    family: family === 6 ? 6 : 4,
  }));
}

let resolver: SafeFetchResolver = lookupHostAddresses;

/** Test seam: answer resolutions from a script (null restores the OS
 * resolver) — the unit suites stub `fetch` and must not reach DNS; the
 * integration check names fixture hosts no resolver knows. */
export function setSafeFetchResolverForTests(
  override: SafeFetchResolver | null,
): void {
  resolver = override ?? lookupHostAddresses;
}

/** Every address `hostname` resolves to, through the seam above — for the
 * registration-time checks that want the same answer the dial will get. */
export function resolveHostAddresses(
  hostname: string,
): Promise<readonly ResolvedAddress[]> {
  return resolver(hostname);
}

function isIpLiteral(hostname: string): boolean {
  return (
    /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) ||
    hostname.includes(':') ||
    /^\[.*\]$/.test(hostname)
  );
}

/**
 * Resolve `hostname` and refuse what its record must not reach: the cloud
 * metadata addresses always, a private/loopback/link-local address unless
 * the caller admits them. Null for an IP literal — nothing to resolve, and
 * the string policy already judged it. What comes back is what the dial
 * pins.
 */
async function checkedAddresses(
  hostname: string,
  options: SafeFetchOptions,
): Promise<readonly ResolvedAddress[] | null> {
  if (isIpLiteral(hostname)) return null;
  let found: readonly ResolvedAddress[];
  try {
    found = await resolver(hostname);
  } catch (error) {
    throw new SafeFetchError(
      'dns_failed',
      `Host does not resolve: ${hostname} (${error instanceof Error ? error.message : String(error)})`,
    );
  }
  if (found.length === 0) {
    throw new SafeFetchError(
      'dns_failed',
      `Host does not resolve: ${hostname}`,
    );
  }
  for (const { address } of found) {
    if (isMetadataAddress(address)) {
      throw new SafeFetchError(
        'private_ip',
        `Host resolves to a cloud metadata address: ${hostname} → ${address}`,
      );
    }
    if (options.allowPrivateAddresses !== true && isPrivateIp(address)) {
      throw new SafeFetchError(
        'private_ip',
        `Host resolves to a private, loopback or link-local address: ${hostname} → ${address}`,
      );
    }
  }
  return found;
}

/**
 * The dispatcher every hop of one request goes through: its `lookup`
 * answers ONLY from the addresses `checkedAddresses` pinned for that
 * hostname, so the socket connects to what was checked and a record that
 * changed in between is never consulted. TLS keeps the hostname as
 * servername, so certificate verification is unchanged.
 */
function pinnedDispatcher(
  pinned: ReadonlyMap<string, readonly ResolvedAddress[]>,
): Agent {
  const lookup: LookupFunction = (hostname, options, callback) => {
    const addresses = pinned.get(hostname.toLowerCase());
    const [first] = addresses ?? [];
    if (first === undefined) {
      callback(
        new Error(`safeFetch: no pinned address for ${hostname}`),
        '',
        undefined,
      );
      return;
    }
    if (typeof options === 'object' && options.all) {
      callback(null, [...(addresses ?? [])], undefined);
      return;
    }
    callback(null, first.address, first.family);
  };
  return new Agent({ connect: { lookup } });
}

export interface SafeFetchResponse {
  status: number;
  statusText: string;
  headers: Headers;
  body: string;
  finalUrl: string;
}

export interface SafeFetchBinaryResponse {
  status: number;
  statusText: string;
  headers: Headers;
  body: Blob;
  finalUrl: string;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RESPONSE_BYTES = 1_048_576; // 1 MB
const DEFAULT_MAX_REDIRECTS = 5;

/**
 * Status codes that signal "follow the Location header" in HTTP semantics.
 * The previous `status >= 300 && status < 400` filter included 304 Not
 * Modified, 305 Use Proxy, and 306 (unused) — none carry a Location header,
 * so the loop fell into the missing-Location throw instead of returning
 * the response intact (round-2 #20).
 */
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([
  301, 302, 303, 307, 308,
]);

// `isPrivateIp` moved to `lib/shared/net/private-ip.ts` so the provider
// schema (Layer A) can share the SAME recognizer instead of a divergent
// copy; re-exported here because this module is where request-time callers
// (and their tests) have always imported it from.
export { isPrivateIp };

function hostMatchesEntry(hostname: string, entry: string): boolean {
  const h = hostname.toLowerCase();
  const e = entry.toLowerCase();
  return h === e || h.endsWith(`.${e}`);
}

/**
 * Reject the URL by hostname-string match against the IMDS / private ranges
 * and the optional `allowedHosts` allowlist. Does NOT pin DNS — `fetch` will
 * re-resolve and a short-TTL rebind from public to private IP between this
 * check and the request slips through. To pin against rebinding, an undici
 * Dispatcher with a `lookup` callback is required (not used here today).
 *
 * `callerAllowedHosts` is the list the caller explicitly passed (or
 * `undefined` if they passed none). `effectiveAllowedHosts` is that list
 * merged with the auto-derived initial-URL host (used to gate redirects).
 * The two are kept separate so the insecure-public-http refuse can ignore
 * the auto-derived entry: an operator who typed `http://api.example.com`
 * into a provider config didn't *explicitly* whitelist that host, they
 * just typed it as a baseUrl — and we want to surface the cleartext-bearer
 * risk instead of silently honoring it.
 */
function validateUrl(
  rawUrl: string,
  effectiveAllowedHosts: string[] | undefined,
  callerAllowedHosts: string[] | undefined,
  httpsOnly = false,
): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new SafeFetchError('invalid_url', `Invalid URL: ${rawUrl}`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new SafeFetchError(
      'unsupported_protocol',
      `Unsupported protocol: ${parsed.protocol}`,
    );
  }

  const hostname = parsed.hostname;
  if (parsed.protocol === 'http:' && httpsOnly) {
    throw new SafeFetchError(
      'insecure_public_http',
      `Plaintext http:// refused on this lane: ${hostname}`,
    );
  }
  // The metadata services by literal address, whatever the allowlist or
  // the private-range admission says — a crawl of an intranet must still
  // never read the instance's own credentials.
  if (isMetadataAddress(hostname)) {
    throw new SafeFetchError(
      'private_ip',
      `Host is a cloud metadata address: ${hostname}`,
    );
  }
  const effectivelyAllowed =
    effectiveAllowedHosts !== undefined &&
    effectiveAllowedHosts.some((entry) => hostMatchesEntry(hostname, entry));
  const callerExplicitlyAllowed =
    callerAllowedHosts !== undefined &&
    callerAllowedHosts.some((entry) => hostMatchesEntry(hostname, entry));
  const isPrivate = isPrivateIp(hostname);

  // Refuse plaintext `http://` to public hosts. Callers (notably the TTS
  // synthesize action) attach `Authorization: Bearer <apiKey>` to the
  // request; over `http://` the key would cross the open internet in the
  // clear. Self-hosted local TTS providers are commonly reached over
  // `http://` on a private network — they're still allowed because either
  // (a) the host is in a private/loopback range, or (b) the operator has
  // explicitly named it in `allowedHosts` (NOT just typed it as a baseUrl;
  // the auto-derived initial-host entry doesn't count). Public-internet
  // `http://` with a bearer header is never a legitimate provider call.
  if (parsed.protocol === 'http:' && !isPrivate && !callerExplicitlyAllowed) {
    throw new SafeFetchError(
      'insecure_public_http',
      `Plaintext http:// to public host refused (would leak bearer credentials): ${hostname}`,
    );
  }

  if (isPrivate && !effectivelyAllowed) {
    throw new SafeFetchError(
      'private_ip',
      `Host resolves to private/loopback address: ${hostname}`,
    );
  }

  if (
    effectiveAllowedHosts &&
    effectiveAllowedHosts.length > 0 &&
    !effectivelyAllowed
  ) {
    throw new SafeFetchError(
      'private_ip',
      `Host not in allowedHosts: ${hostname}`,
    );
  }

  return parsed;
}

async function readBinaryBodyWithCap(
  response: Response,
  maxBytes: number,
): Promise<{ buffer: ArrayBuffer; contentType: string }> {
  const contentLength = response.headers.get('Content-Length');
  if (contentLength) {
    const declared = Number.parseInt(contentLength, 10);
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new SafeFetchError(
        'response_too_large',
        `Response Content-Length ${declared} exceeds limit ${maxBytes}`,
        response.status,
      );
    }
  }

  const reader = response.body?.getReader();
  const contentType = response.headers.get('Content-Type') ?? '';
  if (!reader) return { buffer: new ArrayBuffer(0), contentType };

  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new SafeFetchError(
        'response_too_large',
        `Response body exceeded limit ${maxBytes}`,
        response.status,
      );
    }
    chunks.push(value);
  }

  const buffer = new ArrayBuffer(total);
  const view = new Uint8Array(buffer);
  let offset = 0;
  for (const chunk of chunks) {
    view.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { buffer, contentType };
}

async function readBodyWithCap(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const contentLength = response.headers.get('Content-Length');
  if (contentLength) {
    const declared = Number.parseInt(contentLength, 10);
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new SafeFetchError(
        'response_too_large',
        `Response Content-Length ${declared} exceeds limit ${maxBytes}`,
        response.status,
      );
    }
  }

  const reader = response.body?.getReader();
  if (!reader) return '';

  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new SafeFetchError(
        'response_too_large',
        `Response body exceeded limit ${maxBytes}`,
        response.status,
      );
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8').decode(merged);
}

/**
 * Header names that carry credentials and must be stripped on cross-host
 * redirects. Browsers do this automatically; Node `fetch` does not, so an
 * attacker who controls a redirect target on an allowlisted-but-different
 * host can otherwise harvest the upstream provider's `Authorization`
 * bearer token. Comparison is case-insensitive.
 */
const CROSS_HOST_SENSITIVE_HEADERS: ReadonlySet<string> = new Set([
  'authorization',
  'cookie',
  'proxy-authorization',
  'x-api-key',
]);

function stripCrossHostSensitiveHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (CROSS_HOST_SENSITIVE_HEADERS.has(name.toLowerCase())) continue;
    out[name] = value;
  }
  return out;
}

/** Request headers that describe a body; they leave with it. */
const BODY_HEADERS: ReadonlySet<string> = new Set([
  'content-type',
  'content-length',
  'content-encoding',
]);

function stripBodyHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (BODY_HEADERS.has(name.toLowerCase())) continue;
    out[name] = value;
  }
  return out;
}

/**
 * Whether following this redirect switches the request to GET (RFC 9110
 * §15.4): a 303 always does (except for HEAD, which stays HEAD), and a
 * 301/302 answered to a POST does — the convention every mainstream client
 * (browsers, undici, curl) implements. 307/308 keep method and body by
 * definition.
 */
function redirectSwitchesToGet(status: number, method: string): boolean {
  const upper = method.toUpperCase();
  if (upper === 'HEAD') return false;
  if (status === 303) return true;
  return (status === 301 || status === 302) && upper === 'POST';
}

/**
 * The shared request loop of `safeFetch` and `safeFetchBinary`: derive the
 * allowlist, validate the URL, follow redirects manually re-validating every
 * hop, and hand back the final non-redirect response with the URL it came
 * from. `signal` is the caller's abort controller (timeout + the caller's
 * own `options.signal`; it also covers the body read that follows).
 *
 * A redirect may rewrite the request, not only its URL: credential headers
 * are dropped on cross-host hops, and a 303 (or 301/302 to a POST) is
 * followed with GET and no body — replaying a POST body against the
 * Location would perform the mutation twice, or hand a JSON body to a read
 * endpoint with the Authorization header still attached.
 */
async function fetchFollowingRedirects(
  rawUrl: string,
  options: SafeFetchOptions,
  signal: AbortSignal,
  timeoutMs: number,
  pinned: Map<string, readonly ResolvedAddress[]>,
  dispatcher: Agent,
): Promise<{ response: Response; finalUrl: string }> {
  const {
    method = 'GET',
    headers = {},
    body,
    maxRedirects = DEFAULT_MAX_REDIRECTS,
    allowedHosts: callerAllowedHosts,
    signal: callerSignal,
  } = options;

  // When the caller doesn't supply an allowlist, auto-derive it from the
  // initial URL's host. Rationale: admins typically configure a single
  // endpoint URL and the duplication of also typing the hostname into an
  // `allowedHosts` list is pure ceremony. Redirects to a *different* host
  // still get rejected because `validateUrl` re-checks with the same
  // list. Callers that truly want to allow cross-host redirects (rare)
  // pass a non-empty `allowedHosts` explicitly.
  let allowedHosts = callerAllowedHosts;
  if (allowedHosts === undefined) {
    try {
      const ownHost = new URL(rawUrl).hostname.toLowerCase();
      if (ownHost) allowedHosts = [ownHost];
    } catch (err) {
      // Intentional swallow: `validateUrl` below produces the canonical
      // `invalid_url` SafeFetchError for malformed URLs. The debug log
      // keeps a forensic trail per CLAUDE.md's no-silent-swallow rule
      // without trying to recover here.
      console.debug(
        '[safe_fetch] auto-allowlist URL parse failed; deferring to validateUrl',
        err,
      );
    }
  }

  const initial = validateUrl(
    rawUrl,
    allowedHosts,
    callerAllowedHosts,
    options.httpsOnly,
  );
  // Resolve, check and pin BEFORE the dial — the address the socket gets is
  // the one that passed, on this hop and on every redirect hop below.
  const pinHost = async (url: URL): Promise<void> => {
    const addresses = await checkedAddresses(url.hostname, options);
    if (addresses !== null) pinned.set(url.hostname.toLowerCase(), addresses);
  };
  await pinHost(initial);

  if (callerSignal?.aborted) {
    throw new SafeFetchError(
      'aborted',
      'Request aborted by the caller before it started',
    );
  }

  let currentUrl = rawUrl;
  let currentMethod: string = method;
  let currentHeaders = headers;
  let currentBody = body;
  let redirectsFollowed = 0;

  while (true) {
    let response: Response;
    try {
      const init: RequestInit & { dispatcher: Agent } = {
        method: currentMethod,
        headers: currentHeaders,
        body: currentBody,
        redirect: 'manual',
        signal,
        dispatcher,
      };
      response = await fetch(currentUrl, init);
    } catch (error) {
      if (error instanceof SafeFetchError) throw error;
      if (
        error instanceof Error &&
        (error.name === 'AbortError' || error.name === 'TimeoutError')
      ) {
        if (callerSignal?.aborted) {
          throw new SafeFetchError(
            'aborted',
            'Request aborted by the caller before it completed',
          );
        }
        throw new SafeFetchError(
          'timeout',
          `Request timed out after ${timeoutMs}ms`,
        );
      }
      const message = error instanceof Error ? error.message : 'unknown';
      throw new SafeFetchError('network_error', `fetch failed: ${message}`);
    }

    if (!REDIRECT_STATUSES.has(response.status)) {
      // 304/305/306 land here too — they carry no Location header, so
      // returning them to the caller is correct.
      return { response, finalUrl: currentUrl };
    }

    const location = response.headers.get('Location');
    if (!location) {
      throw new SafeFetchError(
        'redirect_missing_location',
        `Redirect ${response.status} missing Location header`,
        response.status,
      );
    }

    redirectsFollowed += 1;
    if (redirectsFollowed > maxRedirects) {
      throw new SafeFetchError(
        'redirect_limit_exceeded',
        `Exceeded ${maxRedirects} redirects`,
      );
    }

    const nextUrl = new URL(location, currentUrl);
    validateUrl(
      nextUrl.toString(),
      allowedHosts,
      callerAllowedHosts,
      options.httpsOnly,
    );
    await pinHost(nextUrl);
    // Drop credential-carrying headers on cross-host hops so an
    // attacker who controls a redirect target on a second allowlisted
    // host can't harvest the upstream provider's bearer token.
    if (nextUrl.host.toLowerCase() !== new URL(currentUrl).host.toLowerCase()) {
      currentHeaders = stripCrossHostSensitiveHeaders(currentHeaders);
    }
    if (redirectSwitchesToGet(response.status, currentMethod)) {
      currentMethod = 'GET';
      currentBody = undefined;
      currentHeaders = stripBodyHeaders(currentHeaders);
    }
    currentUrl = nextUrl.toString();
  }
}

export async function safeFetch(
  rawUrl: string,
  options: SafeFetchOptions = {},
): Promise<SafeFetchResponse> {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
    signal,
  } = options;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const onCallerAbort = (): void => controller.abort();
  signal?.addEventListener('abort', onCallerAbort, { once: true });
  const pinned = new Map<string, readonly ResolvedAddress[]>();
  const dispatcher = pinnedDispatcher(pinned);

  try {
    const { response, finalUrl } = await fetchFollowingRedirects(
      rawUrl,
      options,
      controller.signal,
      timeoutMs,
      pinned,
      dispatcher,
    );
    const bodyText = await readBodyWithCap(response, maxResponseBytes);

    return {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
      body: bodyText,
      finalUrl,
    };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', onCallerAbort);
    // The pinned sockets are this exchange's alone: never reused by a
    // request with another policy (the body has been read by now).
    await dispatcher.destroy().catch((error: unknown) => {
      console.warn('[safe_fetch] closing the pinned dispatcher failed:', error);
    });
  }
}

/**
 * Binary sibling of `safeFetch`. Returns the response body as a `Blob` and
 * enforces `maxResponseBytes` during streaming reads (not after the body
 * fully materialises), so a `Transfer-Encoding: chunked` response with no
 * `Content-Length` header cannot OOM the action by buffering gigabytes
 * before the size check fires.
 *
 * The body's MIME type prefers the response `Content-Type` header but falls
 * back to a caller-supplied `defaultContentType` (typically derived from the
 * caller's expected audio format) so the resulting Blob can be stored or
 * served with a usable type even when the upstream omits the header.
 */
export async function safeFetchBinary(
  rawUrl: string,
  options: SafeFetchOptions & { defaultContentType?: string } = {},
): Promise<SafeFetchBinaryResponse> {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
    defaultContentType,
    signal,
  } = options;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const onCallerAbort = (): void => controller.abort();
  signal?.addEventListener('abort', onCallerAbort, { once: true });
  const pinned = new Map<string, readonly ResolvedAddress[]>();
  const dispatcher = pinnedDispatcher(pinned);

  try {
    const { response, finalUrl } = await fetchFollowingRedirects(
      rawUrl,
      options,
      controller.signal,
      timeoutMs,
      pinned,
      dispatcher,
    );
    const { buffer, contentType } = await readBinaryBodyWithCap(
      response,
      maxResponseBytes,
    );
    const blobType =
      contentType || defaultContentType || 'application/octet-stream';
    const blob = new Blob([buffer], { type: blobType });

    return {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
      body: blob,
      finalUrl,
    };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', onCallerAbort);
    await dispatcher.destroy().catch((error: unknown) => {
      console.warn('[safe_fetch] closing the pinned dispatcher failed:', error);
    });
  }
}
