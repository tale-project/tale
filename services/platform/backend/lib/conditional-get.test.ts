// @vitest-environment node

import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import {
  conditionalGet,
  entityTagOf,
  ifNoneMatchMatches,
  VALIDATED_READ_CACHE_CONTROL,
} from './conditional-get.ts';

/**
 * Nothing on either JSON door could be revalidated: `/api/v1` said
 * `no-store` on every answer and `/api/app` said nothing, and neither
 * carried a validator, so every poll of an unchanged resource moved the
 * whole body again. These pin the validated-read contract: the tag, the
 * 304, the directive, and everything that must be left alone.
 */

let counter = 0;

function app(options?: Parameters<typeof conditionalGet>[0]) {
  const hono = new Hono();
  hono.use(async (c, next) => {
    await next();
    c.res.headers.set('x-request-id', 'req-1');
  });
  hono.use('/api/*', conditionalGet(options));
  hono.get('/api/v1/runs/:id', (c) => {
    c.header('cache-control', 'no-store');
    return c.json({ id: c.req.param('id'), status: 'success' });
  });
  hono.get('/api/app/threads', (c) => c.json({ threads: [{ id: 't1' }] }));
  hono.get('/api/app/counter', (c) => c.json({ n: (counter += 1) }));
  hono.get('/api/app/secret', (c) => {
    c.header('cache-control', 'no-store');
    return c.json({ token: 's3cr3t' });
  });
  hono.get('/api/app/hashed', (c) => {
    c.header('etag', '"route-owned"');
    return c.json({ content: 'x' });
  });
  hono.get('/api/app/stream', (c) =>
    c.body('data: hi\n\n', 200, { 'content-type': 'text/event-stream' }),
  );
  hono.get('/api/app/blob', (c) =>
    c.body('bytes', 200, { 'content-type': 'application/octet-stream' }),
  );
  hono.get('/api/app/download', (c) =>
    c.body('{"stored":true}', 200, {
      'content-type': 'application/json',
      'content-disposition': 'attachment; filename="data.json"',
    }),
  );
  hono.get('/api/app/missing', (c) =>
    c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404),
  );
  hono.post('/api/app/threads', (c) => c.json({ id: 't2' }, 201));
  return hono;
}

describe('a 200 JSON read', () => {
  it('leaves with a strong ETag over its bytes, its length, and the validated-read directive', async () => {
    const res = await app().request('http://localhost/api/app/threads');
    const body = await res.text();
    expect(res.status).toBe(200);
    expect(res.headers.get('etag')).toBe(
      entityTagOf(new TextEncoder().encode(body)),
    );
    expect(res.headers.get('content-length')).toBe(
      String(new TextEncoder().encode(body).byteLength),
    );
    expect(res.headers.get('cache-control')).toBe(VALIDATED_READ_CACHE_CONTROL);
    expect(JSON.parse(body)).toEqual({ threads: [{ id: 't1' }] });
  });

  it('answers the same tag for the same bytes and a new one for new bytes', async () => {
    const first = await app().request('http://localhost/api/app/threads');
    const second = await app().request('http://localhost/api/app/threads');
    expect(second.headers.get('etag')).toBe(first.headers.get('etag'));
    const a = await app().request('http://localhost/api/app/counter');
    const b = await app().request('http://localhost/api/app/counter');
    expect(b.headers.get('etag')).not.toBe(a.headers.get('etag'));
  });

  it('answers 304 to a HEAD that presents the tag', async () => {
    const get = await app().request('http://localhost/api/app/threads');
    const res = await app().request('http://localhost/api/app/threads', {
      method: 'HEAD',
      headers: { 'if-none-match': get.headers.get('etag') ?? '' },
    });
    expect(res.status).toBe(304);
    expect(await res.text()).toBe('');
  });

  it('carries the same validator on HEAD', async () => {
    const get = await app().request('http://localhost/api/app/threads');
    const head = await app().request('http://localhost/api/app/threads', {
      method: 'HEAD',
    });
    expect(head.status).toBe(200);
    expect(head.headers.get('etag')).toBe(get.headers.get('etag'));
    expect(head.headers.get('content-length')).toBe(
      get.headers.get('content-length'),
    );
    expect(await head.text()).toBe('');
  });
});

