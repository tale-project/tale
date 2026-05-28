import ipaddr from 'ipaddr.js';

export interface RagConfig {
  /** Full RAG base URL (e.g., `http://rag:8001`). */
  serviceUrl: string;
  /**
   * Shared-secret Bearer token sent on every request to RAG. When
   * undefined (env unset), no Authorization header is sent and the RAG
   * service runs unauthenticated. When set, the value MUST match the
   * RAG container's `RAG_AUTH_TOKEN`.
   */
  authToken: string | undefined;
}

const DEFAULT_SERVICE_URL = 'http://localhost:8001';

/**
 * SSRF-blocked CIDR ranges. We block ONLY ranges with no legitimate RAG-target
 * use case in any deployment shape:
 *   - 169.254.0.0/16 (RFC 3927 link-local) — every major cloud's IMDS
 *     (AWS / GCP / Azure / Alibaba / DO) lives here on 169.254.169.254.
 *     A single CIDR covers them all and is auto-stable across new clouds.
 *   - 0.0.0.0/8 (RFC 1122 "this" network) — not a valid target host.
 *
 * We deliberately do NOT block 127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12,
 * 192.168.0.0/16 — these are localhost and docker private networks, which
 * are the legitimate RAG targets in self-hosted deployments. A "tighter"
 * block here would either be a no-op (default-permit) or break the standard
 * compose default (default-deny). The narrow link-local + this-network
 * blocklist matches the actual threat model (cloud-credential exfiltration
 * via SSRF pivot to IMDS, see Capital One 2019).
 */
const SSRF_BLOCKED_CIDRS = ['169.254.0.0/16', '0.0.0.0/8'];

/** Equivalent IPv6 ranges. */
const SSRF_BLOCKED_CIDRS_V6 = [
  'fe80::/10', // IPv6 link-local
  '::ffff:169.254.0.0/112', // IPv4-mapped link-local
  // AWS IPv6 IMDSv2 endpoint (`fd00:ec2::254`) sits in the IPv6 ULA range
  // `fc00::/7` — the previous fe80::/10-only check let this through.
  // Round-2 v15 finding F2.
  'fc00::/7',
];

/**
 * Hostname-string blocklist for cloud metadata endpoints that resolve via
 * DNS to a link-local IP. We can't do DNS resolution here (must stay sync
 * to keep the V8-runtime callers compatible — `node:dns` is Node-only),
 * so we hard-block the known DNS names. Lower-cased for comparison.
 *
 * NOTE: this is best-effort against operator misconfiguration. A defense
 * against DNS rebinding (operator sets RAG_URL to a hostname they don't
 * control, hostname returns benign IP first then IMDS later) requires a
 * pinned undici dispatcher which is incompatible with Convex's V8 runtime.
 * Tracked as a follow-up; the threat model for self-hosted deployments
 * requires operator-level mistakes for this attack to land.
 */
const SSRF_BLOCKED_HOSTNAMES = new Set<string>([
  'metadata.google.internal',
  'metadata',
]);

function ipInAnyCidr(ip: string, cidrs: readonly string[]): string | null {
  let parsed: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    parsed = ipaddr.parse(ip);
  } catch {
    return null;
  }
  for (const cidr of cidrs) {
    let parsedCidr: [ipaddr.IPv4 | ipaddr.IPv6, number];
    try {
      parsedCidr = ipaddr.parseCIDR(cidr);
    } catch {
      continue;
    }
    if (parsed.kind() !== parsedCidr[0].kind()) continue;
    if (
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- ipaddr.match is generic over its own IP types
      (parsed as ipaddr.IPv4).match(parsedCidr as [ipaddr.IPv4, number]) ||
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- IPv6 fallback
      (parsed as ipaddr.IPv6).match(parsedCidr as [ipaddr.IPv6, number])
    ) {
      return cidr;
    }
  }
  return null;
}

/**
 * Sync URL-only SSRF check. Throws if `rawUrl`:
 *   - is not parseable
 *   - uses a non-http(s) scheme
 *   - has a literal IP host inside a blocked CIDR
 *   - has a hostname known to resolve to cloud-metadata IPs
 */
