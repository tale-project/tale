import { describe, expect, it } from 'vitest';

import {
  detectPlatform,
  extractVideoUrls,
  isPlaylistUrl,
  isSafeVideoUrl,
  normalizeUrlForHash,
} from './video-url';

describe('isSafeVideoUrl', () => {
  it('accepts well-formed https URLs', () => {
    expect(isSafeVideoUrl('https://youtu.be/dQw4w9WgXcQ')).toBe(true);
    expect(isSafeVideoUrl('https://www.youtube.com/watch?v=abc')).toBe(true);
    expect(isSafeVideoUrl('https://vimeo.com/12345')).toBe(true);
    expect(isSafeVideoUrl('https://www.bilibili.com/video/BV1xx')).toBe(true);
  });

  it('rejects non-https protocols', () => {
    expect(isSafeVideoUrl('http://youtube.com/watch?v=abc')).toBe(false);
    expect(isSafeVideoUrl('file:///etc/passwd')).toBe(false);
    expect(isSafeVideoUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeVideoUrl('data:text/plain;base64,SGVsbG8=')).toBe(false);
  });

  it('rejects URLs with credentials', () => {
    expect(isSafeVideoUrl('https://user@example.com/')).toBe(false);
    expect(isSafeVideoUrl('https://user:pass@example.com/')).toBe(false);
  });

  it('rejects localhost', () => {
    expect(isSafeVideoUrl('https://localhost/')).toBe(false);
    expect(isSafeVideoUrl('https://LOCALHOST/')).toBe(false);
    expect(isSafeVideoUrl('https://localhost:8080/')).toBe(false);
  });

  it('rejects dotted IPv4 literals', () => {
    expect(isSafeVideoUrl('https://127.0.0.1/')).toBe(false);
    expect(isSafeVideoUrl('https://10.0.0.5/')).toBe(false);
    expect(isSafeVideoUrl('https://169.254.169.254/')).toBe(false);
    expect(isSafeVideoUrl('https://192.168.1.1/')).toBe(false);
    expect(isSafeVideoUrl('https://100.64.0.1/')).toBe(false); // CGNAT
    expect(isSafeVideoUrl('https://0.0.0.0/')).toBe(false);
  });

  it('rejects IPv6 bracketed literals', () => {
    expect(isSafeVideoUrl('https://[::1]/')).toBe(false);
    expect(isSafeVideoUrl('https://[::ffff:127.0.0.1]/')).toBe(false);
    expect(isSafeVideoUrl('https://[fe80::1]/')).toBe(false);
    expect(isSafeVideoUrl('https://[fc00::1]/')).toBe(false);
    expect(isSafeVideoUrl('https://[2001:4860:4860::8888]/')).toBe(false); // even public IPv6 literal — reject
  });

  it('rejects decimal/hex/octal IPv4 hostname forms', () => {
    expect(isSafeVideoUrl('https://2130706433/')).toBe(false); // 127.0.0.1 as decimal
    expect(isSafeVideoUrl('https://0x7f000001/')).toBe(false); // 127.0.0.1 as hex
  });

  it('accepts substring fakeouts (real public hosts)', () => {
    // `localhost.evil.com` IS a real public host (an attacker could
    // register the apex). Frontend cannot tell — server-side DNS check
    // (`assertSafeUrl`) is the load-bearing defense. Test pins behavior.
    expect(isSafeVideoUrl('https://localhost.evil.com/')).toBe(true);
  });

  it('rejects malformed URLs', () => {
    expect(isSafeVideoUrl('not a url')).toBe(false);
    expect(isSafeVideoUrl('')).toBe(false);
    expect(isSafeVideoUrl('https://')).toBe(false);
  });
});

