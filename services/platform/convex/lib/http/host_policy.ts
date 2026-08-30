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

import { AppError } from '../../../lib/shared/errors/app-error';
import { isPrivateIp } from './safe_fetch';

/**
 * Cloud metadata endpoints, including public-IP variants (Alibaba, Oracle)
 * that slip past the RFC1918 / link-local `isPrivateIp` check.
 */
const BLOCKED_METADATA_HOSTS = new Set<string>([
  '169.254.169.254', // AWS, GCP, Azure, DigitalOcean, Oracle (link-local)
  'fd00:ec2::254', // AWS IMDSv2 IPv6
  'metadata.google.internal', // GCP
  'metadata', // bare hostname; resolves under GKE/GCE search domains
  '100.100.100.200', // Alibaba ECS — public IP, not caught by isPrivateIp
  '192.0.0.192', // Oracle Cloud OCI v1 — public IP
  'metadata.tencentyun.com', // Tencent Cloud
]);

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
  if (
    isPrivateIp(host) &&
    process.env.TALE_ALLOW_PRIVATE_PROVIDER_HOSTS !== '1'
  ) {
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
