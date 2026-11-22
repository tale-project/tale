// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  relayPotBaseUrl,
  relayProxyUrl,
} from '../../core/video_links/relay.ts';
import {
  createVideoPotRelayRoutes,
  POT_REQUESTS_PER_MINUTE,
  providerRequest,
} from './pot-relay-routes.ts';

/**
 * The bgutil plugin of a yt-dlp that runs in a sandbox session asks its
 * provider through the platform, with a token for its job in the path
 * (tale-project/tale#4942).
 */

const ENV = {
  WEBDAV_APP_PASSWORD_HMAC_KEY: 'k'.repeat(64),
  VIDEO_INGEST_POT_PROVIDER: 'true',
};
const PROXY = 'socks5h://user-1:secret@residential.example:1080';

afterEach(() => {
  vi.restoreAllMocks();
});

interface Asked {
  url: string;
  method: string;
  body: unknown;
}

/** The route, and a provider that records what it is asked and answers
 * with `answer`. */
function relay(
  answer: () => Response | Promise<Response> = () =>
    Response.json({ poToken: 'token-1' }),
  env: NodeJS.ProcessEnv = ENV,
  now?: () => number,
) {
  const asked: Asked[] = [];
  const app = createVideoPotRelayRoutes({
    env,
    ...(now === undefined ? {} : { now }),
    fetch: (async (input: unknown, init?: RequestInit) => {
      asked.push({
        url: String(input),
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
      });
      return await answer();
    }) as typeof fetch,
  });
  /** The path the plugin asks, under the base URL a session is given. */
  const at = (path: string, job = 'job-1', from = env): string =>
    `${new URL(relayPotBaseUrl(job, from) ?? 'http://x').pathname.replace('/api/video-relay/pot', '')}${path}`;
  const getPot = (body: unknown, path = at('/get_pot')) =>
    app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  return { app, asked, at, getPot };
}

