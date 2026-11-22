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
 *   (`domains/video_links/pot-relay-routes.ts`).
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
  return `${base.origin}${RELAY_POT_PATH}/${token}`;
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
