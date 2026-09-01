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
 * Known limitation — DNS rebinding: `isPrivateIp` and `validateUrl`
 * operate on the URL's hostname string, not on the IP `fetch` actually
 * dials. A short-TTL DNS rebind between `validateUrl` (which may resolve
 * to verify reachability, depending on platform) and the outbound
 * `fetch` (which re-resolves) can still route a public-looking hostname
 * to a private IP such as 169.254.169.254. Closing this gap requires an
 * undici Dispatcher with a `lookup` callback that pins the resolved
 * address; deferred to a follow-up so this PR stays scoped.
 *
 * Extracted from images/http_actions.ts so chat-filter's moderation
 * provider and any future outbound caller share one audited implementation.
 */

import { isPrivateIp } from '../shared/net/private-ip';

export type SafeFetchErrorKind =
  | 'invalid_url'
  | 'unsupported_protocol'
  | 'insecure_public_http'
  | 'private_ip'
  | 'redirect_missing_location'
  | 'redirect_limit_exceeded'
  | 'response_too_large'
  | 'response_too_small'
  | 'network_error'
  | 'timeout';

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

export async function safeFetch(
  rawUrl: string,
  options: SafeFetchOptions = {},
): Promise<SafeFetchResponse> {
  const {
    method = 'GET',
    headers = {},
    body,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
    maxRedirects = DEFAULT_MAX_REDIRECTS,
    allowedHosts: callerAllowedHosts,
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

  validateUrl(rawUrl, allowedHosts, callerAllowedHosts);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let currentUrl = rawUrl;
    let currentHeaders = headers;
    let redirectsFollowed = 0;
    let response: Response;

    while (true) {
      try {
        response = await fetch(currentUrl, {
          method,
          headers: currentHeaders,
          body,
          redirect: 'manual',
          signal: controller.signal,
        });
      } catch (error) {
        if (error instanceof SafeFetchError) throw error;
        if (
          error instanceof Error &&
          (error.name === 'AbortError' || error.name === 'TimeoutError')
        ) {
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
        break;
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
      validateUrl(nextUrl.toString(), allowedHosts, callerAllowedHosts);
      // Drop credential-carrying headers on cross-host hops so an
      // attacker who controls a redirect target on a second allowlisted
      // host can't harvest the upstream provider's bearer token.
      if (
        nextUrl.host.toLowerCase() !== new URL(currentUrl).host.toLowerCase()
      ) {
        currentHeaders = stripCrossHostSensitiveHeaders(currentHeaders);
      }
      currentUrl = nextUrl.toString();
    }

    const bodyText = await readBodyWithCap(response, maxResponseBytes);

    return {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
      body: bodyText,
      finalUrl: currentUrl,
    };
  } finally {
    clearTimeout(timeout);
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
    method = 'GET',
    headers = {},
    body,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
    maxRedirects = DEFAULT_MAX_REDIRECTS,
    allowedHosts: callerAllowedHosts,
    defaultContentType,
  } = options;

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

  validateUrl(rawUrl, allowedHosts, callerAllowedHosts);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let currentUrl = rawUrl;
    let currentHeaders = headers;
    let redirectsFollowed = 0;
    let response: Response;

    while (true) {
      try {
        response = await fetch(currentUrl, {
          method,
          headers: currentHeaders,
          body,
          redirect: 'manual',
          signal: controller.signal,
        });
      } catch (error) {
        if (error instanceof SafeFetchError) throw error;
        if (
          error instanceof Error &&
          (error.name === 'AbortError' || error.name === 'TimeoutError')
        ) {
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
        break;
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
      validateUrl(nextUrl.toString(), allowedHosts, callerAllowedHosts);
      // Drop credential-carrying headers on cross-host hops — see
      // `safeFetch` above for the threat model.
      if (
        nextUrl.host.toLowerCase() !== new URL(currentUrl).host.toLowerCase()
      ) {
        currentHeaders = stripCrossHostSensitiveHeaders(currentHeaders);
      }
      currentUrl = nextUrl.toString();
    }

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
      finalUrl: currentUrl,
    };
  } finally {
    clearTimeout(timeout);
  }
}
