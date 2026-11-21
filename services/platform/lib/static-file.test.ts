// @vitest-environment node

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  acceptedEncodings,
  byteRange,
  readTextFile,
  staticFileResponse,
} from './static-file';

/**
 * The web tier's files, served by Node. What a browser, a cache and a
 * download manager read off the answer: the type, the length, the range, and
 * the coding of a precompressed neighbour.
 */

let directory: string;
const SCRIPT = 'console.log("the app");\n'.repeat(40);

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'tale-static-file-'));
  await writeFile(join(directory, 'app.js'), SCRIPT);
  await writeFile(join(directory, 'app.js.br'), 'brotli-bytes');
  await writeFile(join(directory, 'app.js.gz'), 'gzip-bytes!');
  await writeFile(join(directory, 'style.css'), 'body{margin:0}');
  await writeFile(join(directory, 'style.css.gz'), 'gz-css');
  await writeFile(join(directory, 'logo.png'), 'png-bytes');
  await writeFile(join(directory, 'empty.txt'), '');
  await writeFile(join(directory, 'mystery.zzz'), 'bytes');
  await mkdir(join(directory, 'folder'));
});

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

function get(headers: Record<string, string> = {}, method = 'GET'): Request {
  return new Request('http://localhost/asset', { method, headers });
}

describe('a file as a response', () => {
  it('carries the type its extension names, its length, and its bytes', async () => {
    const response = await staticFileResponse(join(directory, 'app.js'), get());
    expect(response?.status).toBe(200);
    expect(response?.headers.get('content-type')).toBe(
      'text/javascript; charset=utf-8',
    );
    expect(response?.headers.get('content-length')).toBe(String(SCRIPT.length));
    expect(response?.headers.get('content-encoding')).toBeNull();
    expect(await response?.text()).toBe(SCRIPT);
  });

  it.each([
    ['style.css', 'text/css; charset=utf-8'],
    ['logo.png', 'image/png'],
    ['mystery.zzz', 'application/octet-stream'],
  ])('types %s as %s', async (name, type) => {
    const response = await staticFileResponse(join(directory, name), get());
    expect(response?.headers.get('content-type')).toBe(type);
  });

  it('keeps the headers its door adds, and the type a door pins', async () => {
    const response = await staticFileResponse(
      join(directory, 'logo.png'),
      get(),
      {
        contentType: 'image/x-icon',
        headers: { 'Cache-Control': 'no-cache, must-revalidate' },
      },
    );
    expect(response?.headers.get('content-type')).toBe('image/x-icon');
    expect(response?.headers.get('cache-control')).toBe(
      'no-cache, must-revalidate',
    );
  });

  it('answers a HEAD with the headers of the GET and no body', async () => {
    const response = await staticFileResponse(
      join(directory, 'app.js'),
      get({}, 'HEAD'),
    );
    expect(response?.status).toBe(200);
    expect(response?.headers.get('content-length')).toBe(String(SCRIPT.length));
    expect(response?.body).toBeNull();
  });

  it('answers an empty file with a length of zero', async () => {
    const response = await staticFileResponse(
      join(directory, 'empty.txt'),
      get(),
    );
    expect(response?.status).toBe(200);
    expect(response?.headers.get('content-length')).toBe('0');
    expect(await response?.text()).toBe('');
  });

  it('is no response for a missing path, a directory, or a path through a file', async () => {
    expect(
      await staticFileResponse(join(directory, 'nope.js'), get()),
    ).toBeNull();
    expect(
      await staticFileResponse(join(directory, 'folder'), get()),
    ).toBeNull();
    expect(
      await staticFileResponse(join(directory, 'app.js', 'inside'), get()),
    ).toBeNull();
  });
});

describe('a byte range of a file', () => {
  it('answers 206 with the bytes asked for and where they sit in the whole', async () => {
    const response = await staticFileResponse(
      join(directory, 'app.js'),
      get({ Range: 'bytes=0-6' }),
    );
    expect(response?.status).toBe(206);
    expect(response?.headers.get('content-range')).toBe(
      `bytes 0-6/${SCRIPT.length}`,
    );
    expect(response?.headers.get('content-length')).toBe('7');
    expect(await response?.text()).toBe('console');
  });

  it('reads an open end to the last byte and a suffix from the end', async () => {
    const last = SCRIPT.length - 1;
    const open = await staticFileResponse(
      join(directory, 'app.js'),
      get({ Range: `bytes=${last - 3}-` }),
    );
    expect(open?.headers.get('content-range')).toBe(
      `bytes ${last - 3}-${last}/${SCRIPT.length}`,
    );
    expect(await open?.text()).toBe(SCRIPT.slice(-4));
    const suffix = await staticFileResponse(
      join(directory, 'app.js'),
      get({ Range: 'bytes=-5' }),
    );
    expect(suffix?.status).toBe(206);
    expect(await suffix?.text()).toBe(SCRIPT.slice(-5));
  });

  it('refuses a range past the end with 416 and the size of the file', async () => {
    const response = await staticFileResponse(
      join(directory, 'app.js'),
      get({ Range: `bytes=${SCRIPT.length}-` }),
    );
    expect(response?.status).toBe(416);
    expect(response?.headers.get('content-range')).toBe(
      `bytes */${SCRIPT.length}`,
    );
    expect(response?.body).toBeNull();
  });

  it('serves the whole file for a range it does not understand', async () => {
    for (const range of ['bytes=0-1,4-5', 'lines=1-2', 'bytes=-']) {
      const response = await staticFileResponse(
        join(directory, 'app.js'),
        get({ Range: range }),
      );
      expect(response?.status, range).toBe(200);
      expect(response?.headers.get('content-range'), range).toBeNull();
    }
  });
});

