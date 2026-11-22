/**
 * The relay a session's yt-dlp reaches the PO-token provider through
 * (tale-project/tale#4942, `core/video_links/relay.ts`).
 *
 * The bgutil plugin asks its provider two things, `GET <base>/ping` and
 * `POST <base>/get_pot`, and always directly: it sets the provider's own
 * address aside from yt-dlp's proxy. The provider is a service on the
 * internal network, which a sandbox session has no route to. So the plugin
 * is given this route as its base URL, with a token for its job in the
 * path, and the route passes the two calls on.
 *
 * The plugin also tells the provider which proxy yt-dlp is using, for the
 * provider to fetch through as well. In a session that is one of two
 * things. It is the platform's proxy relay where the video goes through a
 * proxy: the provider can reach that, and it is passed on, so the token is
 * made from the address the video is fetched from. Or it is the sandbox's
 * egress proxy, which is how a session reaches anything and nothing the
 * provider needs: that is taken out, and the provider fetches from its own
 * address, as it did when yt-dlp ran beside it.
 *
 * The provider was written for a caller it trusts: the plugin of a yt-dlp
 * that runs beside it. A session is no such caller. yt-dlp fetches whatever
 * a member pastes, and what runs in a session holds the session's token.
 * So the provider is never handed a session's request: it is asked with what
 * this route builds from one, key by key ({@link providerRequest}), and no
 * faster than a job may ask.
 */

import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';

import { isRelayProxyUrl } from '../../core/video_links/relay.ts';
import { verifyVideoRelayToken } from '../../core/video_links/relay_token.ts';
import { potProviderUrl } from '../../core/video_links/ytdlp.ts';

/** The plugin's request holds a challenge, a content binding and an
 * InnerTube context: a few tens of kibibytes. */
const POT_REQUEST_MAX_BYTES = 256 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * What one job may ask the provider in a minute, pings and tokens together.
 * A run asks once to see that the provider is there and then for a token
 * per player client and use, a dozen calls at most, and a video's runs
 * follow one another: this is several times that. Past it the route answers
 * 429 and the provider is not asked, so that what runs in one session
 * cannot have the provider mint tokens without end, from the deployment's
 * own address, at every other video's cost.
 */
export const POT_REQUESTS_PER_MINUTE = 120;
const POT_RATE_WINDOW_MS = 60_000;

/**
 * The provider's request, built from the plugin's: the keys below, each of
 * the kind the provider reads it as, and nothing else of what was sent.
 *
 * What is left out is what a session may not say. `challenge` names a script
 * by its address, which the provider fetches and runs in its own process
 * (`session_manager.ts` of bgutil-ytdlp-pot-provider 1.3.1: `new Function`
 * on what `challenge.interpreterUrl` answers); without it the provider asks
 * YouTube for the challenge itself, over a connection it verifies.
 * `disable_tls_verification` would take that verification away, and
 * `source_address` binds the provider's requests to an address of its own
 * network.
 */
export function providerRequest(
  request: Record<string, unknown>,
  proxy: string | null,
): Record<string, unknown> {
  return {
    ...(typeof request.content_binding === 'string'
      ? { content_binding: request.content_binding }
      : {}),
    ...(request.bypass_cache === true ? { bypass_cache: true } : {}),
    ...(isRecord(request.innertube_context)
      ? { innertube_context: request.innertube_context }
      : {}),
    proxy,
  };
}

/** A provider's answer is a token or an error: a few kibibytes. */
const POT_ANSWER_MAX_BYTES = 1024 * 1024;

/** The plugin waits this long for a token itself. */
const POT_TIMEOUT_MS = 30_000;

export interface VideoPotRelayOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
}

