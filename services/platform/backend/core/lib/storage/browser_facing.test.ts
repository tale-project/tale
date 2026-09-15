import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { browserFacing, buildS3ObjectStore, objectUrl } from './object_store';

/**
 * The bundled store is internal-only, but presigned URLs are handed to the
 * BROWSER on purpose — the transfer goes direct, and the store (not Node)
 * answers the Range requests media seeking needs. So a browser-facing URL has
 * to be signed against the origin the browser can reach, and the proxy has to
 * forward it verbatim: SigV4 covers the host AND the path, so a rewritten
 * prefix or a swapped Host breaks every signature.
 *
 * A deployment answering on several origins publishes the bucket on each of
 * them, so a link is signed for the origin the request came from — and never
 * for an origin outside the configured set.
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

beforeEach(() => {
  vi.stubEnv('SITE_URL', 'https://tale.example.com');
  vi.stubEnv('ADDITIONAL_SITE_URLS', 'https://tale.partner.example');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('browserFacing', () => {
  it('signs against the published origin when there is one', () => {
    const url = objectUrl(
      browserFacing(store('https://tale.example.com'), null),
      'acme/blob-1',
    );
    expect(url).toBe('https://tale.example.com/tale-blobs/acme/blob-1');
  });

  it('rebases onto the site origin the request arrived on', () => {
    const url = objectUrl(
      browserFacing(
        store('https://tale.example.com'),
        'https://tale.partner.example',
      ),
      'acme/blob-1',
    );
    expect(url).toBe('https://tale.partner.example/tale-blobs/acme/blob-1');
  });

  it('keeps the bucket as the leading path segment', () => {
    // The proxy publishes the store at `/<bucket>/*` on every site origin and
    // forwards it UNSTRIPPED for exactly this reason — the signed path starts
    // here.
    const url = new URL(
      objectUrl(
        browserFacing(
          store('https://tale.example.com'),
          'https://tale.partner.example',
        ),
        'k',
      ),
    );
    expect(url.pathname.startsWith('/tale-blobs/')).toBe(true);
  });

  it('keeps a path the published endpoint carries', () => {
    const url = objectUrl(
      browserFacing(
        store('https://tale.example.com/files/'),
        'https://tale.partner.example',
      ),
      'k',
    );
    expect(url).toBe('https://tale.partner.example/files/tale-blobs/k');
  });

  it('ignores a request origin outside the configured site origins', () => {
    // A forged Host or a scheme downgrade never moves a signed link off the
    // deployment's own origins.
    for (const foreign of [
      'https://tale.elsewhere.example',
      'http://tale.partner.example',
    ]) {
      expect(
        objectUrl(
          browserFacing(store('https://tale.example.com'), foreign),
          'k',
        ),
      ).toBe('https://tale.example.com/tale-blobs/k');
    }
  });

  it('leaves a separate file host on its own origin', () => {
    // A published endpoint that is not one of the deployment's origins is
    // another host (a dedicated files domain, a CDN): only it serves the
    // bucket, whichever origin the browser is on.
    expect(
      objectUrl(
        browserFacing(
          store('https://files.example.net'),
          'https://tale.partner.example',
        ),
        'k',
      ),
    ).toBe('https://files.example.net/tale-blobs/k');
  });

  it('keeps the published endpoint on a single-origin deployment', () => {
    vi.stubEnv('ADDITIONAL_SITE_URLS', '');
    expect(
      objectUrl(
        browserFacing(
          store('https://tale.example.com'),
          'https://tale.partner.example',
        ),
        'k',
      ),
    ).toBe('https://tale.example.com/tale-blobs/k');
  });

  it('leaves a store with no published origin untouched', () => {
    // Every BYO org bucket: its endpoint is already the one the browser uses.
    const byo = store();
    expect(browserFacing(byo, 'https://tale.partner.example')).toBe(byo);
    expect(objectUrl(browserFacing(byo, null), 'k')).toBe(
      'http://object-store:9000/tale-blobs/k',
    );
  });

  it('does not disturb the internal view it was derived from', () => {
    // The backend still reaches the store internally (WebDAV and TTS fetch
    // blobs server-side); swapping the endpoint in place would break them.
    const internal = store('https://tale.example.com');
    browserFacing(internal, 'https://tale.partner.example');
    expect(objectUrl(internal, 'k')).toBe(
      'http://object-store:9000/tale-blobs/k',
    );
  });
});
