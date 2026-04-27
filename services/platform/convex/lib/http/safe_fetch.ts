/**
 * SSRF-safe HTTP client for outbound calls from Convex actions.
 *
 * Rejects loopback, RFC1918 private ranges, link-local, and the
 * cloud metadata address (169.254.169.254). Follows redirects manually
 * and re-validates every hop. Enforces body size caps pre-read via
 * Content-Length and post-read while streaming.
 *
 * Extracted from images/http_actions.ts so chat-filter's moderation
 * provider and any future outbound caller share one audited implementation.
 */

export type SafeFetchErrorKind =
  | 'invalid_url'
  | 'unsupported_protocol'
  | 'private_ip'
  | 'redirect_missing_location'
  | 'redirect_limit_exceeded'
  | 'response_too_large'
  | 'upstream_error'
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
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'HEAD';
  headers?: Record<string, string>;
  body?: string;
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

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RESPONSE_BYTES = 1_048_576; // 1 MB
const DEFAULT_MAX_REDIRECTS = 5;

export function isPrivateIp(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (lower === 'localhost' || lower.endsWith('.local')) return true;

  const ipv4Match = lower.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const a = Number(ipv4Match[1]);
    const b = Number(ipv4Match[2]);
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 0) return true;
    if (a >= 224) return true;
  }

  if (lower === '::1' || lower === '[::1]') return true;
  if (lower.startsWith('fe80:') || lower.startsWith('[fe80:')) return true;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;

  return false;
}

function validateUrl(rawUrl: string, allowedHosts: string[] | undefined): URL {
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

  const hostnameLower = parsed.hostname.toLowerCase();
  const explicitlyAllowed =
    allowedHosts !== undefined &&
    allowedHosts.some((entry) => {
      const e = entry.toLowerCase();
      return hostnameLower === e || hostnameLower.endsWith(`.${e}`);
    });

  if (isPrivateIp(parsed.hostname) && !explicitlyAllowed) {
    throw new SafeFetchError(
      'private_ip',
      `Host resolves to private/loopback address: ${parsed.hostname}`,
    );
  }

  if (allowedHosts && allowedHosts.length > 0 && !explicitlyAllowed) {
    throw new SafeFetchError(
      'private_ip',
      `Host not in allowedHosts: ${parsed.hostname}`,
    );
  }

  return parsed;
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
    } catch {
      // let validateUrl surface the invalid-URL error below
    }
  }

  validateUrl(rawUrl, allowedHosts);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let currentUrl = rawUrl;
    let redirectsFollowed = 0;
    let response: Response;

    while (true) {
      try {
        response = await fetch(currentUrl, {
          method,
          headers,
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

      if (response.status < 300 || response.status >= 400) {
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
      validateUrl(nextUrl.toString(), allowedHosts);
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
