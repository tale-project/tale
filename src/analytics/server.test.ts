import { describe, expect, it, vi } from 'vitest';

import { createAnalytics } from './server';

const environment = {
  UMAMI_WEBSITE_ID: '11111111-1111-4111-8111-111111111111',
  UMAMI_URL: 'https://metrics.example',
  UMAMI_PROXY_TOKEN: 'synthetic-collector-token',
};
const payload = {
  website: environment.UMAMI_WEBSITE_ID,
  url: '/dashboard/:id/chats/:chatId',
  hostname: 'spoofed.example',
  language: 'de-CH',
  screen: '1920x1080',
  referrer: 'https://search.example/private?secret=value#fragment',
};
function request(body: unknown = { type: 'event', payload }, headers = {}) {
  return new Request('https://app.example/_a/api/send', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-analytics-client-ip': '192.0.2.45',
      'user-agent': 'Test Browser',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe('deployment analytics boundary', () => {
  it('is disabled without all valid runtime values and emits only public metadata', async () => {
    for (const disabled of [
      {},
      { ...environment, UMAMI_WEBSITE_ID: '' },
      { ...environment, UMAMI_PROXY_TOKEN: '' },
      { ...environment, UMAMI_URL: 'http://remote.example' },
      { ...environment, UMAMI_URL: 'https://user:password@remote.example' },
      { ...environment, UMAMI_URL: 'https://remote.example/path' },
      { ...environment, UMAMI_URL: 'https://remote.example/?query' },
    ]) {
      const analytics = createAnalytics(disabled);
      expect(analytics.html).toBe('');
      expect((await analytics.handle(request()))?.status).toBe(404);
    }
    const analytics = createAnalytics(environment, '/tale');
    expect(analytics.html).toContain('"proxyPath":"/tale/_a"');
    expect(analytics.html).toContain(environment.UMAMI_WEBSITE_ID);
    expect(analytics.html).not.toContain(environment.UMAMI_PROXY_TOKEN);
    expect(analytics.html).not.toContain(environment.UMAMI_URL);
    expect(
      await analytics.handle(new Request('https://app.example/')),
    ).toBeNull();
  });

  it('forwards a curated event, trusted IP, browser and in-memory session cache only', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response('{"cache":"next"}', {
        headers: { 'set-cookie': 'secret=upstream', location: '/login' },
      }),
    );
    const analytics = createAnalytics(environment, '', fetcher);
    const response = await analytics.handle(
      request(
        {
          type: 'event',
          payload: {
            ...payload,
            id: 'PRIVATE_USER',
            title: 'PRIVATE_DOCUMENT',
            data: { content: 'PRIVATE_CHAT' },
          },
        },
        {
          authorization: 'Bearer PRIVATE_SESSION',
          cookie: 'session=PRIVATE_COOKIE',
          referer: 'https://app.example/PRIVATE_PATH',
          'x-forwarded-for': '198.51.100.99',
          'x-umami-cache': 'memory-cache',
        },
      ),
    );
    expect(response?.status).toBe(200);
    expect(response?.headers.get('set-cookie')).toBeNull();
    expect(response?.headers.get('location')).toBeNull();
    expect(await response?.json()).toEqual({ cache: 'next' });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://metrics.example/_collect/api/send');
    expect(init.credentials).toBe('omit');
    expect(init.redirect).toBe('error');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const headers = new Headers(init.headers);
    expect(headers.get('authorization')).toBe(
      `Bearer ${environment.UMAMI_PROXY_TOKEN}`,
    );
    expect(headers.get('x-analytics-client-ip')).toBe('192.0.2.45');
    expect(headers.get('user-agent')).toBe('Test Browser');
    expect(headers.get('x-umami-cache')).toBe('memory-cache');
    for (const name of ['cookie', 'referer', 'x-forwarded-for'])
      expect(headers.has(name)).toBe(false);
    const wire = String(init.body);
    expect(wire).not.toMatch(/PRIVATE_|secret|fragment/);
    expect(JSON.parse(wire).payload).toEqual({
      ...payload,
      hostname: 'app.example',
      referrer: 'https://search.example',
    });
  });

  it('allows only the tracker GET and collector POST, with no arbitrary proxy path', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('/* tracker */'));
    const analytics = createAnalytics(environment, '', fetcher);
    for (const path of [
      '/_a/login',
      '/_a/api/websites',
      '/_a/api/replay',
      '/_a/script.js?redirect=https://evil.example',
    ]) {
      expect(
        (await analytics.handle(new Request(`https://app.example${path}`)))
          ?.status,
      ).toBe(404);
    }
    expect(
      (await analytics.handle(new Request('https://app.example/_a/api/send')))
        ?.status,
    ).toBe(405);
    expect(
      (
        await analytics.handle(
          new Request('https://app.example/_a/script.js', { method: 'POST' }),
        )
      )?.status,
    ).toBe(405);
    expect(fetcher).not.toHaveBeenCalled();
    const response = await analytics.handle(
      new Request('https://app.example/_a/script.js'),
    );
    expect(response?.headers.get('content-type')).toContain(
      'application/javascript',
    );
    expect(fetcher.mock.calls[0][0]).toBe(
      'https://metrics.example/_collect/script.js',
    );
  });

  it('refuses opt-outs, untrusted IPs, private URLs, identity/replay and unbounded data', async () => {
    const fetcher = vi.fn();
    const analytics = createAnalytics(environment, '', fetcher);
    for (const headers of [{ dnt: '1' }, { 'sec-gpc': '1' }]) {
      expect(
        (await analytics.handle(request(undefined, headers)))?.status,
      ).toBe(204);
    }
    for (const headers of [
      { 'x-analytics-client-ip': '' },
      { 'x-analytics-client-ip': '192.0.2.1, 192.0.2.2' },
      { 'content-length': '99999999' },
    ])
      expect(
        (await analytics.handle(request(undefined, headers)))?.status,
      ).toBe(400);
    for (const body of [
      { type: 'identify', payload },
      { type: 'replay', payload },
      { type: 'event', payload: { ...payload, url: '/chat?private' } },
      { type: 'event', payload: { ...payload, url: '/chat#private' } },
      {
        type: 'event',
        payload: {
          ...payload,
          website: '22222222-2222-4222-8222-222222222222',
        },
      },
      { type: 'event', payload: { ...payload, name: 'PRIVATE_EVENT' } },
      { type: 'event', payload: { ...payload, data: 'x'.repeat(5000) } },
    ])
      expect((await analytics.handle(request(body)))?.status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('isolates a collector outage from the application and exposes no upstream body', async () => {
    for (const fetcher of [
      vi.fn().mockRejectedValue(new Error('PRIVATE_TOKEN')),
      vi
        .fn()
        .mockResolvedValue(
          new Response('PRIVATE_UPSTREAM_ERROR', { status: 500 }),
        ),
    ]) {
      const response = await createAnalytics(environment, '', fetcher).handle(
        request(),
      );
      expect(response?.status).toBe(502);
      expect(await response?.text()).toBe('');
    }
  });
});