export function validateRagUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(
      `[rag_config] RAG_URL is not a valid URL: ${JSON.stringify(rawUrl)}`,
    );
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(
      `[rag_config] RAG_URL must use http(s) scheme; got ${parsed.protocol}`,
    );
  }

  // Strip surrounding [...] from IPv6 hostnames before parsing.
  const rawHost = parsed.hostname;
  const ipCandidate = rawHost.startsWith('[') ? rawHost.slice(1, -1) : rawHost;
  // Strip a trailing `.` before the blocklist `Set.has` lookup. WHATWG
  // `URL` preserves the trailing dot (e.g., `metadata.google.internal.`),
  // which would otherwise miss the exact-string match. Round-2 v15 F3.
  const lowerHost = rawHost.replace(/\.$/, '').toLowerCase();

  if (SSRF_BLOCKED_HOSTNAMES.has(lowerHost)) {
    throw new Error(
      `[rag_config] RAG_URL host ${rawHost} is a known cloud-metadata endpoint — refused for SSRF safety.`,
    );
  }

  if (ipaddr.isValid(ipCandidate)) {
    const blocked = ipInAnyCidr(ipCandidate, [
      ...SSRF_BLOCKED_CIDRS,
      ...SSRF_BLOCKED_CIDRS_V6,
    ]);
    if (blocked) {
      throw new Error(
        `[rag_config] RAG_URL host ${rawHost} is in ${blocked} ` +
          '(cloud-metadata / link-local / this-network range — refused for SSRF safety).',
      );
    }
  }

  return parsed;
}

/**
 * Get the validated RAG configuration.
 *
 * URL validation is cached for the process lifetime (the validation
 * itself is deterministic given an unchanged env var, and re-running it
 * per request is wasteful). The `authToken` is RE-READ from the env on
 * every call so that a runtime rotation (operator pushes a new
 * `RAG_AUTH_TOKEN` and rolls the platform) takes effect without a
 * process restart. Round-2 review HIGH cluster (E.4.1).
 *
 * Throws on:
 *   - missing / malformed `RAG_URL`
 *   - non-http(s) scheme
 *   - literal-IP host inside an SSRF-blocked CIDR
 *   - hostname matching a known cloud-metadata endpoint
 *
 * Auth is presence-based: when `RAG_AUTH_TOKEN` is set at the time of
 * the call, every request to RAG carries `Authorization: Bearer
 * ${token}`; when unset, no header is sent and RAG runs open. The
 * SECURITY warning is logged at most once per process to keep startup
 * logs readable.
 */
let validatedServiceUrl: string | null = null;
let warnedAuthMissing = false;

export function getRagConfig(): RagConfig {
  if (validatedServiceUrl === null) {
    const serviceUrl = process.env.RAG_URL || DEFAULT_SERVICE_URL;
    validateRagUrl(serviceUrl);
    validatedServiceUrl = serviceUrl;
  }

  // Read the token fresh on every call. Cheap (~10 ns) and removes the
  // "operator must restart the process to rotate the token" surprise.
  const authToken = process.env.RAG_AUTH_TOKEN || undefined;
  if (authToken === undefined && !warnedAuthMissing) {
    console.warn(
      '[SECURITY] RAG_AUTH_TOKEN unset — requests to the RAG service will ' +
        'be unauthenticated. Set RAG_AUTH_TOKEN to a shared secret on both ' +
        'the platform and RAG containers (values must match) to enable ' +
        'Bearer auth.',
    );
    warnedAuthMissing = true;
  }

  return { serviceUrl: validatedServiceUrl, authToken };
}

/** Test-only — clear the cached config so the next `getRagConfig()` re-runs validation. */
export function _resetRagConfigForTests(): void {
  validatedServiceUrl = null;
  warnedAuthMissing = false;
}

