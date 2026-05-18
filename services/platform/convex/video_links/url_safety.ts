'use node';

import { promises as dns } from 'node:dns';

import { isPlaylistUrl, isSafeVideoUrl } from '../../lib/shared/video-url';
import { isPrivateIp } from '../lib/http/safe_fetch';

/**
 * Server-side SSRF guard for yt-dlp invocations.
 *
 * Pre-resolves the URL's hostname via Node DNS and checks EVERY returned
 * address against the shared `isPrivateIp` predicate. This closes the
 * DNS-rebinding gap that string-based hostname checks leave open: an
 * attacker domain `evil.com` that resolves to a public IP at submit time
 * but flips to `169.254.169.254` before yt-dlp resolves it would still be
 * caught here because we resolve BEFORE the subprocess runs, AND we walk
 * every A/AAAA record (not just the first).
 *
 * Called twice in the orchestrator:
 *   1. From `ingestVideoUrl` mutation at submit time (cheap pre-check).
 *   2. From `ingest_video_link.ts` action immediately before each
 *      `yt-dlp` invocation (closes the rebind window further; not
 *      perfect — see `--force-ipv4` + `--max-redirects` constraints in
 *      ytdlp.ts for the subprocess-layer defense).
 *
 * The frontend `isSafeVideoUrl` from `lib/shared/video-url.ts` runs the
 * advisory string-based checks for instant UX feedback. This server-side
 * check is the load-bearing one — frontend can be bypassed (request can
 * be forged), so duplicating the cheap checks here is intentional
 * defense in depth, not redundancy.
 */

export type UrlSafetyErrorKind =
  | 'invalid_url'
  | 'unsupported_protocol'
  | 'credentialed_url'
  | 'ip_literal'
  | 'playlist'
  | 'dns_resolution_failed'
  | 'private_ip_resolved';

export class UrlSafetyError extends Error {
  readonly kind: UrlSafetyErrorKind;

  constructor(kind: UrlSafetyErrorKind, message: string) {
    super(message);
    this.name = 'UrlSafetyError';
    this.kind = kind;
  }
}

export interface AssertSafeUrlOptions {
  /** Override resolver — only for testing. Production uses Node's default. */
  resolver?: (hostname: string) => Promise<{ address: string }[]>;
}

async function defaultResolver(
  hostname: string,
): Promise<{ address: string }[]> {
  // `all: true` returns every A + AAAA record. `verbatim: true` skips
  // OS-level ordering so we see the same set regardless of distro.
  return dns.lookup(hostname, { all: true, verbatim: true });
}

/**
 * Throw `UrlSafetyError` if `url` is unsafe to hand to yt-dlp.
 *
 * Layered checks (cheap → expensive):
 *  1. URL parse + protocol (https only)
 *  2. No credentials (user/pass in URL)
 *  3. No bare IP literal hostnames (decimal/hex/IPv6/dotted)
 *  4. Not a standalone playlist URL
 *  5. DNS resolve hostname → every IP through `isPrivateIp`
 */
export async function assertSafeUrl(
  url: string,
  opts: AssertSafeUrlOptions = {},
): Promise<void> {
  // Cheap string-level checks first
  if (!isSafeVideoUrl(url)) {
    let parsed: URL | null = null;
    try {
      parsed = new URL(url);
    } catch {
      throw new UrlSafetyError('invalid_url', `Invalid URL: ${url}`);
    }
    if (parsed.protocol !== 'https:') {
      throw new UrlSafetyError(
        'unsupported_protocol',
        `Only https:// URLs are accepted (got ${parsed.protocol})`,
      );
    }
    if (parsed.username || parsed.password) {
      throw new UrlSafetyError(
        'credentialed_url',
        'URLs with credentials are not accepted',
      );
    }
    throw new UrlSafetyError(
      'ip_literal',
      `Bare IP literal or localhost hostname not accepted: ${parsed.hostname}`,
    );
  }

  if (isPlaylistUrl(url)) {
    throw new UrlSafetyError(
      'playlist',
      'Standalone playlist URLs are not accepted — paste a single video link instead',
    );
  }

  // DNS resolve + check every A/AAAA record against the shared private-IP
  // predicate. This is the load-bearing defense — it closes the
  // string-only-check rebind gap.
  const { hostname } = new URL(url);
  const resolver = opts.resolver ?? defaultResolver;
  let resolved: { address: string }[];
  try {
    resolved = await resolver(hostname);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new UrlSafetyError(
      'dns_resolution_failed',
      `Could not resolve hostname: ${message}`,
    );
  }

  if (!resolved || resolved.length === 0) {
    throw new UrlSafetyError(
      'dns_resolution_failed',
      `Hostname ${hostname} resolved to zero addresses`,
    );
  }

  for (const { address } of resolved) {
    if (isPrivateIp(address)) {
      throw new UrlSafetyError(
        'private_ip_resolved',
        `Hostname ${hostname} resolves to a private/internal address`,
      );
    }
  }
}