describe('the PO-token relay', () => {
  it("passes the plugin's ping on to the provider and its answer back", async () => {
    const { app, asked, at } = relay(() =>
      Response.json({ version: '1.3.1', server_uptime: 12 }),
    );

    const answer = await app.request(at('/ping'));

    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({
      version: '1.3.1',
      server_uptime: 12,
    });
    expect(asked).toEqual([
      { url: 'http://bgutil-provider:4416/ping', method: 'GET', body: null },
    ]);
  });

  it('asks the provider the deployment names, where it names one', async () => {
    const { app, asked, at } = relay(undefined, {
      ...ENV,
      VIDEO_INGEST_POT_PROVIDER_URL: 'http://pot.internal:9000/',
    });

    await app.request(at('/ping', 'job-1', ENV));

    expect(asked[0]?.url).toBe('http://pot.internal:9000/ping');
  });

  // What bgutil's plugin 1.3.1 sends, and what its provider does with it.
  // The provider was written for a caller it trusts; a session is none.
  it("asks the provider with what it builds from the plugin's request, and nothing a session may not say", async () => {
    const { asked, getPot } = relay();

    const answer = await getPot({
      bypass_cache: true,
      // The address of a script the provider would fetch and run in its own
      // process.
      challenge: {
        program: 'abc',
        globalName: 'x',
        interpreterUrl: {
          privateDoNotAccessOrElseTrustedResourceUrlWrappedValue:
            '//attacker.example/x.js',
        },
      },
      content_binding: 'video-id',
      disable_tls_verification: true,
      innertube_context: { client: { visitorData: 'v' } },
      source_address: '10.0.0.5',
      proxy: null,
      // Nothing the plugin sends at all.
      anything_else: { nested: true },
    });

    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({ poToken: 'token-1' });
    expect(asked).toEqual([
      {
        url: 'http://bgutil-provider:4416/get_pot',
        method: 'POST',
        body: {
          bypass_cache: true,
          content_binding: 'video-id',
          innertube_context: { client: { visitorData: 'v' } },
          proxy: null,
        },
      },
    ]);
  });

  describe('providerRequest — what the provider is asked with', () => {
    it.each([
      [{}, { proxy: null }],
      [{ content_binding: 'v' }, { content_binding: 'v', proxy: null }],
      // Each key is passed in the kind the provider reads it as, or not.
      [{ content_binding: 42 }, { proxy: null }],
      [{ content_binding: null }, { proxy: null }],
      [{ bypass_cache: false }, { proxy: null }],
      [{ bypass_cache: 'true' }, { proxy: null }],
      [{ bypass_cache: true }, { bypass_cache: true, proxy: null }],
      [{ innertube_context: 'x' }, { proxy: null }],
      [{ innertube_context: [1] }, { proxy: null }],
      [
        { innertube_context: { client: {} } },
        { innertube_context: { client: {} }, proxy: null },
      ],
      // The proxy is the relay's to say, never the request's.
      [{ proxy: 'socks5h://evil.example:1080' }, { proxy: null }],
      [
        {
          challenge: 'x',
          disable_tls_verification: true,
          source_address: '::1',
          disable_innertube: true,
          data_sync_id: 'a',
          visitor_data: 'b',
        },
        { proxy: null },
      ],
    ])('builds %j into %j', (request, built) => {
      expect(providerRequest(request, null)).toEqual(built);
    });

    it('names the proxy it is given', () => {
      expect(providerRequest({ proxy: 'x' }, 'http://relay')).toEqual({
        proxy: 'http://relay',
      });
    });
  });

  // What runs in one session must not have the provider mint tokens without
  // end, from the deployment's own address.
  describe('asks the provider no faster than a job may ask', () => {
    it("answers 429 past a job's calls of a minute, pings and tokens together, and asks nothing", async () => {
      // The tokens are minted at the real time: the clock starts there.
      let clock = Date.now();
      const { app, asked, at, getPot } = relay(undefined, ENV, () => clock);

      for (let call = 0; call < POT_REQUESTS_PER_MINUTE - 1; call += 1) {
        expect((await getPot({ content_binding: 'v' })).status).toBe(200);
      }
      expect((await app.request(at('/ping'))).status).toBe(200);
      const refused = await getPot({ content_binding: 'v' });
      const pinged = await app.request(at('/ping'));

      expect(POT_REQUESTS_PER_MINUTE).toBe(120);
      expect(refused.status).toBe(429);
      expect(refused.headers.get('retry-after')).toBe('60');
      expect(await refused.json()).toEqual({ error: 'pot_rate_limited' });
      expect(pinged.status).toBe(429);
      expect(asked).toHaveLength(POT_REQUESTS_PER_MINUTE);

      // Another job's calls are its own.
      expect(
        (await getPot({ content_binding: 'v' }, at('/get_pot', 'job-2')))
          .status,
      ).toBe(200);

      // And a minute on the job asks again.
      clock += 60_001;
      expect((await getPot({ content_binding: 'v' })).status).toBe(200);
    });

    it('counts no call it refused for its token', async () => {
      // The tokens are minted at the real time: the clock starts there.
      let clock = Date.now();
      const { app, asked, getPot } = relay(undefined, ENV, () => clock);

      for (let call = 0; call < POT_REQUESTS_PER_MINUTE + 5; call += 1) {
        const refused = await app.request('/not-a-token/ping');
        expect(refused.status).toBe(403);
      }
      clock += 1;

      expect((await getPot({ content_binding: 'v' })).status).toBe(200);
      expect(asked).toHaveLength(1);
    });
  });

  describe('tells the provider which proxy to fetch through', () => {
    it("yt-dlp's, where that is the platform's relay for this job", async () => {
      const { asked, getPot } = relay();
      const proxy = relayProxyUrl(PROXY, 'job-1', ENV);

      await getPot({ content_binding: 'v', proxy });

      expect(asked[0]?.body).toEqual({ content_binding: 'v', proxy });
    });

    it.each([
      [
        'the sandbox egress, which is how a session reaches anything',
        () => 'http://sandbox-egress:3128',
      ],
      ['a proxy of its own choosing', () => 'socks5h://evil.example:1080'],
      [
        "the relay for another job's proxy",
        () => relayProxyUrl(PROXY, 'job-2', ENV),
      ],
      [
        'the relay with a token that has expired',
        () => relayProxyUrl(PROXY, 'job-1', ENV, 1_000),
      ],
      [
        'the relay with a token for the provider itself',
        () => {
          const pot = relayPotBaseUrl('job-1', ENV)?.split('/').at(-1);
          return `http://tale:${pot}@backend-api:3005`;
        },
      ],
      ['nothing that is a proxy', () => 42],
      ['none', () => undefined],
    ])('none, where yt-dlp names %s', async (_name, proxy) => {
      const { asked, getPot } = relay();

      const answer = await getPot({ content_binding: 'v', proxy: proxy() });

      expect(answer.status).toBe(200);
      expect(asked[0]?.body).toEqual({ content_binding: 'v', proxy: null });
    });
  });

  describe('answers nothing of the provider to', () => {
    it.each([
      ['no token of this deployment', '/not-a-token'],
      [
        'a token for a proxy',
        `/${new URL(relayProxyUrl(PROXY, 'job-1', ENV) ?? 'http://x').password}`,
      ],
      [
        'a token that has expired',
        `/${relayPotBaseUrl('job-1', ENV, 1_000)?.split('/').at(-1)}`,
      ],
      [
        'a token signed with another key',
        `/${relayPotBaseUrl('job-1', {
          WEBDAV_APP_PASSWORD_HMAC_KEY: 'z'.repeat(64),
        })
          ?.split('/')
          .at(-1)}`,
      ],
    ])('%s', async (_name, prefix) => {
      const { app, asked, getPot } = relay();

      const ping = await app.request(`${prefix}/ping`);
      const pot = await getPot({ content_binding: 'v' }, `${prefix}/get_pot`);

      expect([ping.status, pot.status]).toEqual([403, 403]);
      expect(await ping.json()).toEqual({ error: 'forbidden' });
      expect(asked).toEqual([]);
    });
  });

  it('says so where the deployment runs no provider', async () => {
    const { app, asked, at, getPot } = relay(undefined, {
      WEBDAV_APP_PASSWORD_HMAC_KEY: ENV.WEBDAV_APP_PASSWORD_HMAC_KEY,
    });
    const from = {
      WEBDAV_APP_PASSWORD_HMAC_KEY: ENV.WEBDAV_APP_PASSWORD_HMAC_KEY,
    };

    const ping = await app.request(at('/ping', 'job-1', from));
    const pot = await getPot(
      { content_binding: 'v' },
      at('/get_pot', 'job-1', from),
    );

    expect([ping.status, pot.status]).toEqual([503, 503]);
    expect(await pot.json()).toEqual({ error: 'pot_provider_off' });
    expect(asked).toEqual([]);
  });

  it("passes the provider's own refusal on as it is", async () => {
    const { getPot } = relay(() =>
      Response.json({ error: 'BotGuard challenge failed' }, { status: 500 }),
    );

    const answer = await getPot({ content_binding: 'v' });

    expect(answer.status).toBe(500);
    expect(await answer.json()).toEqual({ error: 'BotGuard challenge failed' });
  });

  it('tells a provider that cannot be asked apart, and says so in the log', async () => {
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { app, at } = relay(() =>
      Promise.reject(new Error('connect ECONNREFUSED')),
    );

    const answer = await app.request(at('/ping'));

    expect(answer.status).toBe(502);
    expect(await answer.json()).toEqual({ error: 'pot_provider_unreachable' });
    expect(warned).toHaveBeenCalledWith(
      '[video-relay] the PO-token provider could not be asked:',
      'connect ECONNREFUSED',
    );
  });

  it.each([
    ['what is no JSON', '{"content_binding":'],
    ['JSON that is no object', '["a"]'],
  ])('refuses %s before the provider is asked', async (_name, body) => {
    const { asked, getPot } = relay();

    const answer = await getPot(body);

    expect(answer.status).toBe(400);
    expect(await answer.json()).toEqual({ error: 'invalid_json' });
    expect(asked).toEqual([]);
  });

  it('refuses a request larger than any the plugin sends', async () => {
    const { asked, getPot } = relay();

    const answer = await getPot({ challenge: 'x'.repeat(300 * 1024) });

    expect(answer.status).toBe(413);
    expect(asked).toEqual([]);
  });

  it('refuses an answer larger than any a provider gives', async () => {
    const { getPot } = relay(
      () => new Response('x'.repeat(1024 * 1024 + 1), { status: 200 }),
    );

    const answer = await getPot({ content_binding: 'v' });

    expect(answer.status).toBe(502);
    expect(await answer.json()).toEqual({
      error: 'pot_provider_answer_too_large',
    });
  });
});
