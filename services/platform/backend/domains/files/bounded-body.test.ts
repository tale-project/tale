import { existsSync, readFileSync } from 'node:fs';

import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  startTestStore,
  type TestStore,
} from '../../core/lib/storage/object_store.test-helpers.ts';
import type { S3ObjectStore } from '../../core/lib/storage/object_store.ts';
import { newJobDir, removeJobDir } from '../../lib/heavy-slot/job-dir.ts';
import {
  declaredContentLength,
  readBodyBounded,
  storeBodyBounded,
} from './bounded-body.ts';
import { FileError, MAX_UPLOAD_BYTES } from './service.ts';

/** The store an organization's uploads land in, set by each test. */
const organization: { store?: S3ObjectStore } = {};

vi.mock('../../lib/org-config.ts', () => ({
  resolveOrgSlug: vi.fn(() => Promise.resolve('acme')),
}));
vi.mock('../../lib/object-store.ts', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../lib/object-store.ts')>();
  return {
    ...actual,
    resolveObjectStore: vi.fn(() =>
      organization.store === undefined
        ? Promise.reject(new Error('no store in this test'))
        : Promise.resolve(organization.store),
    ),
  };
});
// The real directories, counted: a body that declares its length must never
// touch the disk, and one that does must leave nothing on it.
vi.mock('../../lib/heavy-slot/job-dir.ts', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../lib/heavy-slot/job-dir.ts')>();
  return {
    ...actual,
    newJobDir: vi.fn(actual.newJobDir),
    removeJobDir: vi.fn(actual.removeJobDir),
  };
});

/**
 * The intake guard. Regression: sync/import downloads (and the direct upload
 * POST) buffered a whole body with `arrayBuffer()` and only then met the
 * 512 MB check in the blob store — a multi-GB vendor file was in the heap
 * before anything could refuse it.
 */

/** A body of `chunks`, counting how many were actually pulled; after the
 * last one it ends, or fails the way a sender that went away does. */
