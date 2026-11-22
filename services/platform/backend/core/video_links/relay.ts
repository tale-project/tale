/**
 * The addresses a session's yt-dlp is given for the platform's two relays
 * (tale-project/tale#4942): a proxy URL that stands for one of video
 * ingestion's proxies, and the base URL of the PO-token provider.
 *
 * yt-dlp runs in a sandbox session. A session reaches the internet through
 * the sandbox's egress proxy alone, which tunnels to web ports and knows
 * nothing of video ingestion's proxies; it must hold none of their
 * credentials; and it has no route to the PO-token provider, a service on
 * the internal network. The one address beyond the egress that every session
 * reaches, on every sandbox backend, is the platform's own API listener
 * (`SANDBOX_HTTP_API_BASE_URL`, where staged files come from too). So both
 * ride it, each behind a token for one job (`relay_token.ts`):
 *
 * - `--proxy http://tale:<token>@<api host>`: the listener answers yt-dlp's
 *   `CONNECT` and dials the one proxy the token names
 *   (`domains/video_links/proxy-relay.ts`);
 * - `youtubepot-bgutilhttp:base_url=<api>/api/video-relay/pot/<token>`: the
 *   listener passes the plugin's two calls on to the provider
 *   (`domains/video_links/pot-relay-routes.ts`). The token rides that path
 *   in hex ({@link potPathToken}).
 */

import {
  signVideoRelayToken,
  VIDEO_RELAY_GRANT_TTL_MS,
  videoProxyDigest,
} from './relay_token';

/** The user name of a relay proxy URL. The token is the password; the name
 * only fills the place a proxy URL has for one. */
export const RELAY_PROXY_USER = 'tale';

/** Where the PO-token relay is mounted. */
export const RELAY_POT_PATH = '/api/video-relay/pot';

/**
 * What the proxy relay answers a tunnel request with when the video's proxy
 * itself could not be used: unreachable, not answering, not the protocol its
 * entry says. A status no proxy sends, because yt-dlp reports a refused
 * tunnel by its status (curl, under `--impersonate`, by nothing else), and
 * `proxyFailedRun` must tell this from a proxy that works and could not
 * reach one host, which answers 502 or 503 and is not to blame.
 */
export const RELAY_PROXY_UNREACHABLE_STATUS = 530;

/**
 * What the proxy relay answers a request it will not carry for a reason of
 * its own: no token, one that is not this deployment's or has expired, or one
 * that names a proxy the deployment no longer lists. A status no proxy sends,
 * with a reason that is none a platform gives: a 403 here would read to
 * yt-dlp, and to the lane behind it, as the video's platform turning the
 * proxy's address away, and send the video on through the other proxies for
 * what is the deployment's own settings (an API process and a worker that
 * hold different keys or proxies).
 */
export const RELAY_REFUSED_STATUS = 531;

/**
 * A relay token as the PO-token relay's path carries it: in lower-case hex.
 *
 * The path is part of an extractor argument, and yt-dlp hands an extractor
 * argument's value on in lower case unless whoever reads it asks for its
 * case. The bgutil plugin (1.3.1) reads its `base_url` without asking. A
 * token is base64url, whose case is half of what it says: lower-cased, its
 * signature holds for nothing, the relay refused the plugin's every call,
 * and the provider was never asked (measured with the plugin against a
 * provider that records, 2026-11-22). Hex says the same in either case.
 */
export function potPathToken(token: string): string {
  return Buffer.from(token, 'utf8').toString('hex');
}

/** The relay token a path segment of the PO-token relay carries, or `null`
 * for a segment that is no {@link potPathToken}: a token as it is signed is
 * none, so that a deployment answers one form and not two. */
export function tokenOfPotPath(segment: string): string | null {
  if (!/^(?:[0-9a-f]{2}){1,1024}$/.test(segment)) return null;
  return Buffer.from(segment, 'hex').toString('utf8');
}

/** The platform's API listener as a session reaches it. */
function sessionApiBase(env: NodeJS.ProcessEnv): URL {
  return new URL(env.SANDBOX_HTTP_API_BASE_URL ?? 'http://backend-api:3005');
}

/**
 * The proxy URL a session's yt-dlp is given in place of `proxyUrl`, one of
 * the configured proxies: the relay, with a token that names the job and
 * that proxy. `null` where the deployment has no key to sign with.
 */
export function relayProxyUrl(
  proxyUrl: string,
  jobId: string,
  env: NodeJS.ProcessEnv = process.env,
  now: number = Date.now(),
): string | null {
  const token = signVideoRelayToken(
    {
      use: 'proxy',
      job: jobId,
      proxy: videoProxyDigest(proxyUrl),
      exp: now + VIDEO_RELAY_GRANT_TTL_MS,
    },
    env,
  );
  if (token === null) return null;
  const base = sessionApiBase(env);
  // A token is base64url and dots: nothing a URL's credentials escape.
  return `http://${RELAY_PROXY_USER}:${token}@${base.host}`;
}

/**
 * The PO-token provider's base URL as a session's yt-dlp is given it: the
 * relay's route, with a token that names the job. `null` where the
 * deployment has no key to sign with.
 */
export function relayPotBaseUrl(
  jobId: string,
  env: NodeJS.ProcessEnv = process.env,
  now: number = Date.now(),
): string | null {
  const token = signVideoRelayToken(
    { use: 'pot', job: jobId, exp: now + VIDEO_RELAY_GRANT_TTL_MS },
    env,
  );
  if (token === null) return null;
  const base = sessionApiBase(env);
  return `${base.origin}${RELAY_POT_PATH}/${potPathToken(token)}`;
}

/** Whether `proxyUrl` is a relay proxy URL of this deployment: the listener
 * as a session reaches it, with the relay's user name. Its token is not
 * checked here. */
export function isRelayProxyUrl(
  proxyUrl: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  let url: URL;
  try {
    url = new URL(proxyUrl);
  } catch {
    return false;
  }
  return (
    url.protocol === 'http:' &&
    url.host === sessionApiBase(env).host &&
    url.username === RELAY_PROXY_USER
  );
}
