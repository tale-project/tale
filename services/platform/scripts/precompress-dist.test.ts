// @vitest-environment node

import { randomBytes } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  brotliCompressSync,
  brotliDecompressSync,
  constants,
  gunzipSync,
  gzipSync,
} from 'node:zlib';

import { getMimeType } from 'hono/utils/mime';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ANSWERED_PER_REQUEST,
  CODINGS,
  COMPRESSIBLE_EXTENSIONS,
  MIN_BYTES,
  encode,
  isCompressible,
  precompressDist,
} from './precompress-dist.ts';

/** Text a coding shrinks a great deal, `bytes` long. */
const text = (bytes: number): Buffer =>
  Buffer.from(
    'export const answer = () => "the built app, one chunk of it";\n'
      .repeat(Math.ceil(bytes / 62))
      .slice(0, bytes),
  );

let dist = '';
beforeEach(() => {
  dist = mkdtempSync(join(tmpdir(), 'tale-precompress-'));
  mkdirSync(join(dist, 'assets'));
});
afterEach(() => {
  rmSync(dist, { recursive: true, force: true });
});

const write = (name: string, bytes: Buffer): void => {
  mkdirSync(join(dist, name, '..'), { recursive: true });
  writeFileSync(join(dist, name), bytes);
};
const listed = (): string[] =>
  (readdirSync(dist, { recursive: true }) as string[])
    .map((name) => name.replaceAll('\\', '/'))
    .filter(
      (name) => !['assets', 'canvas-libs', 'canvas-libs/d3'].includes(name),
    )
    .toSorted();

