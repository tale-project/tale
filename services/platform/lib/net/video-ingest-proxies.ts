/**
 * Video ingestion's own proxies: `VIDEO_INGEST_PROXY_URLS`, which the yt-dlp
 * runner takes in place of the deployment's outbound proxies
 * (`OUTBOUND_PROXY_URLS`) and nothing else reads — so addresses a video
 * platform accepts, often billed per address or per gigabyte, carry video
 * alone and never the crawler, the web fetch, email images or sandbox
 * sessions.
 *
 * Comma- or whitespace-separated, as the outbound list is
 * (`splitOutboundProxyList`), each `scheme://[user:password@]host[:port]` in
 * any scheme yt-dlp speaks. The list keeps its own turn and its own memory of
 * the proxies it passes over (`./proxy-rotation`), apart from the outbound
 * rotation's. A malformed entry fails boot (`backend/env.ts`), and so does
 * setting the list next to `VIDEO_INGEST_PROXY_URL`, the single proxy of its
 * own video ingestion takes otherwise, which keeps ignoring an invalid value
 * with a warning.
 */

import { splitOutboundProxyList } from '@tale/shared/net/outbound-proxies';

import { ProxyRotation, type RotatedProxy } from './proxy-rotation';

const VIDEO_INGEST_PROXY_URLS_ENV = 'VIDEO_INGEST_PROXY_URLS';
const VIDEO_INGEST_PROXY_URL_ENV = 'VIDEO_INGEST_PROXY_URL';

/** Proxy schemes yt-dlp understands (`utils/networking.py`), and the port
 * each one's proxy listens on when an entry names none. */
const PROXY_SCHEME_PORTS: ReadonlyMap<string, number> = new Map([
  ['http:', 80],
  ['https:', 443],
  ['socks4:', 1080],
  ['socks4a:', 1080],
  ['socks5:', 1080],
  ['socks5h:', 1080],
]);

/** Whether yt-dlp can take a proxy URL with `protocol` (`socks5h:`). */
export function isVideoProxyScheme(protocol: string): boolean {
  return PROXY_SCHEME_PORTS.has(protocol);
}

/** The form an entry takes, quoted in every refusal. */
const ENTRY_FORM =
  'scheme://[user:password@]host[:port], the scheme one of http, https, socks4, socks4a, socks5, socks5h';

/** Thrown for a malformed entry, or for both variables set; the message names
 * an entry by its position, never its text, which may carry a password. */
export class VideoIngestProxyConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VideoIngestProxyConfigError';
  }
}

/** One of video ingestion's proxies. */
export type VideoIngestProxy = RotatedProxy;

function refuse(position: number, reason: string): never {
  throw new VideoIngestProxyConfigError(
    `${VIDEO_INGEST_PROXY_URLS_ENV} entry ${position} ${reason} (expected ${ENTRY_FORM})`,
  );
}

/**
 * One entry of the list, checked. `position` is its 1-based place, which
 * the refusal names. yt-dlp is given the entry as written. Throws
 * {@link VideoIngestProxyConfigError}.
 */
function parseVideoIngestProxyUrl(
  entry: string,
  position: number,
): VideoIngestProxy {
  let url: URL;
  try {
    url = new URL(entry);
  } catch {
    refuse(position, 'is not a URL');
  }
  // Not the scheme itself: an entry without one reads its user name there.
  const defaultPort = PROXY_SCHEME_PORTS.get(url.protocol);
  if (defaultPort === undefined) {
    refuse(position, 'has a scheme yt-dlp cannot take a proxy in');
  }
  if (url.hostname === '') refuse(position, 'names no host');
  if (url.port === '0') refuse(position, 'names port 0');
  if (
    (url.pathname !== '' && url.pathname !== '/') ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    refuse(position, 'has a path, query or fragment after the host');
  }
  return {
    url: entry,
    label: `${url.protocol}//${url.hostname}:${url.port || defaultPort}`,
  };
}

/**
 * The configured proxies, in the order written; empty when the value is
 * unset or blank. Throws {@link VideoIngestProxyConfigError} on the first
 * malformed entry. A proxy listed twice is asked twice as often.
 */
export function parseVideoIngestProxyUrls(
  raw: string | null | undefined,
): VideoIngestProxy[] {
  return splitOutboundProxyList(raw).map((entry, index) =>
    parseVideoIngestProxyUrl(entry, index + 1),
  );
}

/** Refuses `VIDEO_INGEST_PROXY_URLS` listing a proxy next to a set
 * `VIDEO_INGEST_PROXY_URL`: which of them video ingestion would take is not
 * the operator's to guess. Throws {@link VideoIngestProxyConfigError}. */
export function checkVideoIngestProxySettings(env: {
  [VIDEO_INGEST_PROXY_URL_ENV]?: string;
  [VIDEO_INGEST_PROXY_URLS_ENV]?: string;
}): void {
  if (
    env[VIDEO_INGEST_PROXY_URL_ENV]?.trim() &&
    splitOutboundProxyList(env[VIDEO_INGEST_PROXY_URLS_ENV]).length > 0
  ) {
    throw new VideoIngestProxyConfigError(
      `${VIDEO_INGEST_PROXY_URL_ENV} and ${VIDEO_INGEST_PROXY_URLS_ENV} are both set; set one (${VIDEO_INGEST_PROXY_URLS_ENV} can list that proxy with the others)`,
    );
  }
}

/** Video ingestion's own rotation: its turn and the proxies it passes over. */
export const videoIngestProxyRotation = new ProxyRotation<VideoIngestProxy>(
  VIDEO_INGEST_PROXY_URLS_ENV,
  parseVideoIngestProxyUrls,
  'video-proxy',
);

/** Test seam: forget the video rotation's position and set-aside proxies. */
export function resetVideoIngestProxiesForTests(): void {
  videoIngestProxyRotation.reset();
}