describe('isPlaylistUrl', () => {
  it('rejects standalone YouTube playlist URLs', () => {
    expect(isPlaylistUrl('https://www.youtube.com/playlist?list=PL123')).toBe(
      true,
    );
    expect(isPlaylistUrl('https://youtube.com/playlist?list=PL123')).toBe(true);
  });

  it('accepts video-in-playlist (watch?v=X&list=Y)', () => {
    expect(
      isPlaylistUrl('https://www.youtube.com/watch?v=abc&list=PL123'),
    ).toBe(false);
  });

  it('rejects Bilibili medialist play URLs', () => {
    expect(isPlaylistUrl('https://www.bilibili.com/medialist/play/1234')).toBe(
      true,
    );
  });

  it('accepts regular video URLs', () => {
    expect(isPlaylistUrl('https://youtu.be/abc')).toBe(false);
    expect(isPlaylistUrl('https://vimeo.com/123')).toBe(false);
  });
});

describe('detectPlatform', () => {
  it('identifies known platforms', () => {
    expect(detectPlatform('https://youtu.be/abc')).toBe('youtube');
    expect(detectPlatform('https://www.youtube.com/watch?v=abc')).toBe(
      'youtube',
    );
    expect(detectPlatform('https://m.youtube.com/watch?v=abc')).toBe('youtube');
    expect(detectPlatform('https://www.youtube-nocookie.com/embed/abc')).toBe(
      'youtube',
    );
    expect(detectPlatform('https://music.youtube.com/watch?v=abc')).toBe(
      'youtube',
    );
    expect(detectPlatform('https://www.bilibili.com/video/BV1xx')).toBe(
      'bilibili',
    );
    expect(detectPlatform('https://b23.tv/xxx')).toBe('bilibili');
    expect(detectPlatform('https://vimeo.com/123')).toBe('vimeo');
    expect(detectPlatform('https://player.vimeo.com/video/123')).toBe('vimeo');
    expect(detectPlatform('https://www.dailymotion.com/video/x123')).toBe(
      'dailymotion',
    );
    expect(detectPlatform('https://www.twitch.tv/clip/abc')).toBe('twitch');
  });

  it('returns generic for unknown hosts', () => {
    expect(detectPlatform('https://example.com/some-video')).toBe('generic');
  });

  it('returns generic for malformed URLs (no throw)', () => {
    expect(detectPlatform('not a url')).toBe('generic');
  });
});

describe('normalizeUrlForHash', () => {
  it('drops fragment', () => {
    expect(normalizeUrlForHash('https://youtu.be/abc#t=10')).not.toContain('#');
  });

  it('strips tracking params', () => {
    const out = normalizeUrlForHash(
      'https://youtu.be/abc?si=tracking_id&feature=share',
    );
    expect(out).not.toContain('si=');
    expect(out).not.toContain('feature=');
  });

  it('preserves t= (timestamp anchor)', () => {
    const out = normalizeUrlForHash('https://youtu.be/abc?t=120');
    expect(out).toContain('t=120');
  });

  it('preserves v= and list= (meaningful query)', () => {
    const out = normalizeUrlForHash(
      'https://www.youtube.com/watch?v=abc&list=PL1&utm_source=x',
    );
    expect(out).toContain('v=abc');
    expect(out).toContain('list=PL1');
    expect(out).not.toContain('utm_source');
  });

  it('lowercases hostname', () => {
    expect(normalizeUrlForHash('https://YOUTU.BE/abc')).toContain('youtu.be');
  });

  it('produces stable hash key regardless of param order', () => {
    const a = normalizeUrlForHash('https://x.com/?a=1&b=2');
    const b = normalizeUrlForHash('https://x.com/?b=2&a=1');
    expect(a).toBe(b);
  });
});