describe('precompressDist', () => {
  it('writes a brotli and a gzip neighbour that decode to the file, byte for byte', async () => {
    const source = text(40_000);
    write('assets/app-BQ4kL2mZ.js', source);

    const summary = await precompressDist(dist);

    expect(listed()).toEqual([
      'assets/app-BQ4kL2mZ.js',
      'assets/app-BQ4kL2mZ.js.br',
      'assets/app-BQ4kL2mZ.js.gz',
    ]);
    const br = readFileSync(join(dist, 'assets/app-BQ4kL2mZ.js.br'));
    const gz = readFileSync(join(dist, 'assets/app-BQ4kL2mZ.js.gz'));
    expect(brotliDecompressSync(br).equals(source)).toBe(true);
    expect(gunzipSync(gz).equals(source)).toBe(true);
    expect(br.length).toBeLessThan(source.length / 10);
    expect(gz.length).toBeLessThan(source.length / 10);
    expect(summary).toEqual({
      files: 1,
      bytes: source.length,
      encoded: { br: br.length, gzip: gz.length },
      removed: 0,
    });
    // The file itself is as the build wrote it.
    expect(
      readFileSync(join(dist, 'assets/app-BQ4kL2mZ.js')).equals(source),
    ).toBe(true);
  });

  it('reaches every directory of the built app', async () => {
    write('sw.js', text(5_000));
    write('assets/style-AAAAAAAA.css', text(5_000));
    write('canvas-libs/d3/d3.mjs', text(5_000));

    expect((await precompressDist(dist)).files).toBe(3);
    expect(listed()).toEqual([
      'assets/style-AAAAAAAA.css',
      'assets/style-AAAAAAAA.css.br',
      'assets/style-AAAAAAAA.css.gz',
      'canvas-libs/d3/d3.mjs',
      'canvas-libs/d3/d3.mjs.br',
      'canvas-libs/d3/d3.mjs.gz',
      'sw.js',
      'sw.js.br',
      'sw.js.gz',
    ]);
  });

  it('leaves out what is packed already, source maps, HTML and small files', async () => {
    const big = text(20_000);
    for (const name of [
      'assets/logo-AAAAAAAA.png',
      'assets/font-AAAAAAAA.woff2',
      'assets/font-AAAAAAAA.woff',
      'assets/app-AAAAAAAA.js.map',
      'index.html',
      'offline.html',
      'boot-shell.html',
      'favicon.ico',
    ])
      write(name, big);
    write('assets/tiny-AAAAAAAA.js', text(MIN_BYTES - 1));
    const before = listed();

    const summary = await precompressDist(dist);

    expect(listed()).toEqual(before);
    expect(summary.files).toBe(0);
  });

  it('writes no neighbour that would not be smaller than its file', async () => {
    // Bytes no coding shrinks, under a name that would get neighbours.
    write('assets/noise-AAAAAAAA.js', randomBytes(8_192));
    await precompressDist(dist);
    expect(listed()).toEqual(['assets/noise-AAAAAAAA.js']);
  });

  it('writes the same bytes on a second run, and never a neighbour of a neighbour', async () => {
    write('assets/app-AAAAAAAA.js', text(30_000));
    await precompressDist(dist);
    const first = listed().map((name) => [
      name,
      readFileSync(join(dist, name)).toString('base64'),
    ]);

    const again = await precompressDist(dist);

    expect(
      listed().map((name) => [
        name,
        readFileSync(join(dist, name)).toString('base64'),
      ]),
    ).toEqual(first);
    expect(again.removed).toBe(0);
    expect(listed().some((name) => /\.(br|gz)\.(br|gz)$/.test(name))).toBe(
      false,
    );
  });

  it('rewrites the neighbours of a file that was rebuilt, never trusting the old ones', async () => {
    write('sw.js', text(10_000));
    await precompressDist(dist);
    const rebuilt = Buffer.from(
      'self.addEventListener("install", () => self.skipWaiting());\n'.repeat(
        200,
      ),
    );
    write('sw.js', rebuilt);

    await precompressDist(dist);

    expect(
      brotliDecompressSync(readFileSync(join(dist, 'sw.js.br'))).equals(
        rebuilt,
      ),
    ).toBe(true);
    expect(
      gunzipSync(readFileSync(join(dist, 'sw.js.gz'))).equals(rebuilt),
    ).toBe(true);
  });

  it('removes the neighbours an earlier run left for a file that gets none now', async () => {
    // Left there, each would be sent as its file: the bytes of an earlier
    // build under the name of this one.
    write('assets/shrunk-AAAAAAAA.js', text(10_000));
    write('assets/noise-AAAAAAAA.js', text(10_000));
    await precompressDist(dist);
    write('assets/shrunk-AAAAAAAA.js', text(100));
    write('assets/noise-AAAAAAAA.js', randomBytes(8_192));

    const summary = await precompressDist(dist);

    expect(listed()).toEqual([
      'assets/noise-AAAAAAAA.js',
      'assets/shrunk-AAAAAAAA.js',
    ]);
    expect(summary.removed).toBe(4);
  });

  it('leaves alone a compressed file that is the neighbour of nothing', async () => {
    // No request for another name can be answered with it, and it may be a
    // file the app ships that way: it is not this script's to delete.
    const shipped = Buffer.from('a dictionary the app inflates itself');
    write('assets/dictionary-AAAAAAAA.bin.gz', shipped);
    write('data/table.br', shipped);
    write('assets/app-AAAAAAAA.js', text(10_000));

    const summary = await precompressDist(dist);

    expect(summary.removed).toBe(0);
    expect(
      readFileSync(join(dist, 'assets/dictionary-AAAAAAAA.bin.gz')).equals(
        shipped,
      ),
    ).toBe(true);
    expect(readFileSync(join(dist, 'data/table.br')).equals(shipped)).toBe(
      true,
    );
    expect(listed()).toEqual([
      'assets/app-AAAAAAAA.js',
      'assets/app-AAAAAAAA.js.br',
      'assets/app-AAAAAAAA.js.gz',
      'assets/dictionary-AAAAAAAA.bin.gz',
      'data',
      'data/table.br',
    ]);
  });

  it('writes none for the document the web tier answers itself, and takes away one an earlier build left', async () => {
    write('openapi.json', text(50_000));
    write('openapi.json.br', Buffer.from('of an earlier build'));
    // The same name anywhere else is a file like any other.
    write('assets/openapi.json', text(50_000));

    const summary = await precompressDist(dist);

    expect(listed()).toEqual([
      'assets/openapi.json',
      'assets/openapi.json.br',
      'assets/openapi.json.gz',
      'openapi.json',
    ]);
    expect(summary).toMatchObject({ files: 1, removed: 1 });
  });

  it('names as answered per request only what a route of the web tier answers before the files', () => {
    // A name here whose route is gone would be sent from disk after all,
    // uncompressed by the build and compressed by the edge instead.
    const server = readFileSync(
      new URL('../server.ts', import.meta.url),
      'utf8',
    );
    const files = server.indexOf("app.get('*'");
    expect(files).toBeGreaterThan(0);
    expect([...ANSWERED_PER_REQUEST]).toEqual(['openapi.json']);
    for (const name of ANSWERED_PER_REQUEST) {
      const route = server.indexOf(`app.get('/${name}'`);
      expect(route, name).toBeGreaterThan(0);
      expect(route, name).toBeLessThan(files);
    }
  });

  it('is the same output whatever the number of files at once', async () => {
    for (let index = 0; index < 12; index += 1)
      write(
        `assets/chunk-${String(index).padStart(8, 'A')}.js`,
        text(3_000 + index * 517),
      );
    await precompressDist(dist, 1);
    const serial = listed().map((name) =>
      readFileSync(join(dist, name)).toString('base64'),
    );
    await precompressDist(dist, 8);
    expect(
      listed().map((name) => readFileSync(join(dist, name)).toString('base64')),
    ).toEqual(serial);
  });
});

