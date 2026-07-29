/**
 * The mediated execution host for LIVE connector calls.
 *
 * A connector's live body never holds a socket, a credential, or a file
 * handle — it holds the functions built here. Everything a body can reach is
 * policed on the way out:
 *
 *  - **The host allowlist runs on every request.** Under `endpointMode: fixed`
 *    the request host must EQUAL one of the connector's `allowedHosts`; under
 *    `per-credential` it must equal one or be a subdomain of one, matched on a
 *    dot boundary so `evil-atlassian.net` never passes for `atlassian.net`. A
 *    connector that declares no hosts reaches nothing — fail closed.
 *  - **Only https.** A body cannot downgrade the transport carrying an
 *    injected credential.
 *  - **Private, link-local, and cloud-metadata addresses are refused**, reusing
 *    the platform's audited outbound guard rather than a second copy of the
 *    same list. That guard checks the hostname STRING: a hostile DNS record
 *    that rebinds to private space between check and connect is out of its
 *    reach, which is why the allowlist above — not the IP check — is the
 *    primary control.
 *  - **The Authorization header belongs to the host.** The credentials domain
 *    resolves it; a body can neither read it nor override it, so a body cannot
 *    aim the org's token at a host of its choosing or swap in one of its own.
 *    `api-key` connectors get no header at all — their secret arrives through
 *    `ctx.secrets` and the body places it where the vendor expects.
 *
 * The wire call goes through `safeFetch`, the platform's audited outbound
 * client: it caps the body size, bounds the whole exchange with one timeout,
 * re-validates every redirect hop against the same allowlist, and strips
 * credential-bearing headers on cross-host hops. Because a redirect chain is
 * confined by that list but resolved inside the client, the FINAL url is
 * re-checked here under this connector's exact/suffix rule before its body is
 * handed to the connector.
 *
 * Non-2xx responses are DATA, not failures: bodies inspect `r.status`
 * themselves and compose their own vendor-specific error text, so only a
 * refusal or a request that never produced a response throws.
 */

import { checkProviderHostPolicy } from '../../convex/lib/http/host_policy';
import {
  safeFetch,
  safeFetchBinary,
  SafeFetchError,
} from '../../convex/lib/http/safe_fetch';
import type {
  ConnectorContext,
  ConnectorHostCapabilities,
  ConnectorHttpRequest,
  ConnectorHttpResponse,
} from '../engine/core/slots';
import type { Connector } from '../shared/schemas/connectors';
import { ConnectorError } from './errors';

/** Bounds one exchange end to end, redirects included. */
const DEFAULT_TIMEOUT_MS = 15_000;

/** API responses are documents; anything larger is a defect or an attack. */
const DEFAULT_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

/** Attachment bytes travel either as a base64 response or through
 * `files.download`, so they get their own, larger ceiling. */
const DEFAULT_MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;

/** The connector facts the host polices against — the whole connector
 * document is accepted, but only these three fields are consulted. */
export type LiveHostConnector = Pick<
  Connector,
  'name' | 'endpointMode' | 'allowedHosts'
>;

/** What `ctx.files` hands bytes to. Persisting blobs is the caller's
 * business (org-scoped object storage); the host only polices the fetch and
 * hands over the bytes. */
export interface ConnectorBlobSink {
  store(args: {
    data: string;
    encoding: 'base64' | 'utf-8';
    contentType: string;
    fileName: string;
  }): Promise<{
    id: string;
    fileName: string;
    contentType: string;
    size: number;
  }>;
}

export interface LiveHostOptions {
  connector: LiveHostConnector;
  /**
   * The credential's API origin for a `per-credential` connector. Checked
   * against the connector's allowlist here so a credential pointing at an
   * unrelated host is refused before any request is built.
   */
  endpoint?: string;
  /**
   * The Authorization header value the credentials domain resolved, applied
   * verbatim. Absent for `api-key` connectors.
   */
  authHeader?: string;
  /** The connector's non-secret per-credential settings, already defaulted
   * and type-coerced. Passed through to the body as `ctx.config`. */
  config?: Record<string, string | number | boolean>;
  /** Supplying a sink is what makes `ctx.files` exist at all. */
  blobs?: ConnectorBlobSink;
  /** Names the action in diagnostics — the host itself is per-invocation. */
  action?: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
  maxDownloadBytes?: number;
}

/** Lower-case, unbracketed, no trailing dot — `metadata.google.internal.` and
 * `[::1]` must not slip past a naive comparison. */
function normalizeHost(host: string): string {
  return host
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
}

/**
 * Whether one host satisfies one allowlist entry under the connector's
 * endpoint mode. `fixed` connectors hardcode their vendor URLs, so an exact
 * match is both sufficient and the tightest rule available. `per-credential`
 * connectors point at a customer instance under a vendor's domain, so a
 * subdomain is admitted — but only on a dot boundary, which is what keeps a
 * look-alike registration such as `evil-atlassian.net` out.
 */
