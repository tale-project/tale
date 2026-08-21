import { describe, expect, it } from 'vitest';

import type { ReleaseFeed, ReleaseFeedPayload } from './feed';
import { handleReleasesRequest, RELEASES_ROUTE } from './route';

const PAYLOAD: ReleaseFeedPayload = {
  releases: [
    {
      tag: 'v0.4.9',
      version: '0.4.9',
      name: null,
      body: 'notes',
      htmlUrl: 'https://github.com/tale-project/tale/releases/tag/v0.4.9',
      publishedAt: '2026-08-17T07:50:16Z',
    },
  ],
  fetchedAt: '2026-08-21T10:00:00.000Z',
  source: 'live',
};

const feed: ReleaseFeed = {
  read: () => PAYLOAD,
  refresh: async () => {},
};

const url = `http://localhost:3001${RELEASES_ROUTE}`;

describe('handleReleasesRequest', () => {
  it('serves the feed as cacheable JSON', async () => {
    const response = handleReleasesRequest(new Request(url), feed);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('cache-control')).toBe('public, max-age=300');
    expect(await response.json()).toEqual(PAYLOAD);
  });

  it('rejects non-GET methods', () => {
    const response = handleReleasesRequest(
      new Request(url, { method: 'POST' }),
      feed,
    );

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET');
  });
});
