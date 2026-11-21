import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  safeFetchBinary,
  safeFetchToFile,
  setSafeFetchResolverForTests,
} from './safe-fetch';

/**
 * A guarded fetch whose body goes to a file as it arrives. The crawler took
 * every page through a fetch that answered the body as one piece of memory,
 * and a document on a site may be 100 MiB: it was held three times over
 * before anything read it (tale-project/tale#4942). Everything but where
 * the body ends up is the binary fetch's: the request, the redirects, the
 * pinning, the cap and the words of a refusal.
 */

const ORIGIN = 'https://site.example.com';

let dir: string;
let target: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'safe-fetch-file-'));
  target = path.join(dir, 'body');
  setSafeFetchResolverForTests((hostname) =>
    hostname === 'site.example.com'
      ? Promise.resolve([{ address: '93.184.216.34', family: 4 }])
      : Promise.reject(new Error(`ENOTFOUND ${hostname}`)),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  setSafeFetchResolverForTests(null);
  rmSync(dir, { recursive: true, force: true });
});

/** A site that answers each fetch with the next response. */
function answering(...responses: Response[]) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
    const next = responses.shift();
    return next === undefined
      ? Promise.reject(new Error('unexpected extra fetch'))
      : Promise.resolve(next);
  });
}

/** A body of `chunks`, saying how many were asked for and whether it was
 * given back. */
function bodyOf(chunks: Uint8Array[]) {
  let pulled = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[pulled];
      if (chunk === undefined) {
        controller.close();
        return;
      }
      pulled += 1;
      controller.enqueue(chunk);
    },
    cancel() {
      cancelled = true;
    },
  });
  return { body, pulled: () => pulled, cancelled: () => cancelled };
}

const filled = (length: number, fill: number): Uint8Array =>
  new Uint8Array(length).fill(fill);

describe('safeFetchToFile', () => {
  it('writes the body to the file in order, and says how long it was', async () => {
    answering(
      new Response(bodyOf([filled(3, 1), filled(2, 2), filled(4, 3)]).body, {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/pdf', etag: '"v1"' },
      }),
    );

    const fetched = await safeFetchToFile(`${ORIGIN}/handbook.pdf`, target);

    expect(fetched).toMatchObject({
      status: 200,
      size: 9,
      finalUrl: `${ORIGIN}/handbook.pdf`,
    });
    expect(fetched.headers.get('etag')).toBe('"v1"');
    expect([...readFileSync(target)]).toEqual([1, 1, 1, 2, 2, 3, 3, 3, 3]);
  });

  it('leaves an empty file for an answer with no body', async () => {
    answering(new Response(null, { status: 304 }));

    const fetched = await safeFetchToFile(`${ORIGIN}/page`, target);

    expect(fetched).toMatchObject({ status: 304, size: 0 });
    expect(readFileSync(target).byteLength).toBe(0);
  });

  it('refuses a declared length over the cap, and makes no file', async () => {
    const source = bodyOf([filled(10, 1)]);
    answering(
      new Response(source.body, {
        status: 200,
        headers: { 'content-length': '2048' },
      }),
    );

    await expect(
      safeFetchToFile(`${ORIGIN}/large`, target, { maxResponseBytes: 1000 }),
    ).rejects.toMatchObject({
      kind: 'response_too_large',
      message: 'Response Content-Length 2048 exceeds limit 1000',
    });
    expect(existsSync(target)).toBe(false);
  });

  it('refuses a body that passes the cap as it arrives, and leaves no half-written file', async () => {
    const source = bodyOf(Array.from({ length: 10 }, () => filled(400, 1)));
    answering(new Response(source.body, { status: 200 }));

    await expect(
      safeFetchToFile(`${ORIGIN}/undeclared`, target, {
        maxResponseBytes: 1000,
      }),
    ).rejects.toMatchObject({
      kind: 'response_too_large',
      message: 'Response body exceeded limit 1000',
    });
    expect(source.pulled()).toBeLessThanOrEqual(4);
    expect(source.cancelled()).toBe(true);
    expect(existsSync(target)).toBe(false);
  });

  it('takes a body of exactly the cap', async () => {
    answering(
      new Response(bodyOf([filled(600, 1), filled(400, 2)]).body, {
        status: 200,
      }),
    );

    const fetched = await safeFetchToFile(`${ORIGIN}/exact`, target, {
      maxResponseBytes: 1000,
    });

    expect(fetched.size).toBe(1000);
  });

  it('leaves no file for a body that stops arriving', async () => {
    const stalled = (init: { signal: AbortSignal }) =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('partial'));
            init.signal.addEventListener('abort', () => {
              const error = new Error('This operation was aborted');
              error.name = 'AbortError';
              controller.error(error);
            });
          },
        }),
        { status: 200 },
      );
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) =>
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the stub is given the init it built
      Promise.resolve(stalled(init as { signal: AbortSignal })),
    );

    await expect(
      safeFetchToFile(`${ORIGIN}/drip`, target, { timeoutMs: 50 }),
    ).rejects.toMatchObject({ kind: 'timeout' });
    expect(existsSync(target)).toBe(false);
  });

  it('never writes over a file that is already there', async () => {
    writeFileSync(target, 'somebody else’s');
    answering(new Response('new', { status: 200 }));

    await expect(safeFetchToFile(`${ORIGIN}/page`, target)).rejects.toThrow(
      /EEXIST/,
    );
    expect(readFileSync(target, 'utf8')).toBe('somebody else’s');
  });

  it('follows a redirect inside the allowed hosts as the binary fetch does, and names where it ended', async () => {
    const hops = (): Response[] => [
      new Response(null, {
        status: 302,
        headers: { Location: `${ORIGIN}/moved.pdf` },
      }),
      new Response('%PDF-1.7', { status: 200 }),
    ];
    answering(...hops());
    const toFile = await safeFetchToFile(`${ORIGIN}/handbook.pdf`, target);
    vi.restoreAllMocks();
    answering(...hops());
    const toMemory = await safeFetchBinary(`${ORIGIN}/handbook.pdf`);

    expect(toFile.finalUrl).toBe(toMemory.finalUrl);
    expect(toFile.finalUrl).toBe(`${ORIGIN}/moved.pdf`);
    expect(readFileSync(target, 'utf8')).toBe(await toMemory.body.text());
  });

  it('refuses what the binary fetch refuses, before any request', async () => {
    const fetched = answering();

    await expect(
      safeFetchToFile('http://site.example.com/page', target, {
        httpsOnly: true,
      }),
    ).rejects.toMatchObject({ name: 'SafeFetchError' });
    expect(fetched).not.toHaveBeenCalled();
    expect(existsSync(target)).toBe(false);
  });
});
