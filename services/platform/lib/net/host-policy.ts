/**
 * Outbound-host policy for operator-supplied service URLs (AI provider base
 * URLs, BYO object-storage endpoints, deployment data stores). Rejects a URL
 * at the policy layer BEFORE any request is issued. Two gates:
 *
 *  1. Cloud metadata services (AWS/GCP/Azure/Alibaba/Oracle/Tencent IMDS —
 *     link-local AND public-IP variants) are always blocked.
 *  2. Other private/loopback hosts (RFC1918, 127.0.0.0/8, localhost,
 *     link-local, ULA) are blocked by default; operators running self-hosted
 *     backends (e.g. Ollama on localhost) opt in with
 *     `TALE_ALLOW_PRIVATE_PROVIDER_HOSTS=1` in the platform process env.
 *
 * Validates the hostname string only — DNS-rebinding via short-TTL toggling
 * is NOT mitigated here (resolution happens again inside fetch). Acceptable
 * because only developer-settings-scoped users author these URLs and this is
 * one of several layers (blocklist, RFC1918 reject, `redirect: 'manual'` in
 * `safeFetch`). Pinning against rebinding would need an undici Dispatcher
 * with a `lookup` callback.
 */

import { AppError } from '../shared/errors/app-error';
import { isPrivateIp, METADATA_ADDRESSES } from '../shared/net/private-ip';

/**
 * Cloud metadata endpoints by name and by address: the addresses every
 * outbound lane refuses (`lib/shared/net/private-ip.ts`) plus the names
 * that resolve to them under a cloud's search domains.
 */
export const BLOCKED_METADATA_HOSTS = new Set<string>([
  ...METADATA_ADDRESSES,
  'metadata.google.internal', // GCP
  'metadata', // bare hostname; resolves under GKE/GCE search domains
  'metadata.tencentyun.com', // Tencent Cloud
]);

/** Whether the operator admitted self-hosted providers on private
 * networks (`TALE_ALLOW_PRIVATE_PROVIDER_HOSTS=1`) — the same knob gates
 * a provider URL at configuration time and the address it resolves to at
 * request time. */
export function privateProviderHostsAllowed(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.TALE_ALLOW_PRIVATE_PROVIDER_HOSTS === '1';
}

/** Parse + police an operator-supplied URL; returns the parsed URL. */
export function checkProviderHostPolicy(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new AppError({
      code: 'INVALID_URL',
      message: `Invalid URL: ${rawUrl}`,
    });
  }
  // Normalize: lowercase, strip IPv6 brackets, strip trailing dot. A
  // trailing-dot hostname like `metadata.google.internal.` resolves the same
  // DNS-wise but would bypass a naive Set lookup.
  const host = parsed.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
  if (BLOCKED_METADATA_HOSTS.has(host)) {
    throw new AppError({
      code: 'BLOCKED_HOST',
      message: `Host "${host}" is blocked (cloud metadata endpoint).`,
    });
  }
  if (isPrivateIp(host) && !privateProviderHostsAllowed()) {
    throw new AppError({
      code: 'PRIVATE_HOST_BLOCKED',
      message:
        `Host "${host}" is a private/loopback address and is blocked. ` +
        'Set TALE_ALLOW_PRIVATE_PROVIDER_HOSTS=1 in the platform process env to ' +
        'enable self-hosted backends like Ollama on localhost.',
    });
  }
  return parsed;
}
