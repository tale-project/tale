// Unit coverage for the pure GET/PUT stream helpers that the connector
// suite intentionally skips (streamed paths). Locks in the Range math,
// weak-ETag handling, and — critically — the PUT cap's backpressure +
// 413 mapping (the lone "critical" review finding).

import { describe, expect, it } from 'vitest';

import {
  computeETag,
  ifNoneMatchMatches,
  ifRangeMatches,
  parseRangeHeader,
} from './methods/get';
import { wrapWithCap } from './methods/put';

async function readAll(
  stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      parts.push(value);
      total += value.byteLength;
    }
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.byteLength;
  }
  return out;
}

describe('ifRangeMatches', () => {
  const lastModified = new Date('2026-01-01T00:00:00Z');

  it('matches a strong ETag that equals the current strong validator', () => {
    expect(ifRangeMatches('"abc123"', '"abc123"', lastModified)).toBe(true);
  });

  it('does not match a different strong ETag (stale → serve full 200)', () => {
    expect(ifRangeMatches('"old"', '"abc123"', lastModified)).toBe(false);
  });

  it('never matches when either side is a weak validator (RFC 7233 strong comparison)', () => {
    expect(ifRangeMatches('W/"abc"', 'W/"abc"', lastModified)).toBe(false);
    expect(ifRangeMatches('"abc"', 'W/"abc"', lastModified)).toBe(false);
    expect(ifRangeMatches('W/"abc"', '"abc"', lastModified)).toBe(false);
  });

  it('matches an HTTP-date >= Last-Modified, rejects an older date', () => {
    expect(
      ifRangeMatches('Thu, 01 Jan 2026 00:00:00 GMT', '"x"', lastModified),
    ).toBe(true);
    expect(
      ifRangeMatches('Wed, 31 Dec 2025 00:00:00 GMT', '"x"', lastModified),
    ).toBe(false);
  });

  it('rejects an unparseable If-Range value', () => {
    expect(ifRangeMatches('not-a-date-or-etag', '"x"', lastModified)).toBe(
      false,
    );
  });
});

describe('parseRangeHeader', () => {
  it('parses a closed range', () => {
    expect(parseRangeHeader('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 });
  });
  it('clamps end to size-1', () => {
    expect(parseRangeHeader('bytes=0-100000', 1000)).toEqual({
      start: 0,
      end: 999,
    });
  });
  it('handles a suffix range', () => {
    expect(parseRangeHeader('bytes=-100', 1000)).toEqual({
      start: 900,
      end: 999,
    });
  });
  it('handles an open-ended range', () => {
    expect(parseRangeHeader('bytes=500-', 1000)).toEqual({
      start: 500,
      end: 999,
    });
  });
  it('flags an out-of-bounds start as unsatisfiable', () => {
    expect(parseRangeHeader('bytes=2000-', 1000)).toBe('unsatisfiable');
  });
  it('ignores a null/garbage header', () => {
    expect(parseRangeHeader(null, 1000)).toBeNull();
    expect(parseRangeHeader('items=0-9', 1000)).toBeNull();
  });
});

describe('computeETag', () => {
  it('emits a strong validator (quoted) from contentHash', () => {
    expect(computeETag({ contentHash: 'deadbeef' })).toBe('"deadbeef"');
  });
  it('emits a weak validator from size + mtime when no hash', () => {
    expect(computeETag({ size: 10, sourceModifiedAt: 5 })).toBe('W/"10-5"');
  });
});

describe('ifNoneMatchMatches', () => {
  it('* matches any representation', () => {
    expect(ifNoneMatchMatches('*', '"abc"')).toBe(true);
  });
  it('weak-compares (ignores the W/ marker)', () => {
    expect(ifNoneMatchMatches('W/"abc"', '"abc"')).toBe(true);
  });
  it('does not match a different tag', () => {
    expect(ifNoneMatchMatches('"xyz"', '"abc"')).toBe(false);
  });
});

describe('wrapWithCap', () => {
  it('passes the body through under the cap and reports the size', async () => {
    const src = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array([1, 2, 3]));
        c.enqueue(new Uint8Array([4, 5]));
        c.close();
      },
    });
    const { body, sizeOf } = wrapWithCap(src, 100);
    expect(body).not.toBeNull();
    const bytes = await readAll(body as ReadableStream<Uint8Array>);
    expect(Array.from(bytes)).toEqual([1, 2, 3, 4, 5]);
    expect(sizeOf()).toBe(5);
  });

  it('errors with WebDAVBodyTooLarge once the cap is exceeded', async () => {
    const src = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array(10));
        c.enqueue(new Uint8Array(10));
        c.close();
      },
    });
    const { body } = wrapWithCap(src, 15);
    await expect(readAll(body as ReadableStream<Uint8Array>)).rejects.toThrow(
      /exceeds 15 bytes/,
    );
  });

  it('is pull-based: it does not drain an infinite source ahead of the consumer (backpressure)', async () => {
    let produced = 0;
    const src = new ReadableStream<Uint8Array>({
      pull(c) {
        produced++;
        c.enqueue(new Uint8Array(1));
      },
    });
    const { body } = wrapWithCap(src, 1_000_000);
    const reader = (body as ReadableStream<Uint8Array>).getReader();
    await reader.read();
    await reader.read();
    // A start()-loop would have drained the infinite source unboundedly
    // (the critical bug). The pull source produces ~one chunk per consumer
    // read plus a tiny prefetch window.
    expect(produced).toBeLessThan(10);
    await reader.cancel();
  });
});