describe('a matching If-None-Match', () => {
  it('answers 304 with the validator, the directive and the request id, and no body framing', async () => {
    const first = await app().request('http://localhost/api/app/threads');
    const etag = first.headers.get('etag') ?? '';
    const res = await app().request('http://localhost/api/app/threads', {
      headers: { 'if-none-match': etag },
    });
    expect(res.status).toBe(304);
    expect(await res.text()).toBe('');
    expect(res.headers.get('etag')).toBe(etag);
    expect(res.headers.get('cache-control')).toBe(VALIDATED_READ_CACHE_CONTROL);
    expect(res.headers.get('x-request-id')).toBe('req-1');
    expect(res.headers.get('content-type')).toBeNull();
    expect(res.headers.get('content-length')).toBeNull();
  });

  it.each([
    ['the weak form', (t: string) => `W/${t}`],
    [
      'the gzip-suffixed form the compressing edge hands out',
      (t: string) => t.replace(/"$/, '-gzip"'),
    ],
    [
      'the zstd-suffixed form inside a list',
      (t: string) => `"stale", ${t.replace(/"$/, '-zstd"')}`,
    ],
    ['a list naming it', (t: string) => `"stale", ${t}`],
    ['a list naming it weakly', (t: string) => `"stale", W/${t}`],
    ['the wildcard', () => '*'],
  ])('matches %s', async (_label, present) => {
    const first = await app().request('http://localhost/api/app/threads');
    const etag = first.headers.get('etag') ?? '';
    const res = await app().request('http://localhost/api/app/threads', {
      headers: { 'if-none-match': present(etag) },
    });
    expect(res.status).toBe(304);
  });

  it('is compared against a validator the route computed itself', async () => {
    const res = await app().request('http://localhost/api/app/hashed', {
      headers: { 'if-none-match': '"route-owned"' },
    });
    expect(res.status).toBe(304);
    expect(res.headers.get('etag')).toBe('"route-owned"');
  });
});

describe('a stale or absent If-None-Match', () => {
  it.each(['"other"', '"a", "b"', 'W/"other"', ''])(
    'answers the full 200 for %j',
    async (present) => {
      const res = await app().request('http://localhost/api/app/threads', {
        headers: { 'if-none-match': present },
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ threads: [{ id: 't1' }] });
    },
  );
});

describe('Cache-Control', () => {
  it("replaces the door's default and nothing else", async () => {
    const door = await app({ replaceDoorDefault: 'no-store' }).request(
      'http://localhost/api/v1/runs/r1',
    );
    expect(door.headers.get('cache-control')).toBe(
      VALIDATED_READ_CACHE_CONTROL,
    );
    expect(door.headers.get('etag')).not.toBeNull();
  });

  it("keeps a route's own directive", async () => {
    const res = await app().request('http://localhost/api/app/secret');
    expect(res.headers.get('cache-control')).toBe('no-store');
    // The validator still rides: a client that kept the body in memory may
    // ask, and the door's own directive still forbids storing it.
    expect(res.headers.get('etag')).not.toBeNull();
  });
});

describe('everything that is not a JSON read', () => {
  it.each([
    ['an event stream', '/api/app/stream', 'text/event-stream'],
    ['a download', '/api/app/blob', 'application/octet-stream'],
    [
      'a stored JSON file served as a download',
      '/api/app/download',
      'application/json',
    ],
  ])('leaves %s untouched', async (_label, path, type) => {
    const res = await app().request(`http://localhost${path}`, {
      headers: { 'if-none-match': '*' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain(type);
    expect(res.headers.get('etag')).toBeNull();
    expect(res.headers.get('cache-control')).toBeNull();
  });

  it('leaves an error untouched', async () => {
    const res = await app().request('http://localhost/api/app/missing', {
      headers: { 'if-none-match': '*' },
    });
    expect(res.status).toBe(404);
    expect(res.headers.get('etag')).toBeNull();
    expect(res.headers.get('cache-control')).toBeNull();
  });

  it('leaves a write untouched', async () => {
    const res = await app().request('http://localhost/api/app/threads', {
      method: 'POST',
      headers: { 'if-none-match': '*' },
    });
    expect(res.status).toBe(201);
    expect(res.headers.get('etag')).toBeNull();
  });
});

describe('ifNoneMatchMatches', () => {
  it('compares weakly, per member, and never matches an empty member', () => {
    expect(ifNoneMatchMatches('"a-gzip"', '"a"')).toBe(true);
    expect(ifNoneMatchMatches('"a-zstd", "b"', '"a"')).toBe(true);
    expect(ifNoneMatchMatches('"a-png"', '"a"')).toBe(false);
    expect(ifNoneMatchMatches('"a"', '"a"')).toBe(true);
    expect(ifNoneMatchMatches('W/"a"', '"a"')).toBe(true);
    expect(ifNoneMatchMatches('"a"', 'W/"a"')).toBe(true);
    expect(ifNoneMatchMatches('"b", "a"', '"a"')).toBe(true);
    expect(ifNoneMatchMatches('"b"', '"a"')).toBe(false);
    expect(ifNoneMatchMatches('', '"a"')).toBe(false);
    expect(ifNoneMatchMatches(',', '""')).toBe(false);
    expect(ifNoneMatchMatches('*', '"anything"')).toBe(true);
  });
});