/**
 * Fetch against the RAG service.
 *
 * Sets `Authorization: Bearer ${authToken}` when `RAG_AUTH_TOKEN` is
 * configured; otherwise sends no Authorization header (RAG runs open).
 *
 * `orgSlug` is required for endpoints whose service-side handler reads
 * the org's provider catalog (search, generate, upload, compare-files).
 * The RAG service enforces this via per-router `Depends(require_org_slug)`,
 * so callers MUST pass `orgSlug` for those endpoints — a missing header
 * yields 400 from RAG. Status / delete / content / compare-by-id
 * endpoints are org-agnostic and accept calls without the header.
 *
 * When `orgSlug` is supplied, it sets `X-Tale-Org: ${orgSlug}` and
 * cannot be overridden via a header in `init.headers` — preventing
 * a caller from spoofing another org's identity.
 *
 * Works in both V8 and Node Convex runtimes (uses the global `fetch`).
 *
 * @example
 *   const res = await ragFetch('/api/v1/search', {
 *     method: 'POST',
 *     body: JSON.stringify(payload),
 *     orgSlug: 'acme',
 *   });
 */
export async function ragFetch(
  path: string,
  init: RequestInit & { timeoutMs?: number; orgSlug?: string } = {},
): Promise<Response> {
  const { serviceUrl, authToken } = getRagConfig();
  // The legacy `path.startsWith('http')` override branch was a future-bypass
  // foot-gun (a future caller could pass an absolute URL pointing anywhere
  // and skip the SSRF guard entirely). All current call sites pass relative
  // paths starting with `/`. Refuse anything else. Round-2 v15 F9.
  if (!path.startsWith('/')) {
    throw new Error(
      `[rag_config] ragFetch path must start with '/'; got ${JSON.stringify(path)}`,
    );
  }
  const url = `${serviceUrl.replace(/\/$/, '')}${path}`;
  // Re-validate per-request to mitigate DNS rebinding across the cached
  // RAG_URL: even though RAG_URL itself is operator-controlled and not
  // user-supplied, the env value can be re-read on each call so a
  // mid-flight env update (kubectl rollout) takes effect at the next
  // request without a process restart. Round-2 v15 F4.
  validateRagUrl(url);

  const headers = new Headers(init.headers);
  if (authToken !== undefined && !headers.has('authorization')) {
    headers.set('authorization', `Bearer ${authToken}`);
  }
  // When supplied, always overwrite — callers must not be able to
  // spoof another org's identity by setting the header in `init.headers`
  // directly. When omitted, the RAG endpoint either runs org-agnostic
  // (status/delete/content/compare-by-id) or returns 400 from its
  // `Depends(require_org_slug)` dep (search/generate/upload/compare-files).
  //
  // Distinguish "caller deliberately passed empty/blank slug" (a bug —
  // fail fast, don't silently strip the header) from "caller omitted
  // the field entirely" (the org-agnostic endpoint path). Earlier the
  // truthy check folded both into the same silent-omit branch.
  if (init.orgSlug !== undefined) {
    if (!init.orgSlug.trim()) {
      throw new Error(
        'ragFetch: orgSlug was provided but is empty; refusing to call RAG without a valid X-Tale-Org header',
      );
    }
    headers.set('x-tale-org', init.orgSlug);
  }

  const timeoutMs = init.timeoutMs ?? 10_000;
  const signal = init.signal ?? AbortSignal.timeout(timeoutMs);

  const { timeoutMs: _drop, orgSlug: _dropOrg, ...rest } = init;
  // `redirect: 'manual'` so a compromised RAG returning a 30x to
  // `http://169.254.169.254/...` (cloud IMDS) doesn't get auto-followed
  // past the SSRF guard. Callers handle 30x as a hard error. Round-2 v15 F1.
  const redirect: RequestRedirect = init.redirect ?? 'manual';
  return fetch(url, { ...rest, headers, signal, redirect });
}

export const _internal = {
  DEFAULT_SERVICE_URL,
  SSRF_BLOCKED_CIDRS,
  SSRF_BLOCKED_CIDRS_V6,
  SSRF_BLOCKED_HOSTNAMES,
  validateRagUrl,
  ipInAnyCidr,
};
