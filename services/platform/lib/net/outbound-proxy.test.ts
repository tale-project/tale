import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  nextOutboundProxy,
  OUTBOUND_PROXY_SET_ASIDE_MS,
  resetOutboundProxiesForTests,
  setOutboundProxyAside,
} from './outbound-proxy';

const THREE = {
  OUTBOUND_PROXY_URLS:
    'http://alice:s3cret@a.example:8080, http://b.example:8080 http://c.example',
};

/** The labels of the next `count` picks. */
function picks(env: NodeJS.ProcessEnv, count: number, now = 0): string[] {
  return Array.from(
    { length: count },
    () => nextOutboundProxy(env, now)?.label ?? 'direct',
  );
}

afterEach(() => {
  resetOutboundProxiesForTests();
  vi.restoreAllMocks();
});

describe('nextOutboundProxy', () => {
  it('is null when no proxy is configured', () => {
    expect(nextOutboundProxy({})).toBeNull();
    expect(nextOutboundProxy({ OUTBOUND_PROXY_URLS: ' , ' })).toBeNull();
  });

  it('takes the proxies in turn, round robin', () => {
    expect(picks(THREE, 4)).toEqual([
      'http://a.example:8080',
      'http://b.example:8080',
      'http://c.example:80',
      'http://a.example:8080',
    ]);
  });

  it('hands out the URL with its credentials, for the client to send', () => {
    expect(nextOutboundProxy(THREE)?.url).toBe(
      'http://alice:s3cret@a.example:8080',
    );
  });

  it('passes over a proxy that was set aside, until its minute is up', () => {
    const first = nextOutboundProxy(THREE, 0);
    expect(first).not.toBeNull();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    if (first !== null) setOutboundProxyAside(first, 'ECONNREFUSED', 0);
    expect(picks(THREE, 4, 1_000)).toEqual([
      'http://b.example:8080',
      'http://c.example:80',
      'http://b.example:8080',
      'http://c.example:80',
    ]);
    expect(picks(THREE, 1, OUTBOUND_PROXY_SET_ASIDE_MS)).toEqual([
      'http://a.example:8080',
    ]);
  });

  it('goes on through every proxy when all of them are set aside, never direct', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (let i = 0; i < 3; i += 1) {
      const proxy = nextOutboundProxy(THREE, 0);
      if (proxy !== null) setOutboundProxyAside(proxy, 'ETIMEDOUT', 0);
    }
    expect(picks(THREE, 3, 1_000)).toEqual([
      'http://a.example:8080',
      'http://b.example:8080',
      'http://c.example:80',
    ]);
  });

  it('reads the list again when its value changes', () => {
    expect(nextOutboundProxy(THREE)?.label).toBe('http://a.example:8080');
    expect(
      nextOutboundProxy({ OUTBOUND_PROXY_URLS: 'http://d.example:3128' })
        ?.label,
    ).toBe('http://d.example:3128');
  });

  it('refuses a malformed list rather than going direct', () => {
    expect(() =>
      nextOutboundProxy({ OUTBOUND_PROXY_URLS: 'socks5://p.example:1080' }),
    ).toThrow('OUTBOUND_PROXY_URLS entry 1 is not an http:// proxy URL');
  });
});

describe('setOutboundProxyAside', () => {
  it('logs the host and port once per set-aside, never the credentials', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const proxy = nextOutboundProxy(THREE, 0);
    expect(proxy).not.toBeNull();
    if (proxy === null) return;
    setOutboundProxyAside(proxy, 'ECONNREFUSED', 0);
    setOutboundProxyAside(proxy, 'ECONNREFUSED', 1_000);
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0]?.[0]);
    expect(line).toContain('http://a.example:8080');
    expect(line).toContain('ECONNREFUSED');
    expect(line).not.toContain('s3cret');
    expect(line).not.toContain('alice');
  });
});
