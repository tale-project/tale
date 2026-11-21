import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  APP_FILES_PROGRAM,
  deliveryFaults,
  parseAppFiles,
  parseDelivery,
} from '../../../services/platform/tests/integration/lib/delivery';

// The container smoke test asks the real edge how the app's files travel
// (services/platform/tests/integration/container-smoke-test.ts). It needs
// Docker; what it reads and how it judges is held here.

test('reads the coding, the length and the tag from HTTP/1.1 headers', () => {
  expect(
    parseDelivery(
      [
        'HTTP/1.1 200 OK',
        'Content-Encoding: br',
        'Content-Length: 1113',
        'Content-Type: text/javascript; charset=utf-8',
        'Etag: "abc"',
        'Vary: Accept-Encoding',
        '',
        '',
      ].join('\r\n'),
    ),
  ).toEqual({ status: 200, coding: 'br', length: 1113, etag: '"abc"' });
});

test('reads HTTP/2 headers, which come in lower case', () => {
  expect(
    parseDelivery(
      'HTTP/2 200 \r\ncontent-encoding: GZIP\r\ncontent-length: 1214\r\n\r\n',
    ),
  ).toEqual({ status: 200, coding: 'gzip', length: 1214, etag: null });
});

test('says null for a body sent as it is, and for an answer that streams', () => {
  expect(
    parseDelivery('HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n'),
  ).toEqual({ status: 200, coding: null, length: null, etag: null });
});

test('judges the answer itself, never an interim one before it', () => {
  expect(
    parseDelivery(
      'HTTP/1.1 100 Continue\r\nContent-Length: 7\r\n\r\nHTTP/1.1 404 Not Found\r\nContent-Length: 9\r\n\r\n',
    ),
  ).toEqual({ status: 404, coding: null, length: 9, etag: null });
});

test('reads nothing from text that holds no status line', () => {
  expect(parseDelivery('')).toBeNull();
  expect(parseDelivery('curl: (7) Failed to connect')).toBeNull();
  expect(parseDelivery('Content-Length: 12\r\n')).toBeNull();
});

test('finds no fault in the answer it expects', () => {
  const br = { status: 200, coding: 'br', length: 1113, etag: null };
  expect(deliveryFaults(br, { coding: 'br', length: 1113 })).toEqual([]);
  // A length the test does not know is not judged.
  expect(
    deliveryFaults(
      { status: 200, coding: 'gzip', length: null, etag: '"a"' },
      { coding: 'gzip' },
    ),
  ).toEqual([]);
});

test('names each way an answer differs', () => {
  expect(deliveryFaults(null, { coding: null })).toEqual(['no answer']);
  // The edge compressed a packed file: a coding, and no length.
  expect(
    deliveryFaults(
      { status: 200, coding: 'zstd', length: null, etag: null },
      { coding: null, length: 28076 },
    ),
  ).toEqual(['coding zstd, expected none', 'length none, expected 28076']);
  // The edge compressed a bundle again instead of passing the build's on.
  expect(
    deliveryFaults(
      { status: 200, coding: 'gzip', length: 1300, etag: null },
      { coding: 'gzip', length: 1214 },
    ),
  ).toEqual(['length 1300, expected 1214']);
  expect(
    deliveryFaults(
      { status: 404, coding: null, length: 9, etag: null },
      { coding: 'br' },
    ),
  ).toEqual(['status 404', 'coding none, expected br']);
});

test('accepts what the app files program prints, and nothing shaped otherwise', () => {
  const printed = {
    bundle: { name: 'app-BQ4kL2mZ.js', bytes: 2238, br: 1113, gzip: 1214 },
    packed: { name: 'KaTeX_AMS-Regular-BQhdFMY1.woff2', bytes: 28076 },
  };
  expect(parseAppFiles(`${JSON.stringify(printed)}\n`)).toEqual(printed);
  // No bundle with both neighbours: the program prints no `bundle`.
  expect(parseAppFiles(JSON.stringify({ packed: printed.packed }))).toBeNull();
  expect(parseAppFiles(JSON.stringify({ bundle: printed.bundle }))).toBeNull();
  expect(
    parseAppFiles(
      JSON.stringify({
        ...printed,
        bundle: { ...printed.bundle, gzip: '1214' },
      }),
    ),
  ).toBeNull();
  // A name is put into a URL: only what a built file is called.
  expect(
    parseAppFiles(
      JSON.stringify({
        ...printed,
        packed: { name: '../../etc/passwd', bytes: 1 },
      }),
    ),
  ).toBeNull();
  expect(parseAppFiles('null')).toBeNull();
});

test('the app files program picks a script with both neighbours and a packed font', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tale-app-files-'));
  try {
    const assets = join(root, 'assets');
    await mkdir(assets);
    const files: [string, number][] = [
      // No neighbour at all, then one alone: neither is the bundle to judge.
      ['a-AAAAAAAA.js', 500],
      ['b-BBBBBBBB.js', 4000],
      ['b-BBBBBBBB.js.br', 900],
      ['c-CCCCCCCC.js', 3000],
      ['c-CCCCCCCC.js.br', 700],
      ['c-CCCCCCCC.js.gz', 800],
      ['font-DDDDDDDD.woff', 50],
      ['font-DDDDDDDD.woff2', 40],
    ];
    for (const [name, bytes] of files)
      await writeFile(join(assets, name), Buffer.alloc(bytes, 1));
    const child = Bun.spawn(['node', '-e', APP_FILES_PROGRAM, assets], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(stderr).toBe('');
    expect(exitCode).toBe(0);
    expect(parseAppFiles(stdout)).toEqual({
      bundle: { name: 'c-CCCCCCCC.js', bytes: 3000, br: 700, gzip: 800 },
      packed: { name: 'font-DDDDDDDD.woff2', bytes: 40 },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('the app files program prints nothing to judge for an app without neighbours', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tale-app-files-'));
  try {
    const assets = join(root, 'assets');
    await mkdir(assets);
    await writeFile(join(assets, 'a-AAAAAAAA.js'), Buffer.alloc(4000, 1));
    await writeFile(join(assets, 'font-DDDDDDDD.woff2'), Buffer.alloc(40, 1));
    const child = Bun.spawn(['node', '-e', APP_FILES_PROGRAM, assets], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const stdout = await new Response(child.stdout).text();
    expect(await child.exited).toBe(0);
    expect(parseAppFiles(stdout)).toBeNull();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