function streamOf(
  chunks: Uint8Array[],
  then: 'end' | Error = 'end',
): {
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
        if (then === 'end') controller.close();
        else controller.error(then);
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

describe('storeBodyBounded — a body landed in the store without being held', () => {
  let target: TestStore;
  beforeEach(async () => {
    target = await startTestStore();
    organization.store = target.store;
  });
  afterEach(async () => {
    await target.close();
    delete organization.store;
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the organization's slug and store are mocked above; no query runs
  const sql = {} as Sql;

  const land = (
    source: { headers: Headers; body: ReadableStream<Uint8Array> | null },
    more: Partial<Parameters<typeof storeBodyBounded>[3]> = {},
  ) =>
    storeBodyBounded(sql, 'org_1', source, {
      maxBytes: 100,
      contentType: 'text/plain',
      ...more,
    });

  const declaring = (length: number): Headers =>
    new Headers({ 'content-length': String(length) });

  /** What the store holds under a ref this door answered. */
  const kept = (storageRef: string) =>
    target.objects.get(storageRef.slice('s3:'.length));

  /** Every directory this door made is gone again. */
  function expectNoFileLeftBehind(): void {
    const made = vi.mocked(newJobDir).mock.results;
    expect(vi.mocked(removeJobDir)).toHaveBeenCalledTimes(made.length);
    for (const call of vi.mocked(removeJobDir).mock.calls) {
      expect(existsSync(call[0])).toBe(false);
    }
  }

  it('sends a body that declares its length straight to the store [FILE-R11]', async () => {
    const source = streamOf([bytes(10, 1), bytes(5, 2)]);

    const stored = await land({ headers: declaring(15), body: source.body });

    expect(stored.size).toBe(15);
    expect(stored.storageRef).toMatch(/^s3:acme\/[0-9a-f-]{36}$/);
    expect(kept(stored.storageRef)).toEqual({
      bytes: Buffer.concat([bytes(10, 1), bytes(5, 2)]),
      contentType: 'text/plain',
    });
    // Nothing of it went to this process's disk on the way.
    expect(newJobDir).not.toHaveBeenCalled();
  });

  it('refuses a declared length over the cap without reading a byte [FILE-R11]', async () => {
    const source = streamOf([bytes(10), bytes(10)]);
    const attempt = land({ headers: declaring(1024), body: source.body });

    await expect(attempt).rejects.toMatchObject({
      code: 'FILE_SIZE_INVALID',
      status: 413,
      message: expect.stringMatching(/^The file is 1024 bytes; the limit is /),
    });
    expect(source.pulled()).toBe(0);
    expect(source.cancelled()).toBe(true);
    expect(target.puts).toHaveLength(0);
  });

  it('accepts a body of exactly the cap [FILE-R11]', async () => {
    const stored = await land({
      headers: declaring(100),
      body: streamOf([bytes(60), bytes(40)]).body,
    });
    expect(kept(stored.storageRef)?.bytes.byteLength).toBe(100);
  });

  it('accepts a body of exactly the cap that declared no length [FILE-R11]', async () => {
    const stored = await land({
      headers: new Headers(),
      body: streamOf([bytes(60), bytes(40)]).body,
    });
    expect(kept(stored.storageRef)?.bytes.byteLength).toBe(100);
  });

  it('writes a body that declares no length to a file, and stores it from there', async () => {
    const source = streamOf([bytes(10, 1), bytes(20, 2), bytes(30, 3)]);

    const stored = await land({ headers: new Headers(), body: source.body });

    expect(stored.size).toBe(60);
    expect(kept(stored.storageRef)?.bytes).toEqual(
      Buffer.concat([bytes(10, 1), bytes(20, 2), bytes(30, 3)]),
    );
    // The store was told the length the file turned out to have.
    expect(target.puts[0]?.headers['content-length']).toBe('60');
    expect(newJobDir).toHaveBeenCalledTimes(1);
    expectNoFileLeftBehind();
  });

  it('refuses a body that declares no length at the first chunk past the cap [FILE-R11]', async () => {
    // 10 chunks of 40 bytes against a cap of 100: the third crosses the
    // line, and the rest are never asked for.
    const source = streamOf(Array.from({ length: 10 }, () => bytes(40)));
    const attempt = land({ headers: new Headers(), body: source.body });

    await expect(attempt).rejects.toMatchObject({
      code: 'FILE_SIZE_INVALID',
      status: 413,
      message: expect.stringMatching(/^The file exceeds the .+ limit$/),
    });
    expect(source.pulled()).toBeLessThanOrEqual(4);
    expect(source.cancelled()).toBe(true);
    expect(target.puts).toHaveLength(0);
    expectNoFileLeftBehind();
  });

  // `fetch` hands out a compressed response decoded, beside the length it
  // had compressed: sent on under that length, the file would be cut short
  // or refused as too long.
  it("does not take a compressed response's declared length for the body's", async () => {
    const headers = declaring(5);
    headers.set('content-encoding', 'gzip');

    const stored = await land({
      headers,
      body: streamOf([bytes(12), bytes(8)]).body,
    });

    expect(stored.size).toBe(20);
    expect(kept(stored.storageRef)?.bytes.byteLength).toBe(20);
    expect(newJobDir).toHaveBeenCalledTimes(1);
    expectNoFileLeftBehind();
  });

  it('lets a lane look at the whole body, as a file, before it is stored', async () => {
    const seen: { size: number; content: Buffer }[] = [];

    const stored = await land(
      {
        headers: declaring(6),
        body: streamOf([bytes(2, 1), bytes(4, 2)]).body,
      },
      {
        inspect: (file) => {
          // Nothing has been sent to the store while the lane looks.
          expect(target.puts).toHaveLength(0);
          seen.push({ size: file.size, content: readFileSync(file.path) });
          return Promise.resolve();
        },
      },
    );

    expect(seen).toEqual([
      { size: 6, content: Buffer.concat([bytes(2, 1), bytes(4, 2)]) },
    ]);
    expect(kept(stored.storageRef)?.bytes.byteLength).toBe(6);
    expectNoFileLeftBehind();
  });

  it('stores nothing of a body its lane refuses', async () => {
    const refusal = new FileError('FILE_NOT_A_PDF', 'These bytes are no PDF');
    const attempt = land(
      { headers: declaring(6), body: streamOf([bytes(6)]).body },
      { inspect: () => Promise.reject(refusal) },
    );

    await expect(attempt).rejects.toBe(refusal);
    expect(target.puts).toHaveLength(0);
    expectNoFileLeftBehind();
  });

  // An empty answer is the lane's to name: a conversion that came back with
  // nothing is "not a PDF", in that lane's words, before it is "no file".
  it.each([
    ['no body at all', () => ({ headers: new Headers(), body: null })],
    [
      'a declared length of nothing',
      () => ({ headers: declaring(0), body: streamOf([]).body }),
    ],
  ])('shows a lane that looks at its bodies %s', async (_name, source) => {
    const sizes: number[] = [];
    const refusal = new FileError('FILE_NOT_A_PDF', 'These bytes are no PDF');
    const attempt = land(source(), {
      inspect: (file) => {
        sizes.push(file.size);
        return Promise.reject(refusal);
      },
    });

    await expect(attempt).rejects.toBe(refusal);
    expect(sizes).toEqual([0]);
    expect(target.puts).toHaveLength(0);
    expectNoFileLeftBehind();
  });

  it('refuses an empty body that its lane let pass as no file', async () => {
    const attempt = land(
      { headers: new Headers(), body: streamOf([]).body },
      { inspect: () => Promise.resolve() },
    );

    await expect(attempt).rejects.toMatchObject({
      code: 'FILE_SIZE_INVALID',
      status: 400,
      message: 'Invalid blob size',
    });
    expect(target.puts).toHaveLength(0);
    expectNoFileLeftBehind();
  });

  it.each([
    ['no body at all', () => ({ headers: new Headers(), body: null })],
    [
      'a declared length of nothing',
      () => ({ headers: declaring(0), body: streamOf([]).body }),
    ],
    [
      'no length and no bytes',
      () => ({ headers: new Headers(), body: streamOf([]).body }),
    ],
  ])('refuses %s as no file', async (_name, source) => {
    await expect(land(source())).rejects.toMatchObject({
      code: 'FILE_SIZE_INVALID',
      status: 400,
      message: 'Invalid blob size',
    });
    expect(target.puts).toHaveLength(0);
    expectNoFileLeftBehind();
  });

  it('stores nothing when the sender stops before the bytes it declared [FILE-R12]', async () => {
    const source = streamOf([bytes(30), bytes(30)], new Error('aborted'));
    const attempt = land({ headers: declaring(100), body: source.body });

    await expect(attempt).rejects.toMatchObject({
      code: 'FILE_SIZE_INVALID',
      status: 400,
      message: 'The file stopped arriving before the 100 bytes it declared',
    });
    await vi.waitFor(() =>
      expect(target.puts.every((sent) => sent.dropped)).toBe(true),
    );
    expect(target.objects.size).toBe(0);
  });

  it('stores nothing when a body ends short of the bytes it declared [FILE-R12]', async () => {
    const attempt = land({
      headers: declaring(100),
      body: streamOf([bytes(60), bytes(30)]).body,
    });

    await expect(attempt).rejects.toMatchObject({
      code: 'FILE_SIZE_INVALID',
      status: 400,
      message: 'The file stopped arriving before the 100 bytes it declared',
    });
    expect(target.objects.size).toBe(0);
  });

  it('stores nothing when a sender that declared no length stops [FILE-R12]', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const source = streamOf([bytes(30)], new Error('aborted'));
    const attempt = land({ headers: new Headers(), body: source.body });

    await expect(attempt).rejects.toMatchObject({
      code: 'FILE_SIZE_INVALID',
      status: 400,
      message: 'The file stopped arriving before it was whole',
    });
    expect(target.puts).toHaveLength(0);
    expectNoFileLeftBehind();
  });

  it('treats a sender that is gone as one that stopped [FILE-R12]', async () => {
    const browser = new AbortController();
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        if (pulled === 1) {
          controller.enqueue(bytes(10));
          return undefined;
        }
        // The rest never comes; the browser is closed a moment later.
        setTimeout(() => browser.abort(new Error('the tab was closed')), 20);
        return new Promise<void>(() => {});
      },
    });
    const attempt = land(
      { headers: declaring(100), body },
      { signal: browser.signal },
    );

    await expect(attempt).rejects.toMatchObject({
      code: 'FILE_SIZE_INVALID',
      message: 'The file stopped arriving before the 100 bytes it declared',
    });
    expect(target.objects.size).toBe(0);
  });

  it('refuses a body that goes on past the bytes it declared', async () => {
    const attempt = land({
      headers: declaring(50),
      body: streamOf([bytes(30), bytes(20), bytes(1)]).body,
    });

    await expect(attempt).rejects.toMatchObject({
      code: 'FILE_SIZE_INVALID',
      status: 400,
      message: 'The file went on past the 50 bytes it declared',
    });
    expect(target.objects.size).toBe(0);
  });

  it("answers a store that does not take the file as unavailable, and keeps the store's words for the log [FILE-R7]", async () => {
    const logged = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    target.behave = {
      refuse: {
        status: 507,
        code: 'XMinioStorageFull',
        message:
          'Storage backend has reached its minimum free drive threshold.',
      },
    };
    const attempt = land({
      headers: declaring(10),
      body: streamOf([bytes(10)]).body,
    });

    await expect(attempt).rejects.toMatchObject({
      code: 'OBJECT_STORE_UNAVAILABLE',
      status: 503,
    });
    expect(String(logged.mock.calls[0]?.[1])).toContain('XMinioStorageFull');
  });

  it("refuses a file over the platform's largest, whatever its lane would take", async () => {
    const source = streamOf([bytes(10)]);
    const attempt = land(
      { headers: declaring(MAX_UPLOAD_BYTES + 1), body: source.body },
      { maxBytes: MAX_UPLOAD_BYTES * 2 },
    );

    await expect(attempt).rejects.toMatchObject({
      code: 'FILE_SIZE_INVALID',
      message: 'Invalid blob size',
    });
    expect(target.puts).toHaveLength(0);
    expect(source.cancelled()).toBe(true);
  });
});
