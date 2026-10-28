import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  nextOutboundProxy,
  OUTBOUND_PROXY_SET_ASIDE_MS,
  outboundProxyEntry,
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

  it('hands out a preferred proxy without moving the rotation', () => {
    const [, b] = [nextOutboundProxy(THREE, 0), nextOutboundProxy(THREE, 0)];
    expect(b).not.toBeNull();
    resetOutboundProxiesForTests();
    expect(nextOutboundProxy(THREE, 0, { prefer: b })?.label).toBe(
      'http://b.example:8080',
    );
    expect(nextOutboundProxy(THREE, 0, { prefer: b })?.label).toBe(
      'http://b.example:8080',
    );
    expect(picks(THREE, 2)).toEqual([
      'http://a.example:8080',
      'http://b.example:8080',
    ]);
  });

  it('takes the next in turn when the preferred proxy is set aside', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const a = nextOutboundProxy(THREE, 0);
    expect(a).not.toBeNull();
    if (a === null) return;
    setOutboundProxyAside(a, 'ECONNREFUSED', 0);
    expect(nextOutboundProxy(THREE, 1_000, { prefer: a })?.label).toBe(
      'http://b.example:8080',
    );
  });

  it('takes the next in turn when the preferred proxy is no longer listed', () => {
    const a = nextOutboundProxy(THREE, 0);
    expect(
      nextOutboundProxy({ OUTBOUND_PROXY_URLS: 'http://d.example' }, 0, {
        prefer: a,
      })?.label,
    ).toBe('http://d.example:80');
  });

  it('never takes a skipped proxy, however often it is listed', () => {
    const twice = {
      OUTBOUND_PROXY_URLS:
        'http://a.example:8080, http://a.example:8080, http://b.example:8080',
    };
    const skip = new Set(['http://a.example:8080']);
    expect(
      Array.from(
        { length: 3 },
        () => nextOutboundProxy(twice, 0, { skip })?.label,
      ),
    ).toEqual([
      'http://b.example:8080',
      'http://b.example:8080',
      'http://b.example:8080',
    ]);
    // Nor as the preferred one.
    expect(
      nextOutboundProxy(twice, 0, {
        skip,
        prefer: nextOutboundProxy(THREE, 0),
      })?.label,
    ).toBe('http://b.example:8080');
  });

  it('is null when every proxy is skipped, set aside or not', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const skip = new Set([
      'http://alice:s3cret@a.example:8080',
      'http://b.example:8080',
    ]);
    const c = nextOutboundProxy(THREE, 0, { skip });
    expect(c?.label).toBe('http://c.example:80');
    if (c !== null) setOutboundProxyAside(c, 'ETIMEDOUT', 0);
    // c is set aside but the only one left: the rotation still takes it.
    expect(nextOutboundProxy(THREE, 1_000, { skip })?.label).toBe(
      'http://c.example:80',
    );
    expect(
      nextOutboundProxy(THREE, 1_000, {
        skip: new Set([...skip, 'http://c.example:80']),
      }),
    ).toBeNull();
  });
});

describe('outboundProxyEntry', () => {
  it('tells apart entries on one gateway by their place in the list', () => {
    const gateway = {
      OUTBOUND_PROXY_URLS:
        'http://user-1:pw@p.example:80, http://user-2:pw@p.example:80',
    };
    const [first, second] = [
      nextOutboundProxy(gateway),
      nextOutboundProxy(gateway),
    ];
    expect(first?.label).toBe(second?.label);
    expect(first && outboundProxyEntry(first, gateway)).toBe(1);
    expect(second && outboundProxyEntry(second, gateway)).toBe(2);
    expect(second && outboundProxyEntry(second, THREE)).toBe(0);
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