export function hostMatchesAllowEntry(
  host: string,
  entry: string,
  endpointMode: Connector['endpointMode'],
): boolean {
  const h = normalizeHost(host);
  const e = normalizeHost(entry);
  if (h === e) return true;
  return endpointMode === 'per-credential' && h.endsWith(`.${e}`);
}

/**
 * Police one URL against a connector's policy and return it parsed. Exported
 * because every path that can reach the network — the http verbs, attachment
 * downloads, and any native backend that speaks HTTP — must run it.
 */
export function checkConnectorRequestUrl(
  rawUrl: string,
  connector: LiveHostConnector,
): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch (cause) {
    throw new ConnectorError(
      'INVALID_URL',
      `not a valid URL: ${rawUrl.slice(0, 200)}`,
      { connector: connector.name, cause },
    );
  }

  if (parsed.protocol !== 'https:') {
    throw new ConnectorError(
      'INSECURE_SCHEME',
      `connector requests are https only, got "${parsed.protocol}//" for ${parsed.host}`,
      {
        connector: connector.name,
        hint: 'use the https origin of the vendor API; plaintext would expose the injected credential',
      },
    );
  }

  // Metadata endpoints and private/loopback space, from the platform's one
  // audited outbound policy. It throws a ConvexError; re-raise it as this
  // layer's coded refusal so callers branch on one error type.
  try {
    checkProviderHostPolicy(parsed.toString());
  } catch (cause) {
    throw new ConnectorError(
      'BLOCKED_HOST',
      `host "${parsed.hostname}" is not reachable from an connector (private, link-local, or cloud-metadata address)`,
      { connector: connector.name, cause },
    );
  }

  const allowed = connector.allowedHosts;
  if (allowed.length === 0) {
    throw new ConnectorError(
      'HOST_NOT_ALLOWED',
      `connector "${connector.name}" declares no allowedHosts, so it cannot make HTTP requests`,
      {
        connector: connector.name,
        hint: "add the vendor host to the connector's allowedHosts, or implement the action as a native backend",
      },
    );
  }
  const ok = allowed.some((entry) =>
    hostMatchesAllowEntry(parsed.hostname, entry, connector.endpointMode),
  );
  if (!ok) {
    throw new ConnectorError(
      'HOST_NOT_ALLOWED',
      `host "${parsed.hostname}" is not allowed for connector "${connector.name}" (allowed: ${allowed.join(', ')})`,
      {
        connector: connector.name,
        hint:
          connector.endpointMode === 'per-credential'
            ? 'per-credential connectors admit an allowed host and its subdomains — check the credential endpoint'
            : 'fixed-endpoint connectors admit exactly the hosts they declare',
      },
    );
  }
  return parsed;
}

/** Headers as a plain lower-cased record — the shape a body may observe. */
function headerRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, name) => {
    out[name.toLowerCase()] = value;
  });
  return out;
}

/** One buffered response, exposing exactly the contract's four members. */
function toConnectorResponse(
  status: number,
  headers: Record<string, string>,
  text: string,
): ConnectorHttpResponse {
  let parsed: { value: unknown } | null = null;
  return {
    status,
    headers,
    text: () => text,
    json: () => {
      if (parsed) return parsed.value;
      try {
        const value: unknown = JSON.parse(text);
        parsed = { value };
        return value;
      } catch (cause) {
        throw new Error(
          `response body is not JSON (status ${status}, content-type ${headers['content-type'] ?? 'unknown'}): ${text.slice(0, 200)}`,
          { cause },
        );
      }
    },
  };
}

/** Translate the outbound client's failures into this layer's codes. A
 * failed exchange never becomes a fake response — a body must not mistake a
 * blocked request for a vendor error. */
function asConnectorError(
  error: unknown,
  connector: LiveHostConnector,
  action: string | undefined,
  url: URL,
): ConnectorError {
  const where = { connector: connector.name, action, cause: error };
  if (error instanceof SafeFetchError) {
    if (error.kind === 'response_too_large') {
      return new ConnectorError('RESPONSE_TOO_LARGE', error.message, {
        ...where,
        hint: 'ask the vendor API for a smaller page, or download the bytes through ctx.files',
      });
    }
    if (error.kind === 'private_ip' || error.kind === 'insecure_public_http') {
      return new ConnectorError(
        'BLOCKED_HOST',
        `${error.message} (redirect target refused)`,
        where,
      );
    }
    return new ConnectorError(
      'REQUEST_FAILED',
      `request to ${url.host} failed: ${error.message}`,
      where,
    );
  }
  return new ConnectorError(
    'REQUEST_FAILED',
    `request to ${url.host} failed: ${error instanceof Error ? error.message : String(error)}`,
    where,
  );
}

function base64Encode(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64');
}

function base64Decode(input: string): string {
  return Buffer.from(input, 'base64').toString('utf8');
}

/**
 * Build the capabilities one live invocation may reach. The engine adds the
 * parts only it knows — the resolved secrets and the retry-stable idempotency
 * key — to produce the full {@link ConnectorContext}.
 */
