import { afterEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { RUNNER, pinnedRunner } from './runner';

const LINUX = { os: 'linux', arch: 'x64' };
const temporary: string[] = [];

afterEach(() => {
  for (const directory of temporary.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function cache(): string {
  const directory = mkdtempSync(join(tmpdir(), 'forgejo-runner-test-'));
  temporary.push(directory);
  return directory;
}

/** A download whose bytes hash to the pin: the test pins its own digest for the fake binary. */
const BYTES = new TextEncoder().encode('not really a runner');

describe('pinnedRunner', () => {
  test('pins the amd64 build of the version ops runs', () => {
    expect(RUNNER.version).toBe('13.2.0');
    expect(RUNNER.linuxAmd64Sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  test('has nothing to give on a platform the pin does not cover', async () => {
    let asked = false;
    const get = (() => {
      asked = true;
      return Promise.reject(new Error('never'));
    }) as unknown as typeof fetch;
    expect(
      await pinnedRunner(cache(), { os: 'darwin', arch: 'arm64' }, get),
    ).toBeUndefined();
    expect(
      await pinnedRunner(cache(), { os: 'linux', arch: 'arm64' }, get),
    ).toBeUndefined();
    expect(asked).toBe(false);
  });

  test('refuses a download that is not the pinned binary', async () => {
    const directory = cache();
    const get = (() =>
      Promise.resolve(new Response(BYTES))) as unknown as typeof fetch;
    expect(await pinnedRunner(directory, LINUX, get)).toBeUndefined();
    expect(createHash('sha256').update(BYTES).digest('hex')).not.toBe(
      RUNNER.linuxAmd64Sha256,
    );
  });

  test('says nothing but returns nothing when the download fails', async () => {
    const get = (() =>
      Promise.resolve(
        new Response('', { status: 503 }),
      )) as unknown as typeof fetch;
    expect(await pinnedRunner(cache(), LINUX, get)).toBeUndefined();
    const warnings: unknown[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args);
    try {
      const failing = (() =>
        Promise.reject(new Error('offline'))) as unknown as typeof fetch;
      expect(await pinnedRunner(cache(), LINUX, failing)).toBeUndefined();
    } finally {
      console.warn = original;
    }
    expect(JSON.stringify(warnings)).toContain('offline');
  });

  test('downloads the binary once, checks it against the digest and makes it executable', async () => {
    const directory = cache();
    const digest = createHash('sha256').update(BYTES).digest('hex');
    let fetched = 0;
    const get = (() => {
      fetched += 1;
      return Promise.resolve(new Response(BYTES));
    }) as unknown as typeof fetch;
    const path = await pinnedRunner(directory, LINUX, get, digest);
    expect(path).toBe(
      join(directory, `forgejo-runner-${RUNNER.version}-linux-amd64`),
    );
    expect(statSync(path ?? '').mode & 0o111).not.toBe(0);
    expect(await pinnedRunner(directory, LINUX, get, digest)).toBe(path);
    expect(fetched).toBe(1);
  });

  test('reuses a binary it already holds, and replaces one that is not the pin', async () => {
    const directory = cache();
    const path = join(
      directory,
      `forgejo-runner-${RUNNER.version}-linux-amd64`,
    );
    // a binary of the wrong digest is not trusted: it is fetched again, and the fetch fails here
    writeFileSync(path, BYTES);
    const get = (() =>
      Promise.resolve(
        new Response('', { status: 404 }),
      )) as unknown as typeof fetch;
    expect(await pinnedRunner(directory, LINUX, get)).toBeUndefined();
    expect(readFileSync(path)).toEqual(Buffer.from(BYTES));
    expect(statSync(path).size).toBe(BYTES.length);
  });
});
