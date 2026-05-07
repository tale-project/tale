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

let cached: RagConfig | null = null;

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
 * Get the validated RAG configuration. Lazily computed on first call and
 * cached for the lifetime of the process. Fully sync — works in both V8
 * and Node Convex runtimes.
 *
 * Throws on:
 *   - missing / malformed `RAG_URL`
 *   - non-http(s) scheme
 *   - literal-IP host inside an SSRF-blocked CIDR (link-local / IMDS / 0.0.0.0/8)
 *   - hostname matching a known cloud-metadata endpoint
 *
 * Auth is presence-based: when `RAG_AUTH_TOKEN` is set, every request to
 * RAG carries `Authorization: Bearer ${token}`; when unset, no header is
 * sent and RAG runs open. Logs a SECURITY warning (once) when unset.
 */
export function getRagConfig(): RagConfig {
  if (cached) return cached;

  const serviceUrl = process.env.RAG_URL || DEFAULT_SERVICE_URL;
  const authToken = process.env.RAG_AUTH_TOKEN || undefined;

  validateRagUrl(serviceUrl);

  if (authToken === undefined) {
    console.warn(
      '[SECURITY] RAG_AUTH_TOKEN unset — requests to the RAG service will ' +
        'be unauthenticated. Set RAG_AUTH_TOKEN to a shared secret on both ' +
        'the platform and RAG containers (values must match) to enable ' +
        'Bearer auth.',
    );
  }

  cached = { serviceUrl, authToken };
  return cached;
}

/** Test-only — clear the cached config so the next `getRagConfig()` re-runs validation. */
export function _resetRagConfigForTests(): void {
  cached = null;
}

/**
 * Fetch against the RAG service. Sets `Authorization: Bearer ${authToken}`
 * when `RAG_AUTH_TOKEN` is configured; otherwise sends no Authorization
 * header (RAG runs open). Applies a default per-request timeout and
 * accepts a path starting with `/`.
 *
 * Works in both V8 and Node Convex runtimes (uses the global `fetch`).
 *
 * @example
 *   const res = await ragFetch('/api/v1/documents/abc', { method: 'DELETE' });
 *   if (res.status === 404 || res.ok) { ...treat as success... }
 */
export async function ragFetch(
  path: string,
  init: RequestInit & { timeoutMs?: number } = {},
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

  const timeoutMs = init.timeoutMs ?? 10_000;
  const signal = init.signal ?? AbortSignal.timeout(timeoutMs);

  const { timeoutMs: _drop, ...rest } = init;
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