export function createVideoPotRelayRoutes(
  options: VideoPotRelayOptions = {},
): Hono {
  const env = options.env ?? process.env;
  const send = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const app = new Hono();
  /** When each job asked, within the last minute. */
  const asked = new Map<string, number[]>();

  /** Whether `job` may ask now, which counts as its asking. */
  const mayAsk = (job: string): boolean => {
    const since = now() - POT_RATE_WINDOW_MS;
    // A job that stopped asking is forgotten: the map holds the jobs of the
    // last minute, however many a deployment has run.
    if (asked.size > 1024) {
      for (const [other, times] of asked) {
        if ((times.at(-1) ?? 0) <= since) asked.delete(other);
      }
    }
    const times = (asked.get(job) ?? []).filter((time) => time > since);
    if (times.length >= POT_REQUESTS_PER_MINUTE) {
      asked.set(job, times);
      return false;
    }
    times.push(now());
    asked.set(job, times);
    return true;
  };
  const tooFast = (c: Context): Response =>
    c.json({ error: 'pot_rate_limited' }, 429, { 'retry-after': '60' });

  /** The job a request's token is for, or `null` for a token that is not a
   * PO-token grant of this deployment. */
  const jobOf = (c: Context): string | null => {
    const grant = verifyVideoRelayToken(c.req.param('token') ?? '', env, now());
    return grant?.use === 'pot' ? grant.job : null;
  };

  /** The proxy the provider is told to fetch through: yt-dlp's, where that
   * is the platform's relay for this same job, else none. */
  const providerProxy = (proxy: unknown, job: string): string | null => {
    if (typeof proxy !== 'string' || !isRelayProxyUrl(proxy, env)) return null;
    let token: string;
    try {
      token = decodeURIComponent(new URL(proxy).password);
    } catch {
      return null;
    }
    const grant = verifyVideoRelayToken(token, env, now());
    return grant?.use === 'proxy' && grant.job === job ? proxy : null;
  };

  const forward = async (
    c: Context,
    path: '/ping' | '/get_pot',
    body: string | undefined,
  ): Promise<Response> => {
    // The session's image carries the plugin; whether a provider is asked
    // is the deployment's settings alone.
    const provider = potProviderUrl(env, true);
    if (provider === undefined) {
      return c.json({ error: 'pot_provider_off' }, 503);
    }
    let answer: Response;
    try {
      answer = await send(`${provider.replace(/\/+$/, '')}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        ...(body === undefined
          ? {}
          : { headers: { 'content-type': 'application/json' }, body }),
        redirect: 'error',
        signal: AbortSignal.timeout(POT_TIMEOUT_MS),
      });
    } catch (error) {
      console.warn(
        '[video-relay] the PO-token provider could not be asked:',
        error instanceof Error ? error.message : error,
      );
      return c.json({ error: 'pot_provider_unreachable' }, 502);
    }
    const declared = Number(answer.headers.get('content-length') ?? Number.NaN);
    if (Number.isFinite(declared) && declared > POT_ANSWER_MAX_BYTES) {
      await answer.body?.cancel();
      return c.json({ error: 'pot_provider_answer_too_large' }, 502);
    }
    const text = await answer.text();
    if (Buffer.byteLength(text) > POT_ANSWER_MAX_BYTES) {
      return c.json({ error: 'pot_provider_answer_too_large' }, 502);
    }
    return new Response(text, {
      status: answer.status,
      headers: {
        'content-type':
          answer.headers.get('content-type') ?? 'application/json',
      },
    });
  };

  app.get('/:token/ping', async (c) => {
    const job = jobOf(c);
    if (job === null) return c.json({ error: 'forbidden' }, 403);
    if (!mayAsk(job)) return tooFast(c);
    return await forward(c, '/ping', undefined);
  });

  app.post(
    '/:token/get_pot',
    bodyLimit({
      maxSize: POT_REQUEST_MAX_BYTES,
      onError: (c) => c.json({ error: 'body_too_large' }, 413),
    }),
    async (c) => {
      const job = jobOf(c);
      if (job === null) return c.json({ error: 'forbidden' }, 403);
      let request: unknown;
      try {
        request = JSON.parse(await c.req.text());
      } catch {
        return c.json({ error: 'invalid_json' }, 400);
      }
      if (!isRecord(request)) return c.json({ error: 'invalid_json' }, 400);
      if (!mayAsk(job)) return tooFast(c);
      return await forward(
        c,
        '/get_pot',
        JSON.stringify(
          providerRequest(request, providerProxy(request.proxy, job)),
        ),
      );
    },
  );

  return app;
}
