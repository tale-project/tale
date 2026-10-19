import { afterEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
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

/** What the work says through `console.warn`, so that a test can read it. */
async function warned<T>(
  work: () => Promise<T>,
): Promise<{ result: T; warnings: string }> {
  const original = console.warn;
  const warnings: string[] = [];
  console.warn = (...args: unknown[]) => {
    warnings.push(args.join(' '));
  };
  try {
    return { result: await work(), warnings: warnings.join('\n') };
  } finally {
    console.warn = original;
  }
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

  test('refuses a download that is not the pinned binary, and says so', async () => {
    const directory = cache();
    const get = (() =>
      Promise.resolve(new Response(BYTES))) as unknown as typeof fetch;
    const { result, warnings } = await warned(() =>
      pinnedRunner(directory, LINUX, get),
    );
    expect(result).toBeUndefined();
    expect(warnings).toContain('not the pinned runner');
    expect(createHash('sha256').update(BYTES).digest('hex')).not.toBe(
      RUNNER.linuxAmd64Sha256,
    );
  });

  test('says why when the download fails, by status or by error', async () => {
    const refused = (() =>
      Promise.resolve(
        new Response('', { status: 503 }),
      )) as unknown as typeof fetch;
    const status = await warned(() => pinnedRunner(cache(), LINUX, refused));
    expect(status.result).toBeUndefined();
    expect(status.warnings).toContain('answered 503');
    const failing = (() =>
      Promise.reject(new Error('offline'))) as unknown as typeof fetch;
    const error = await warned(() => pinnedRunner(cache(), LINUX, failing));
    expect(error.result).toBeUndefined();
    expect(error.warnings).toContain('offline');
  });

  test('takes nothing from a cache another user could write to, or a link', async () => {
    let asked = false;
    const get = (() => {
      asked = true;
      return Promise.resolve(new Response(BYTES));
    }) as unknown as typeof fetch;
    const open = cache();
    chmodSync(open, 0o755);
    const shared = await warned(() => pinnedRunner(open, LINUX, get));
    expect(shared.result).toBeUndefined();
    expect(shared.warnings).toContain('only this user can use');

    const target = cache();
    const link = join(cache(), 'link');
    symlinkSync(target, link);
    const linked = await warned(() => pinnedRunner(link, LINUX, get));
    expect(linked.result).toBeUndefined();
    expect(linked.warnings).toContain('only this user can use');
    expect(asked).toBe(false);
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
    const { result, warnings } = await warned(() =>
      pinnedRunner(directory, LINUX, get),
    );
    expect(result).toBeUndefined();
    expect(warnings).toContain('answered 404');
    expect(readFileSync(path)).toEqual(Buffer.from(BYTES));
    expect(statSync(path).size).toBe(BYTES.length);
  });
});
