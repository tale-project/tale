import { isIP } from 'node:net';

import { z } from 'zod';

import {
  ANALYTICS_CONFIG_ID,
  analyticsPayloadSchema,
  analyticsReferrer,
  publicAnalyticsSchema,
} from './config';

const MAX_BODY_BYTES = 4096;
const TIMEOUT_MS = 5000;
const serverConfigSchema = z.object({
  websiteId: z.uuid(),
  url: z.url(),
  proxyToken: z
    .string()
    .min(16)
    .max(256)
    .regex(/^[A-Za-z0-9._~-]+$/),
});

export interface AnalyticsEnvironment {
  [key: string]: string | undefined;
  UMAMI_WEBSITE_ID?: string;
  UMAMI_URL?: string;
  UMAMI_PROXY_TOKEN?: string;
}

async function readBody(request: Request): Promise<unknown> {
  if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES)
    throw new Error('Analytics payload too large');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Missing analytics payload');
  const timer = setTimeout(() => void reader.cancel(), TIMEOUT_MS);
  try {
    const chunks: Uint8Array[] = [];
    let length = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new Error('Analytics payload too large');
      }
      chunks.push(value);
    }
    const body = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder().decode(body));
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
}

/** Runtime opt-in. The token and collector origin never enter the HTML. */
export function createAnalytics(
  environment: AnalyticsEnvironment = process.env,
  basePath = '',
  fetcher: (url: string, init: RequestInit) => Promise<Response> = fetch,
) {
  const parsed = serverConfigSchema.safeParse({
    websiteId: environment.UMAMI_WEBSITE_ID,
    url: environment.UMAMI_URL,
    proxyToken: environment.UMAMI_PROXY_TOKEN,
  });
  const collector = parsed.success ? new URL(parsed.data.url) : undefined;
  const local =
    collector &&
    ['127.0.0.1', 'localhost', '[::1]'].includes(collector.hostname);
  const publicConfig = publicAnalyticsSchema.safeParse({
    websiteId: parsed.success ? parsed.data.websiteId : undefined,
    proxyPath: `${basePath.replace(/\/+$/, '')}/_a`,
  });
  const config =
    parsed.success &&
    publicConfig.success &&
    collector &&
    (collector.protocol === 'https:' ||
      (collector.protocol === 'http:' && local)) &&
    !collector.username &&
    !collector.password &&
    collector.pathname === '/' &&
    !collector.search &&
    !collector.hash
      ? { ...parsed.data, ...publicConfig.data }
      : undefined;
  const html = config
    ? `<script id="${ANALYTICS_CONFIG_ID}" type="application/json">${JSON.stringify(publicConfig.data)}</script>`
    : '';

  return {
    html,
    async handle(request: Request): Promise<Response | null> {
      const url = new URL(request.url);
      if (!url.pathname.startsWith('/_a/')) return null;
      const reply = (body: BodyInit | null, status: number) =>
        new Response(body, {
          status,
          headers: { 'cache-control': 'no-store' },
        });
      if (!config) return reply(null, 404);
      const tracker = url.pathname === '/_a/script.js';
      const event = url.pathname === '/_a/api/send';
      if ((!tracker && !event) || url.search) return reply(null, 404);
      if (request.method !== (tracker ? 'GET' : 'POST'))
        return reply(null, 405);
      if (
        request.headers.get('dnt') === '1' ||
        request.headers.get('sec-gpc') === '1'
      )
        return reply(null, 204);

      const headers = new Headers({
        authorization: `Bearer ${config.proxyToken}`,
      });
      let body: string | undefined;
      if (event) {
        const ip = request.headers.get('x-analytics-client-ip') ?? '';
        if (!isIP(ip)) return reply(null, 400);
        if (
          !request.headers.get('content-type')?.startsWith('application/json')
        )
          return reply(null, 415);
        // The native/edge Caddy overwrites this dedicated header. Never use
        // browser-provided X-Forwarded-For, cookies, authorization or Referer.
        headers.set('x-analytics-client-ip', ip);
        headers.set('content-type', 'application/json');
        headers.set(
          'user-agent',
          request.headers.get('user-agent')?.slice(0, 1024) ?? '',
        );
        try {
          const envelope = z
            .object({
              type: z.literal('event'),
              payload: analyticsPayloadSchema,
            })
            .parse(await readBody(request));
          if (envelope.payload.website !== config.websiteId)
            return reply(null, 400);
          body = JSON.stringify({
            type: 'event',
            payload: {
              ...envelope.payload,
              hostname: url.hostname,
              referrer: analyticsReferrer(
                envelope.payload.referrer,
                url.origin,
              ),
            },
          });
        } catch {
          return reply(null, 400);
        }
        const cache = request.headers.get('x-umami-cache');
        if (cache && cache.length <= 2048) headers.set('x-umami-cache', cache);
        headers.set('x-umami-website-id', config.websiteId);
        headers.set('x-umami-hostname', url.hostname);
      }
      try {
        const upstream = await fetcher(
          `${config.url.replace(/\/$/, '')}/_collect/${tracker ? 'script.js' : 'api/send'}`,
          {
            method: request.method,
            headers,
            body,
            redirect: 'error',
            credentials: 'omit',
            signal: AbortSignal.timeout(TIMEOUT_MS),
          },
        );
        if (!upstream.ok) {
          await upstream.body?.cancel();
          return reply(null, 502);
        }
        // Neither upstream cookies nor dashboard headers may reach the app.
        return new Response(await upstream.text(), {
          headers: {
            'content-type': tracker
              ? 'application/javascript; charset=utf-8'
              : 'application/json',
            'cache-control': tracker ? 'public, max-age=300' : 'no-store',
          },
        });
      } catch {
        return reply(null, 502);
      }
    },
  };
}
