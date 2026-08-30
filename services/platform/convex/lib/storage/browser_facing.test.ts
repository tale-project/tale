import { describe, expect, it } from 'vitest';

import { browserFacing, buildS3ObjectStore, objectUrl } from './object_store';

/**
 * The bundled store is internal-only, but presigned URLs are handed to the
 * BROWSER on purpose — the transfer goes direct, and the store (not Node)
 * answers the Range requests media seeking needs. So a browser-facing URL has
 * to be signed against the origin the browser can reach, and the proxy has to
 * forward it verbatim: SigV4 covers the host AND the path, so a rewritten
 * prefix or a swapped Host breaks every signature.
 */

const SECRETS = { accessKeyId: 'key', secretAccessKey: 'secret' };

function store(publicEndpoint?: string) {
  return buildS3ObjectStore(
    {
      region: 'us-east-1',
      endpoint: 'http://object-store:9000',
      forcePathStyle: true,
      bucket: 'tale-blobs',
      ...(publicEndpoint ? { publicEndpoint } : {}),
    },
    SECRETS,
  );
}

describe('browserFacing', () => {
  it('signs against the published origin when there is one', () => {
    const url = objectUrl(
      browserFacing(store('https://tale.example.com')),
      'acme/blob-1',
    );
    expect(url).toBe('https://tale.example.com/tale-blobs/acme/blob-1');
  });

  it('keeps the bucket as the leading path segment', () => {
    // The proxy publishes the store at `/<bucket>/*` and forwards it
    // UNSTRIPPED for exactly this reason — the signed path starts here.
    const url = new URL(
      objectUrl(browserFacing(store('https://tale.example.com')), 'k'),
    );
    expect(url.pathname.startsWith('/tale-blobs/')).toBe(true);
  });

  it('leaves a store with no published origin untouched', () => {
    // Every BYO org bucket: its endpoint is already the one the browser uses.
    const byo = store();
    expect(browserFacing(byo)).toBe(byo);
    expect(objectUrl(browserFacing(byo), 'k')).toBe(
      'http://object-store:9000/tale-blobs/k',
    );
  });

  it('does not disturb the internal view it was derived from', () => {
    // The backend still reaches the store internally (WebDAV and TTS fetch
    // blobs server-side); swapping the endpoint in place would break them.
    const internal = store('https://tale.example.com');
    browserFacing(internal);
    expect(objectUrl(internal, 'k')).toBe(
      'http://object-store:9000/tale-blobs/k',
    );
  });
});
