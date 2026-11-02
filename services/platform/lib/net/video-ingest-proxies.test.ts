import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  nextOutboundProxy,
  resetOutboundProxiesForTests,
} from './outbound-proxy';
import {
  checkVideoIngestProxySettings,
  parseVideoIngestProxyUrls,
  resetVideoIngestProxiesForTests,
  VideoIngestProxyConfigError,
  videoIngestProxyRotation,
} from './video-ingest-proxies';

afterEach(() => {
  resetVideoIngestProxiesForTests();
  resetOutboundProxiesForTests();
  vi.restoreAllMocks();
});

describe('parseVideoIngestProxyUrls', () => {
  it('is empty when unset or blank', () => {
    expect(parseVideoIngestProxyUrls(undefined)).toEqual([]);
    expect(parseVideoIngestProxyUrls(' , \n')).toEqual([]);
  });

  it('takes every scheme yt-dlp speaks, comma- or space-separated, and hands yt-dlp each entry as written', () => {
    expect(
      parseVideoIngestProxyUrls(
        'socks5h://u:p@a.example, socks5://b.example:1081 socks4a://c.example\nsocks4://d.example:9050,https://e.example, http://F.Example:3128/',
      ),
    ).toEqual([
      { url: 'socks5h://u:p@a.example', label: 'socks5h://a.example:1080' },
      { url: 'socks5://b.example:1081', label: 'socks5://b.example:1081' },
      { url: 'socks4a://c.example', label: 'socks4a://c.example:1080' },
      { url: 'socks4://d.example:9050', label: 'socks4://d.example:9050' },
      { url: 'https://e.example', label: 'https://e.example:443' },
      { url: 'http://F.Example:3128/', label: 'http://f.example:3128' },
    ]);
  });

  it.each([
    ['not-a-url', 'is not a URL'],
    ['socks5h://u:s3cret@p.example:99999', 'is not a URL'],
    // Without a scheme, the user name stands where the scheme goes.
    ['u:s3cret@p.example:1080', 'has a scheme yt-dlp cannot take a proxy in'],
    [
      'ftp://u:s3cret@p.example:21',
      'has a scheme yt-dlp cannot take a proxy in',
    ],
    ['socks5://', 'names no host'],
    ['socks5h://u:s3cret@p.example:0', 'names port 0'],
    [
      'socks5h://u:s3cret@p.example:1080/x',
      'has a path, query or fragment after the host',
    ],
    [
      'http://u:s3cret@p.example:3128?x=1',
      'has a path, query or fragment after the host',
    ],
  ])('refuses %j by its position, without repeating it', (entry, reason) => {
    const parse = () =>
      parseVideoIngestProxyUrls(`socks5h://ok.example:1080, ${entry}`);
    expect(parse).toThrow(VideoIngestProxyConfigError);
    expect(parse).toThrow(`VIDEO_INGEST_PROXY_URLS entry 2 ${reason} (`);
    expect(parse).toThrow(/^(?![\s\S]*s3cret)/);
  });
});

describe('checkVideoIngestProxySettings', () => {
  it('refuses both variables set, and takes either alone', () => {
    const both = () =>
      checkVideoIngestProxySettings({
        VIDEO_INGEST_PROXY_URL: 'socks5h://v.example:1080',
        VIDEO_INGEST_PROXY_URLS: 'socks5h://a.example:1080',
      });
    expect(both).toThrow(VideoIngestProxyConfigError);
    expect(both).toThrow(
      'VIDEO_INGEST_PROXY_URL and VIDEO_INGEST_PROXY_URLS are both set; set one',
    );
    for (const env of [
      {},
      { VIDEO_INGEST_PROXY_URL: 'socks5h://v.example:1080' },
      { VIDEO_INGEST_PROXY_URLS: 'socks5h://a.example:1080' },
      {
        VIDEO_INGEST_PROXY_URL: ' ',
        VIDEO_INGEST_PROXY_URLS: 'socks5h://a.example:1080',
      },
      {
        VIDEO_INGEST_PROXY_URL: 'socks5h://v.example:1080',
        VIDEO_INGEST_PROXY_URLS: ' , ',
      },
    ]) {
      expect(() => checkVideoIngestProxySettings(env)).not.toThrow();
    }
  });
});

describe('videoIngestProxyRotation', () => {
  const BOTH = {
    OUTBOUND_PROXY_URLS: 'http://a.example:3128, http://b.example:3128',
    VIDEO_INGEST_PROXY_URLS: 'http://a.example:3128, http://b.example:3128',
  };

  it('keeps its own turn and its own memory of the proxies it passes over', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const first = videoIngestProxyRotation.next(BOTH, 0);
    expect(first?.label).toBe('http://a.example:3128');
    // The outbound proxies' turn did not move for it…
    expect(nextOutboundProxy(BOTH, 0)?.label).toBe('http://a.example:3128');
    if (first !== null) {
      videoIngestProxyRotation.setAside(
        first,
        'yt-dlp could not get through',
        0,
      );
    }
    expect(videoIngestProxyRotation.next(BOTH, 1_000)?.label).toBe(
      'http://b.example:3128',
    );
    expect(videoIngestProxyRotation.next(BOTH, 1_000)?.label).toBe(
      'http://b.example:3128',
    );
    // …and a proxy video ingestion passes over is still theirs to take.
    expect(nextOutboundProxy(BOTH, 1_000)?.label).toBe('http://b.example:3128');
    expect(nextOutboundProxy(BOTH, 1_000)?.label).toBe('http://a.example:3128');
    expect(warn.mock.calls.map((call) => String(call[0]))).toEqual([
      '[video-proxy] http://a.example:3128 failed (yt-dlp could not get through); passing over it for 60 s',
    ]);
  });

  it('never takes the outbound proxies, nor they its own', () => {
    expect(
      videoIngestProxyRotation.next({
        OUTBOUND_PROXY_URLS: 'http://a.example:3128',
      }),
    ).toBeNull();
    // The crawler, the web fetch and email images take theirs from here.
    expect(
      nextOutboundProxy({ VIDEO_INGEST_PROXY_URLS: 'http://a.example:3128' }),
    ).toBeNull();
  });

  it('names an entry by its place in the list', () => {
    const env = {
      VIDEO_INGEST_PROXY_URLS:
        'socks5h://user-1:p@gw.example:1080, socks5h://user-2:p@gw.example:1080',
    };
    const [, second] = videoIngestProxyRotation.proxies(env);
    expect(second?.label).toBe('socks5h://gw.example:1080');
    if (second !== undefined) {
      expect(videoIngestProxyRotation.entry(second, env)).toBe(2);
    }
  });
});