describe('a precompressed neighbour', () => {
  const options = { precompressed: true };

  it('is served as it is to a request that accepts its coding, brotli first', async () => {
    const response = await staticFileResponse(
      join(directory, 'app.js'),
      get({ 'Accept-Encoding': 'gzip, deflate, br, zstd' }),
      options,
    );
    expect(response?.headers.get('content-encoding')).toBe('br');
    // The type is the script's, not the neighbour's.
    expect(response?.headers.get('content-type')).toBe(
      'text/javascript; charset=utf-8',
    );
    expect(response?.headers.get('content-length')).toBe(
      String('brotli-bytes'.length),
    );
    expect(response?.headers.get('vary')).toBe('Accept-Encoding');
    expect(await response?.text()).toBe('brotli-bytes');
  });

  it('falls to the next coding the request accepts and the file has', async () => {
    const gzipOnly = await staticFileResponse(
      join(directory, 'app.js'),
      get({ 'Accept-Encoding': 'gzip' }),
      options,
    );
    expect(gzipOnly?.headers.get('content-encoding')).toBe('gzip');
    expect(await gzipOnly?.text()).toBe('gzip-bytes!');
    // style.css has no brotli neighbour.
    const css = await staticFileResponse(
      join(directory, 'style.css'),
      get({ 'Accept-Encoding': 'br, gzip' }),
      options,
    );
    expect(css?.headers.get('content-encoding')).toBe('gzip');
  });

  it('is not served to a request that refuses its coding or names none', async () => {
    for (const accept of ['br;q=0, gzip;q=0', 'identity', '']) {
      const response = await staticFileResponse(
        join(directory, 'app.js'),
        get(accept === '' ? {} : { 'Accept-Encoding': accept }),
        options,
      );
      expect(response?.headers.get('content-encoding'), accept).toBeNull();
      expect(await response?.text(), accept).toBe(SCRIPT);
      // A cache must still key on the request's codings.
      expect(response?.headers.get('vary'), accept).toBe('Accept-Encoding');
    }
  });

  it('is sent whole: a range counts bytes of the file, not of its coding', async () => {
    const response = await staticFileResponse(
      join(directory, 'app.js'),
      get({ 'Accept-Encoding': 'br', Range: 'bytes=0-3' }),
      options,
    );
    expect(response?.status).toBe(200);
    expect(response?.headers.get('content-range')).toBeNull();
    expect(await response?.text()).toBe('brotli-bytes');
  });

  it('is left alone by a door that did not ask for it', async () => {
    const response = await staticFileResponse(
      join(directory, 'app.js'),
      get({ 'Accept-Encoding': 'br' }),
    );
    expect(response?.headers.get('content-encoding')).toBeNull();
    expect(response?.headers.get('vary')).toBeNull();
  });

  it('keeps a Vary the door already set', async () => {
    const response = await staticFileResponse(
      join(directory, 'app.js'),
      get({ 'Accept-Encoding': 'br' }),
      { precompressed: true, headers: { Vary: 'Cookie' } },
    );
    expect(response?.headers.get('vary')).toBe('Cookie, Accept-Encoding');
  });
});

describe('the codings a request accepts', () => {
  it('reads the tokens and drops the ones refused with q=0', () => {
    expect([...acceptedEncodings('gzip, deflate, br;q=0.9, zstd;q=0')]).toEqual(
      ['gzip', 'deflate', 'br'],
    );
    expect([...acceptedEncodings(' BR , GZip;q=1.0')]).toEqual(['br', 'gzip']);
    expect(acceptedEncodings(null).size).toBe(0);
    expect(acceptedEncodings('br;q=0.000').size).toBe(0);
    expect(acceptedEncodings('br;q=0.001').has('br')).toBe(true);
  });
});

describe('the byte range a request asks for', () => {
  it('clamps an end past the file and refuses a start past it', () => {
    expect(byteRange('bytes=2-99', 10)).toEqual({ start: 2, end: 9 });
    expect(byteRange('bytes=10-', 10)).toBe('unsatisfiable');
    expect(byteRange('bytes=5-2', 10)).toBe('unsatisfiable');
    expect(byteRange('bytes=-0', 10)).toBe('unsatisfiable');
    expect(byteRange('bytes=-99', 10)).toEqual({ start: 0, end: 9 });
    expect(byteRange(null, 10)).toBeNull();
    expect(byteRange('bytes=0-', 0)).toBe('unsatisfiable');
  });
});

describe('a text file', () => {
  it('reads as its content, and as null when it is not there or is a directory', async () => {
    expect(await readTextFile(join(directory, 'style.css'))).toBe(
      'body{margin:0}',
    );
    expect(await readTextFile(join(directory, 'nope.html'))).toBeNull();
    expect(await readTextFile(join(directory, 'folder'))).toBeNull();
  });
});