export function createLiveHost(
  options: LiveHostOptions,
): ConnectorHostCapabilities {
  const {
    connector,
    authHeader,
    blobs,
    action,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
    maxDownloadBytes = DEFAULT_MAX_DOWNLOAD_BYTES,
  } = options;

  // A per-credential endpoint is operator-supplied data: check it against the
  // connector's policy once here so a mis-pointed credential fails with one
  // clear message instead of once per request inside a body.
  let endpoint: string | undefined;
  if (options.endpoint !== undefined && options.endpoint !== '') {
    const checked = checkConnectorRequestUrl(options.endpoint, connector);
    endpoint = checked.origin;
  }

  /**
   * Merge the body's headers with the host's. The Authorization header is
   * host-owned: a body-supplied one is dropped (and noted) rather than merged,
   * so no body can substitute or strip the org's credential.
   */
  function buildHeaders(
    supplied: Record<string, string> | undefined,
  ): Record<string, string> {
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(supplied ?? {})) {
      if (name.toLowerCase() === 'authorization') {
        console.warn(
          `[connectors] ${connector.name}${action ? `.${action}` : ''}: connector body set its own Authorization header; the host-injected credential is used instead`,
        );
        continue;
      }
      headers[name] = value;
    }
    if (authHeader !== undefined && authHeader !== '') {
      headers.Authorization = authHeader;
    }
    return headers;
  }

  /** Every hop of a redirect chain is confined to the connector's allowlist
   * by the outbound client; the destination that actually answered is
   * re-checked under this connector's exact/suffix rule. */
  function checkFinalUrl(finalUrl: string): void {
    checkConnectorRequestUrl(finalUrl, connector);
  }

  async function request(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    req?: ConnectorHttpRequest,
  ): Promise<ConnectorHttpResponse> {
    const target = checkConnectorRequestUrl(url, connector);
    const headers = buildHeaders(req?.headers);
    const wantsBase64 = req?.responseType === 'base64';

    try {
      if (wantsBase64) {
        const response = await safeFetchBinary(target.toString(), {
          method,
          headers,
          body: req?.body,
          timeoutMs,
          maxResponseBytes: maxDownloadBytes,
          allowedHosts: [...connector.allowedHosts],
        });
        checkFinalUrl(response.finalUrl);
        const bytes = Buffer.from(await response.body.arrayBuffer());
        return toConnectorResponse(
          response.status,
          headerRecord(response.headers),
          bytes.toString('base64'),
        );
      }
      const response = await safeFetch(target.toString(), {
        method,
        headers,
        body: req?.body,
        timeoutMs,
        maxResponseBytes,
        allowedHosts: [...connector.allowedHosts],
      });
      checkFinalUrl(response.finalUrl);
      return toConnectorResponse(
        response.status,
        headerRecord(response.headers),
        response.body,
      );
    } catch (error) {
      // A refusal raised by the policy itself is already this layer's error
      // and keeps its precise code.
      if (error instanceof ConnectorError) throw error;
      throw asConnectorError(error, connector, action, target);
    }
  }

  const http: ConnectorContext['http'] = {
    get: (url, req) => request('GET', url, req),
    post: (url, req) => request('POST', url, req),
    put: (url, req) => request('PUT', url, req),
    patch: (url, req) => request('PATCH', url, req),
    delete: (url, req) => request('DELETE', url, req),
  };

  /** Present only when the caller supplied somewhere to put bytes; bodies
   * that need it check for its absence and say so. */
  const files: ConnectorContext['files'] | undefined = blobs
    ? {
        download: async (url, opts) => {
          const target = checkConnectorRequestUrl(url, connector);
          const headers = buildHeaders(opts.headers);
          let response;
          try {
            response = await safeFetchBinary(target.toString(), {
              method: 'GET',
              headers,
              timeoutMs,
              maxResponseBytes: maxDownloadBytes,
              allowedHosts: [...connector.allowedHosts],
            });
          } catch (error) {
            if (error instanceof ConnectorError) throw error;
            throw asConnectorError(error, connector, action, target);
          }
          checkFinalUrl(response.finalUrl);
          if (response.status < 200 || response.status >= 300) {
            throw new ConnectorError(
              'REQUEST_FAILED',
              `download of ${opts.fileName} failed (${response.status}) from ${target.host}`,
              { connector: connector.name, action },
            );
          }
          const bytes = Buffer.from(await response.body.arrayBuffer());
          return blobs.store({
            data: bytes.toString('base64'),
            encoding: 'base64',
            contentType: response.body.type || 'application/octet-stream',
            fileName: opts.fileName,
          });
        },
        store: (data, opts) =>
          blobs.store({
            data,
            encoding: opts.encoding,
            contentType: opts.contentType,
            fileName: opts.fileName,
          }),
      }
    : undefined;

  return {
    ...(endpoint !== undefined && { endpoint }),
    config: options.config ?? {},
    http,
    ...(files !== undefined && { files }),
    base64Encode,
    base64Decode,
  };
}