describe('the rule for a neighbour', () => {
  it('is the extension and the size, whatever the case of the name', () => {
    expect(isCompressible('assets/app.js', MIN_BYTES)).toBe(true);
    expect(isCompressible('assets/APP.JS', MIN_BYTES)).toBe(true);
    expect(isCompressible('assets/app.js', MIN_BYTES - 1)).toBe(false);
    expect(isCompressible('assets/app.js.map', 1_000_000)).toBe(false);
    expect(isCompressible('index.html', 1_000_000)).toBe(false);
    expect(isCompressible('assets/photo.jpg', 1_000_000)).toBe(false);
    expect(isCompressible('assets/font.woff2', 1_000_000)).toBe(false);
    expect(isCompressible('assets/font.ttf', 1_000_000)).toBe(true);
    expect(isCompressible('noextension', 1_000_000)).toBe(false);
    expect(isCompressible('openapi.json', 1_000_000)).toBe(false);
    expect(isCompressible('pwa-build.json', 1_000_000)).toBe(true);
    expect(isCompressible('assets\\app.js', MIN_BYTES)).toBe(true);
  });

  it('covers no kind of file the edge would send as it is for a build that did not', () => {
    // The edge compresses the types it names (services/proxy/render/config.js)
    // and passes every other through. A kind compressed here and missing
    // there is compressed for one build and not for the next: a bundle that
    // a release before this one published, a file whose neighbour is gone.
    const edge = readFileSync(
      new URL('../../proxy/render/config.js', import.meta.url),
      'utf8',
    );
    const list = /export const COMPRESSED_CONTENT_TYPES = \[([^\]]*)\]/.exec(
      edge,
    )?.[1];
    expect(list).toBeDefined();
    const named = [
      ...(list ?? '').replaceAll(/\/\/.*$/gm, '').matchAll(/'([^']+)'/g),
    ].map((match) => match[1]);
    expect(named).toContain('application/json');
    for (const extension of COMPRESSIBLE_EXTENSIONS) {
      // The web tier's own table (`lib/static-file.ts`), parameters dropped.
      const type = getMimeType(`file${extension}`)?.split(';')[0];
      expect(type, extension).toBeDefined();
      expect(named, extension).toContain(type);
    }
  });

  it('names the codings the web tier looks for, best first, and no third', () => {
    // lib/static-file.ts serves `.br` before `.gz`, and would serve a `.zst`
    // too: none is written, because every client that takes zstd takes br.
    expect(CODINGS).toEqual([
      { coding: 'br', suffix: '.br' },
      { coding: 'gzip', suffix: '.gz' },
    ]);
    for (const { suffix } of CODINGS)
      expect(COMPRESSIBLE_EXTENSIONS.has(suffix)).toBe(false);
  });

  it('compresses as hard as each coding can, which only a build can afford', async () => {
    // Real code, not one line repeated: effort shows on text with structure.
    const sample = readFileSync(
      new URL('./precompress-dist.ts', import.meta.url),
    );
    const br = await encode(sample, 'br');
    const gz = await encode(sample, 'gzip');
    expect(br.length).toBeLessThan(
      brotliCompressSync(sample, {
        params: { [constants.BROTLI_PARAM_QUALITY]: 9 },
      }).length,
    );
    expect(gz.length).toBeLessThan(gzipSync(sample, { level: 1 }).length);
    expect(br.length).toBeLessThan(gz.length);
  });

  it('writes no time into a gzip neighbour, so a build stays reproducible', async () => {
    const gz = await encode(text(4_000), 'gzip');
    // RFC 1952: the header's MTIME is bytes 4 to 7.
    expect([...gz.subarray(4, 8)]).toEqual([0, 0, 0, 0]);
    expect((await encode(text(4_000), 'gzip')).equals(gz)).toBe(true);
    expect(
      (await encode(text(4_000), 'br')).equals(await encode(text(4_000), 'br')),
    ).toBe(true);
  });
});
