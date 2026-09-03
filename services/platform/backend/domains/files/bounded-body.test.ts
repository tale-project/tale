import { describe, expect, it } from 'vitest';

import { declaredContentLength, readBodyBounded } from './bounded-body.ts';
import { FileError } from './service.ts';

/**
 * The intake guard. Regression: sync/import downloads (and the direct upload
 * POST) buffered a whole body with `arrayBuffer()` and only then met the
 * 512 MB check in the blob store — a multi-GB vendor file was in the heap
 * before anything could refuse it.
 */

/** A body of `chunks`, counting how many were actually pulled. */
function streamOf(chunks: Uint8Array[]): {
  body: ReadableStream<Uint8Array>;
  pulled: () => number;
  cancelled: () => boolean;
} {
  let index = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index];
      if (chunk === undefined) {
        controller.close();
        return;
      }
      index++;
      controller.enqueue(chunk);
    },
    cancel() {
      cancelled = true;
    },
  });
  return { body, pulled: () => index, cancelled: () => cancelled };
}

const bytes = (n: number, fill = 7): Uint8Array => new Uint8Array(n).fill(fill);

describe('declaredContentLength', () => {
  it('reads a sane Content-Length and ignores garbage', () => {
    expect(declaredContentLength(new Headers({ 'content-length': '42' }))).toBe(
      42,
    );
    expect(declaredContentLength(new Headers())).toBeNull();
    expect(
      declaredContentLength(new Headers({ 'content-length': 'many' })),
    ).toBeNull();
    expect(
      declaredContentLength(new Headers({ 'content-length': '-1' })),
    ).toBeNull();
  });
});

describe('readBodyBounded', () => {
  it('reads a body under the cap whole', async () => {
    const source = streamOf([bytes(10, 1), bytes(5, 2)]);
    const out = await readBodyBounded(
      { headers: new Headers(), body: source.body },
      100,
    );
    expect(out.byteLength).toBe(15);
    expect(out[0]).toBe(1);
    expect(out[14]).toBe(2);
    expect(source.pulled()).toBe(2);
  });

  it('refuses an over-cap declared length WITHOUT reading a byte', async () => {
    const source = streamOf([bytes(10), bytes(10)]);
    const attempt = readBodyBounded(
      {
        headers: new Headers({ 'content-length': String(1024) }),
        body: source.body,
      },
      100,
    );
    await expect(attempt).rejects.toBeInstanceOf(FileError);
    await expect(attempt).rejects.toMatchObject({
      code: 'FILE_SIZE_INVALID',
      status: 413,
    });
    expect(source.pulled()).toBe(0);
    expect(source.cancelled()).toBe(true);
  });

  it('aborts a body that grows past the cap at the first chunk over it', async () => {
    // No Content-Length (chunked): 10 chunks of 40 bytes against a cap of
    // 100 — the third chunk crosses the line; the remaining seven are never
    // pulled into memory.
    const source = streamOf(Array.from({ length: 10 }, () => bytes(40)));
    const attempt = readBodyBounded(
      { headers: new Headers(), body: source.body },
      100,
    );
    await expect(attempt).rejects.toMatchObject({ code: 'FILE_SIZE_INVALID' });
    expect(source.pulled()).toBe(3);
    expect(source.cancelled()).toBe(true);
  });

  it('accepts a body of exactly the cap', async () => {
    const source = streamOf([bytes(60), bytes(40)]);
    const out = await readBodyBounded(
      { headers: new Headers({ 'content-length': '100' }), body: source.body },
      100,
    );
    expect(out.byteLength).toBe(100);
  });

  it('answers empty bytes for a missing body', async () => {
    const out = await readBodyBounded(
      { headers: new Headers(), body: null },
      100,
    );
    expect(out.byteLength).toBe(0);
  });

  it('works on a real Response', async () => {
    const response = new Response(new Uint8Array([1, 2, 3]));
    const out = await readBodyBounded(response, 100);
    expect([...out]).toEqual([1, 2, 3]);
  });
});