describe('extractVideoUrls', () => {
  it('extracts a single URL from plain text', () => {
    const out = extractVideoUrls('see https://youtu.be/abc');
    expect(out).toHaveLength(1);
    expect(out[0].url).toBe('https://youtu.be/abc');
    expect(out[0].platform).toBe('youtube');
    expect(out[0].pastedToken).toBe('https://youtu.be/abc');
  });

  it('strips trailing punctuation but preserves pastedToken as-is', () => {
    const out = extractVideoUrls('look at https://youtu.be/abc.');
    expect(out).toHaveLength(1);
    expect(out[0].url).toBe('https://youtu.be/abc');
    // pastedToken includes the trailing period as it appeared
    expect(out[0].pastedToken).toBe('https://youtu.be/abc.');
  });

  it('strips multiple trailing punctuation chars', () => {
    const out = extractVideoUrls('(https://youtu.be/abc).');
    expect(out[0].url).toBe('https://youtu.be/abc');
  });

  it('strips markdown emphasis', () => {
    const out = extractVideoUrls('*https://youtu.be/abc*');
    expect(out[0].url).toBe('https://youtu.be/abc');
  });

  it('skips URLs inside fenced code blocks', () => {
    const out = extractVideoUrls(
      'discussing this:\n```\nhttps://youtu.be/abc\n```\nshould skip',
    );
    expect(out).toHaveLength(0);
  });

  it('skips URLs inside inline code', () => {
    const out = extractVideoUrls('the URL `https://youtu.be/abc` is broken');
    expect(out).toHaveLength(0);
  });

  it('extracts URL from blockquote (legitimate forwarding)', () => {
    const out = extractVideoUrls('> https://youtu.be/abc');
    expect(out).toHaveLength(1);
  });

  it('caps at maxUrls=3 by default', () => {
    const text = [
      'https://youtu.be/a1',
      'https://youtu.be/b2',
      'https://youtu.be/c3',
      'https://youtu.be/d4',
      'https://youtu.be/e5',
    ].join(' ');
    const out = extractVideoUrls(text);
    expect(out).toHaveLength(3);
    expect(out.map((u) => u.url)).toEqual([
      'https://youtu.be/a1',
      'https://youtu.be/b2',
      'https://youtu.be/c3',
    ]);
  });

  it('respects custom maxUrls', () => {
    const out = extractVideoUrls(
      'https://youtu.be/a https://youtu.be/b https://youtu.be/c',
      { maxUrls: 2 },
    );
    expect(out).toHaveLength(2);
  });

  it('dedups by normalized URL (different tracking params, same video)', () => {
    const out = extractVideoUrls(
      'https://youtu.be/abc?si=x and https://youtu.be/abc?si=y',
    );
    expect(out).toHaveLength(1);
  });

  it('dedups same video at different timestamps as one (preserves first)', () => {
    // normalizeUrlForHash preserves t=, so these are NOT equal
    const out = extractVideoUrls(
      'https://youtu.be/abc?t=10 and https://youtu.be/abc?t=20',
    );
    expect(out).toHaveLength(2);
  });

  it('rejects http:// URLs', () => {
    const out = extractVideoUrls('http://youtu.be/abc');
    expect(out).toHaveLength(0);
  });

  it('rejects URLs that fail isSafeVideoUrl', () => {
    const out = extractVideoUrls(
      'https://localhost/abc and https://127.0.0.1/x and https://[::1]/y',
    );
    expect(out).toHaveLength(0);
  });

  it('rejects playlist URLs', () => {
    const out = extractVideoUrls('https://www.youtube.com/playlist?list=PL123');
    expect(out).toHaveLength(0);
  });

  it('accepts watch?v=X&list=Y (video-in-playlist)', () => {
    const out = extractVideoUrls(
      'https://www.youtube.com/watch?v=abc&list=PL123',
    );
    expect(out).toHaveLength(1);
  });

  it('handles empty / whitespace input', () => {
    expect(extractVideoUrls('')).toHaveLength(0);
    expect(extractVideoUrls('   \n\t  ')).toHaveLength(0);
  });

  it('extracts multiple URLs in one paste', () => {
    const out = extractVideoUrls(
      'check https://youtu.be/a and https://vimeo.com/123',
    );
    expect(out).toHaveLength(2);
    expect(out[0].platform).toBe('youtube');
    expect(out[1].platform).toBe('vimeo');
  });
});
