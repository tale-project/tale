import { describe, expect, it, vi } from 'vitest';

import {
  SafeFetchError,
  type safeFetchBinary,
} from '../../../lib/net/safe-fetch.ts';
import {
  decodeImageProxyTarget,
  fetchProxiedImage,
  IMAGE_PROXY_MAX_BYTES,
  ImageProxyError,
} from './service.ts';

/** A real 1×1 PNG. */
const PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  ),
  (char) => char.charCodeAt(0),
);

function answering(
  bytes: Uint8Array<ArrayBuffer> | string,
  init: { status?: number; type?: string } = {},
) {
  return vi.fn<typeof safeFetchBinary>(async (url) => ({
    status: init.status ?? 200,
    statusText: 'OK',
    headers: new Headers(),
    body: new Blob([bytes], { type: init.type ?? '' }),
    finalUrl: url,
  }));
}

function refusing(kind: SafeFetchError['kind']) {
  return vi.fn<typeof safeFetchBinary>(async () => {
    throw new SafeFetchError(kind, `refused: ${kind}`);
  });
}

async function refusalOf(promise: Promise<unknown>): Promise<ImageProxyError> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  if (!(error instanceof ImageProxyError)) {
    throw new Error(`expected an ImageProxyError, got ${String(error)}`);
  }
  return error;
}

const TARGET = new URL('https://mail.example.com/logo.png');

describe('decodeImageProxyTarget', () => {
  it('reads the base64 of an http(s) URL', () => {
    expect(decodeImageProxyTarget(btoa(TARGET.href)).href).toBe(TARGET.href);
  });

  it.each([
    ['a missing parameter', undefined],
    ['an empty one', ''],
    ['one that is not base64', '%%%'],
    ['base64 of something that is no URL', btoa('not a url')],
    ['a javascript: URL', btoa('javascript:alert(1)')],
    ['a file: URL', btoa('file:///etc/passwd')],
    ['a data: URL', btoa('data:image/png;base64,AAAA')],
  ])('refuses %s as INVALID_IMAGE_URL [IMGPX-R3]', (_label, param) => {
    expect(() => decodeImageProxyTarget(param)).toThrow(
      expect.objectContaining({ code: 'INVALID_IMAGE_URL', status: 400 }),
    );
  });
});

describe('fetchProxiedImage', () => {
  it('caps an image at 10 MB [IMGPX-R6]', () => {
    expect(IMAGE_PROXY_MAX_BYTES).toBe(10 * 1024 * 1024);
  });

  it('asks with no credential, capped, and answers the type the bytes are [IMGPX-R4] [IMGPX-R7]', async () => {
    const fetchBinary = answering(PNG, { type: 'application/octet-stream' });

    const image = await fetchProxiedImage(TARGET, fetchBinary);

    expect(image.contentType).toBe('image/png');
    expect(image.bytes).toEqual(PNG);
    const [url, options] = fetchBinary.mock.calls[0] ?? [];
    expect(url).toBe(TARGET.href);
    expect(options).toMatchObject({
      credentialless: true,
      maxResponseBytes: IMAGE_PROXY_MAX_BYTES,
    });
    const sent = Object.keys(options?.headers ?? {}).map((h) =>
      h.toLowerCase(),
    );
    expect(sent).not.toContain('cookie');
    expect(sent).not.toContain('authorization');
  });

  it.each([
    [
      'an SVG, which can carry script',
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      'image/svg+xml',
    ],
    [
      'an HTML page labelled as an image',
      '<!doctype html><p>hi</p>',
      'image/png',
    ],
  ])('refuses %s as NOT_AN_IMAGE [IMGPX-R7]', async (_label, body, type) => {
    const refusal = await refusalOf(
      fetchProxiedImage(TARGET, answering(body, { type })),
    );
    expect(refusal).toMatchObject({ code: 'NOT_AN_IMAGE', status: 415 });
  });

  it('runs at most 16 fetches at once, however many are asked for', async () => {
    let inFlight = 0;
    let peak = 0;
    const releases: Array<() => void> = [];
    const fetchBinary = vi.fn<typeof safeFetchBinary>(async (url) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise<void>((resolve) => releases.push(resolve));
      inFlight -= 1;
      return {
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        body: new Blob([PNG]),
        finalUrl: url,
      };
    });

    const all = Promise.all(
      Array.from({ length: 20 }, () => fetchProxiedImage(TARGET, fetchBinary)),
    );
    await vi.waitFor(() => expect(releases.length).toBe(16));
    while (releases.length > 0 || fetchBinary.mock.calls.length < 20) {
      releases.shift()?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await all;

    expect(fetchBinary).toHaveBeenCalledTimes(20);
    expect(peak).toBe(16);
  });

  it('answers an upstream error status as IMAGE_FETCH_FAILED', async () => {
    const refusal = await refusalOf(
      fetchProxiedImage(TARGET, answering('gone', { status: 404 })),
    );
    expect(refusal).toMatchObject({ code: 'IMAGE_FETCH_FAILED', status: 502 });
  });

  it.each([
    ['private_ip', 'IMAGE_HOST_REFUSED', 403],
    ['host_not_allowed', 'IMAGE_HOST_REFUSED', 403],
    ['response_too_large', 'IMAGE_TOO_LARGE', 413],
    ['timeout', 'IMAGE_FETCH_TIMEOUT', 504],
    ['invalid_url', 'INVALID_IMAGE_URL', 400],
    ['network_error', 'IMAGE_FETCH_FAILED', 502],
    ['tls_error', 'IMAGE_FETCH_FAILED', 502],
  ] as const)(
    'answers a %s refusal as %s (%i) [IMGPX-R5] [IMGPX-R6]',
    async (kind, code, status) => {
      const refusal = await refusalOf(
        fetchProxiedImage(TARGET, refusing(kind)),
      );
      expect(refusal).toMatchObject({ code, status });
    },
  );
});
