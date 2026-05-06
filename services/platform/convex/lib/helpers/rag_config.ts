import ipaddr from 'ipaddr.js';

export interface RagConfig {
  /** Full RAG base URL (e.g., `http://rag:8001`). */
  serviceUrl: string;
  /** Bearer token sent on every request to RAG. */
  internalToken: string;
}

const DEFAULT_INTERNAL_TOKEN = 'tale-rag-dev-only';
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
  const lowerHost = rawHost.toLowerCase();

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
 *   - default token in use AND `TALE_REQUIRE_CUSTOM_RAG_TOKEN=true`
 *
 * Logs a SECURITY warning (once) when the default `tale-rag-dev-only` token
 * is in use without the require flag.
 */
export function getRagConfig(): RagConfig {
  if (cached) return cached;

  const serviceUrl = process.env.RAG_URL || DEFAULT_SERVICE_URL;
  const internalToken =
    process.env.RAG_INTERNAL_TOKEN || DEFAULT_INTERNAL_TOKEN;

  validateRagUrl(serviceUrl);

  if (internalToken === DEFAULT_INTERNAL_TOKEN) {
    if (process.env.TALE_REQUIRE_CUSTOM_RAG_TOKEN === 'true') {
      throw new Error(
        '[SECURITY] TALE_REQUIRE_CUSTOM_RAG_TOKEN=true but RAG_INTERNAL_TOKEN ' +
          'is still the default (tale-rag-dev-only). Set RAG_INTERNAL_TOKEN to ' +
          'a unique secret on both the platform and RAG containers.',
      );
    }
    console.warn(
      '[SECURITY] Using default RAG_INTERNAL_TOKEN (tale-rag-dev-only). ' +
        'Override RAG_INTERNAL_TOKEN to a unique secret before exposing the ' +
        'RAG port to untrusted networks. Set TALE_REQUIRE_CUSTOM_RAG_TOKEN=true ' +
        'to refuse to start with the default.',
    );
  }

  cached = { serviceUrl, internalToken };
  return cached;
}

/** Test-only — clear the cached config so the next `getRagConfig()` re-runs validation. */
export function _resetRagConfigForTests(): void {
  cached = null;
}

/**
 * Authenticated fetch against the RAG service. Always sets
 * `Authorization: Bearer ${internalToken}`, applies a default per-request
 * timeout, and accepts a path or a full URL.
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
  const { serviceUrl, internalToken } = getRagConfig();
  const url = path.startsWith('http')
    ? path
    : `${serviceUrl.replace(/\/$/, '')}${path.startsWith('/') ? '' : '/'}${path}`;

  const headers = new Headers(init.headers);
  if (!headers.has('authorization')) {
    headers.set('authorization', `Bearer ${internalToken}`);
  }

  const timeoutMs = init.timeoutMs ?? 10_000;
  const signal = init.signal ?? AbortSignal.timeout(timeoutMs);

  const { timeoutMs: _drop, ...rest } = init;
  return fetch(url, { ...rest, headers, signal });
}

export const _internal = {
  DEFAULT_INTERNAL_TOKEN,
  DEFAULT_SERVICE_URL,
  SSRF_BLOCKED_CIDRS,
  SSRF_BLOCKED_CIDRS_V6,
  SSRF_BLOCKED_HOSTNAMES,
  validateRagUrl,
  ipInAnyCidr,
};
