import { describe, expect, it } from 'vitest';

import { etagOf, respondWithEtag, type CachedEntry } from './etag';

function entry(body: string): CachedEntry {
  return {
    body,
    etag: etagOf(body),
    contentType: 'text/plain; charset=utf-8',
    cacheControl: 'public, max-age=300',
  };
}

describe('etagOf', () => {
  it('produces a strong-validator format', () => {
    const e = etagOf('hello');
    expect(e).toMatch(/^"[0-9a-f]{16}"$/);
  });

  it('is deterministic — identical input gives identical output', () => {
    expect(etagOf('hello')).toBe(etagOf('hello'));
  });

  it('differs by even a single byte change', () => {
    expect(etagOf('hello')).not.toBe(etagOf('hellp'));
  });
});

describe('respondWithEtag', () => {
  it('returns a 200 with body when If-None-Match is absent', async () => {
    const request = new Request('https://tale.dev/llms.txt');
    const response = respondWithEtag(request, entry('hello'));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('hello');
    expect(response.headers.get('etag')).toMatch(/^"[0-9a-f]{16}"$/);
    expect(response.headers.get('cache-control')).toBe('public, max-age=300');
  });

  it('returns 304 when If-None-Match equals the ETag', async () => {
    const e = entry('hello');
    const request = new Request('https://tale.dev/llms.txt', {
      headers: { 'if-none-match': e.etag },
    });
    const response = respondWithEtag(request, e);
    expect(response.status).toBe(304);
    expect(response.body).toBeNull();
    expect(response.headers.get('etag')).toBe(e.etag);
    // RFC 9110 §15.4.5: 304 must carry cache-control.
    expect(response.headers.get('cache-control')).toBe('public, max-age=300');
  });

  it('returns 200 when If-None-Match does not match', async () => {
    const e = entry('hello');
    const request = new Request('https://tale.dev/llms.txt', {
      headers: { 'if-none-match': '"stale"' },
    });
    const response = respondWithEtag(request, e);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('hello');
  });
});
