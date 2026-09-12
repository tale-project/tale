import { isMetadataAddress, isPrivateIp } from '../shared/net/private-ip';
import { BLOCKED_METADATA_HOSTS } from './host-policy';
import { resolveHostAddresses } from './safe-fetch';

/**
 * The crawl-target policy: which hosts a website registration may name and
 * the crawler may fetch. A registered domain is a server-side fetch target
 * the platform will dial on the caller's word — from inside the operator's
 * network — so loopback, link-local (the cloud metadata address included),
 * RFC 1918, CGNAT, ULA and the private-network suffixes are refused at the
 * boundary, and refused again at fetch time so a legacy row cannot launder
 * one in. `safeFetch` alone does not close this: the crawler names the
 * site's own hosts as `allowedHosts`, which is exactly the switch that
 * suspends its private-range refusal.
 *
 * Operators crawling an intranet opt in with
 * `TALE_ALLOW_PRIVATE_CRAWL_HOSTS=1` (the crawler twin of
 * `TALE_ALLOW_PRIVATE_PROVIDER_HOSTS`); the cloud metadata endpoints stay
 * refused whatever the knob says. Hostname-string policy only — DNS
 * rebinding is not pinned here, as everywhere else in this layer.
 */

const ALLOW_PRIVATE_CRAWL_HOSTS_ENV = 'TALE_ALLOW_PRIVATE_CRAWL_HOSTS';

/** Whether the operator admitted intranet crawl targets — the knob that
 * lifts the private-network refusals by name at registration and by
 * resolved address at fetch time; the metadata endpoints stay refused. */
export function privateCrawlHostsAllowed(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env[ALLOW_PRIVATE_CRAWL_HOSTS_ENV] === '1';
}

/** Suffixes that name a private network by convention, never the internet. */
const PRIVATE_SUFFIXES = [
  '.internal',
  '.localhost',
  '.localdomain',
  '.home.arpa',
  '.intranet',
  '.corp',
  '.lan',
];

/** 100.64.0.0/10 — carrier-grade NAT, which `isPrivateIp` leaves out. */
function isCgnat(host: string): boolean {
  const match = /^100\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(host);
  if (match === null) return false;
  const second = Number(match[1]);
  return second >= 64 && second <= 127;
}

function isIpLiteral(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
}

/** The comparable form of a hostname: lowercase, no IPv6 brackets, no
 * trailing dot (`metadata.google.internal.` resolves the same). */
function normalizeCrawlHost(hostname: string): string {
  return hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
}

/**
 * Why `hostname` may not be a crawl target, or null when it may. The env
 * knob lifts the private-network refusals only; the metadata endpoints are
 * refused regardless.
 */
export function crawlHostRefusal(
  hostname: string,
  options: { allowPrivate?: boolean } = {},
): string | null {
  const host = normalizeCrawlHost(hostname);
  if (host === '') return 'the domain names no host';
  if (BLOCKED_METADATA_HOSTS.has(host)) {
    return `"${host}" is a cloud metadata endpoint`;
  }
  const allowPrivate = options.allowPrivate ?? privateCrawlHostsAllowed();
  if (allowPrivate) return null;
  if (isPrivateIp(host) || isCgnat(host)) {
    return `"${host}" is a loopback, link-local or private-network address`;
  }
  if (host === 'localhost' || PRIVATE_SUFFIXES.some((s) => host.endsWith(s))) {
    return `"${host}" names a private network, not a public site`;
  }
  if (!isIpLiteral(host) && !host.includes('.')) {
    return `"${host}" is a single-label name that only resolves on a private network`;
  }
  return null;
}

/**
 * Why `hostname`, RESOLVED, may not be a crawl target, or null when it
 * may — the registration-time twin of the crawler's dial-time check: a
 * public-looking name whose DNS answer includes a loopback, private or
 * cloud-metadata address is refused before a row exists, so a client
 * learns at the door rather than from an empty scan. A name that does not
 * resolve at all passes (the scan will report that on its own); the
 * dial-time guard in `safeFetch` remains the control against a record
 * that changes after registration.
 */
export async function crawlTargetResolutionRefusal(
  hostname: string,
  options: { allowPrivate?: boolean } = {},
): Promise<string | null> {
  const host = normalizeCrawlHost(hostname);
  if (isIpLiteral(host)) return null;
  let addresses: readonly { address: string }[];
  try {
    addresses = await resolveHostAddresses(host);
  } catch (error) {
    console.warn(
      `[crawl] ${host} did not resolve at registration:`,
      error instanceof Error ? error.message : error,
    );
    return null;
  }
  const allowPrivate = options.allowPrivate ?? privateCrawlHostsAllowed();
  for (const { address } of addresses) {
    if (isMetadataAddress(address)) {
      return `"${host}" resolves to the cloud metadata address ${address}`;
    }
    if (!allowPrivate && (isPrivateIp(address) || isCgnat(address))) {
      return `"${host}" resolves to the loopback, link-local or private-network address ${address}`;
    }
  }
  return null;
}

/** Why a crawl target was refused — the code the doors put on the wire. */
export class CrawlTargetError extends Error {
  readonly code: 'WEBSITE_DOMAIN_INVALID' | 'WEBSITE_DOMAIN_NOT_CRAWLABLE';

  constructor(
    code: 'WEBSITE_DOMAIN_INVALID' | 'WEBSITE_DOMAIN_NOT_CRAWLABLE',
    message: string,
  ) {
    super(message);
    this.name = 'CrawlTargetError';
    this.code = code;
  }
}

/** A scheme prefix that is not a `host:port` pair (`localhost:3000`). */
const SCHEME_PREFIX = /^([a-z][a-z0-9+.-]*):(?!\d+(?:[/?#]|$))/i;

/**
 * The hostname a crawl target names — an http(s) URL or a bare domain,
 * read through `new URL()` so `www.`, ports and paths normalize the same
 * way on every write door — checked against the policy. Throws
 * `CrawlTargetError`: `WEBSITE_DOMAIN_INVALID` for a value that names no
 * http(s) host at all (`file:///etc/passwd`, `https://`, `a b`),
 * `WEBSITE_DOMAIN_NOT_CRAWLABLE` for a host the policy refuses.
 */
export function parseCrawlTarget(
  input: string,
  options: { allowPrivate?: boolean } = {},
): string {
  const raw = input.trim();
  const scheme = SCHEME_PREFIX.exec(raw)?.[1]?.toLowerCase();
  if (scheme !== undefined && scheme !== 'http' && scheme !== 'https') {
    throw new CrawlTargetError(
      'WEBSITE_DOMAIN_INVALID',
      `Only http and https targets can be crawled, not "${scheme}:"`,
    );
  }
  let hostname: string;
  try {
    hostname = new URL(scheme === undefined ? `https://${raw}` : raw).hostname;
  } catch {
    throw new CrawlTargetError(
      'WEBSITE_DOMAIN_INVALID',
      'The domain is not a hostname or an http(s) URL',
    );
  }
  // RFC 1035: a host name is at most 253 characters on the wire.
  if (hostname === '' || hostname.length > 253 || raw.length > 2048) {
    throw new CrawlTargetError(
      'WEBSITE_DOMAIN_INVALID',
      'The domain is not a hostname or an http(s) URL',
    );
  }
  const refusal = crawlHostRefusal(hostname, options);
  if (refusal !== null) {
    throw new CrawlTargetError('WEBSITE_DOMAIN_NOT_CRAWLABLE', refusal);
  }
  return hostname;
}
