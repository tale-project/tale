import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Release } from '@/lib/releases/types';

import { parseReleaseList, useLiveReleases } from './use-live-releases';

function release(version: string): Release {
  return {
    tag: `v${version}`,
    version,
    name: null,
    body: 'notes',
    htmlUrl: `https://github.com/tale-project/tale/releases/tag/v${version}`,
    publishedAt: '2026-08-17T07:50:16Z',
  };
}

const SNAPSHOT = {
  releases: [release('0.3.3')],
  fetchedAt: '2026-07-15T02:02:22.496Z',
};
const LIVE = {
  releases: [release('0.4.9')],
  fetchedAt: '2026-08-21T10:00:00.000Z',
  source: 'live',
};

function mockFetch(response: Response | Error): typeof fetch {
  return vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  }) as unknown as typeof fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parseReleaseList', () => {
  it('accepts a well-formed payload', () => {
    expect(parseReleaseList(LIVE)).toEqual({
      releases: LIVE.releases,
      fetchedAt: LIVE.fetchedAt,
    });
  });

  it.each([
    ['null', null],
    ['a string', 'nope'],
    ['a missing list', { fetchedAt: LIVE.fetchedAt }],
    ['an empty list', { releases: [], fetchedAt: LIVE.fetchedAt }],
    ['a missing timestamp', { releases: LIVE.releases }],
    ['an empty timestamp', { releases: LIVE.releases, fetchedAt: '' }],
    [
      'a malformed release',
      { releases: [{ tag: 'v1' }], fetchedAt: LIVE.fetchedAt },
    ],
    [
      'a release with a non-nullable field nulled',
      {
        releases: [{ ...release('0.4.9'), htmlUrl: null }],
        fetchedAt: LIVE.fetchedAt,
      },
    ],
  ])('rejects %s', (_label, payload) => {
    expect(parseReleaseList(payload)).toBeNull();
  });

  it('accepts nullable fields set to null', () => {
    const payload = {
      releases: [
        { ...release('0.4.9'), name: null, body: null, publishedAt: null },
      ],
      fetchedAt: LIVE.fetchedAt,
    };
    expect(parseReleaseList(payload)).not.toBeNull();
  });
});

describe('useLiveReleases', () => {
  it('returns the snapshot on first render', () => {
    vi.stubGlobal('fetch', mockFetch(jsonResponse(LIVE)));

    const { result } = renderHook(() => useLiveReleases(SNAPSHOT));

    expect(result.current).toEqual(SNAPSHOT);
  });

  it('swaps in the live feed once it resolves', async () => {
    vi.stubGlobal('fetch', mockFetch(jsonResponse(LIVE)));

    const { result } = renderHook(() => useLiveReleases(SNAPSHOT));

    await waitFor(() => {
      expect(result.current.releases).toEqual(LIVE.releases);
    });
    expect(result.current.fetchedAt).toBe(LIVE.fetchedAt);
  });

  it('keeps the snapshot when the endpoint errors', async () => {
    vi.stubGlobal('fetch', mockFetch(jsonResponse({ error: 'nope' }, 503)));

    const { result } = renderHook(() => useLiveReleases(SNAPSHOT));

    await waitFor(() => {
      expect(console.warn).toHaveBeenCalled();
    });
    expect(result.current).toEqual(SNAPSHOT);
  });

  it('keeps the snapshot when the response is not JSON', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        new Response('<!doctype html><html></html>', {
          headers: { 'content-type': 'text/html' },
        }),
      ),
    );

    const { result } = renderHook(() => useLiveReleases(SNAPSHOT));

    await waitFor(() => {
      expect(console.warn).toHaveBeenCalled();
    });
    expect(result.current).toEqual(SNAPSHOT);
  });

  it('keeps the snapshot when the payload shape is wrong', async () => {
    vi.stubGlobal('fetch', mockFetch(jsonResponse({ releases: 'nope' })));

    const { result } = renderHook(() => useLiveReleases(SNAPSHOT));

    await waitFor(() => {
      expect(console.warn).toHaveBeenCalled();
    });
    expect(result.current).toEqual(SNAPSHOT);
  });

  it('keeps the snapshot when the network fails', async () => {
    vi.stubGlobal('fetch', mockFetch(new Error('offline')));

    const { result } = renderHook(() => useLiveReleases(SNAPSHOT));

    await waitFor(() => {
      expect(console.warn).toHaveBeenCalled();
    });
    expect(result.current).toEqual(SNAPSHOT);
  });

  it('aborts the in-flight request on unmount', () => {
    const abort = vi.fn();
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            abort();
            reject(new Error('aborted'));
          });
        }),
    );
    vi.stubGlobal('fetch', fetchImpl);

    const { unmount } = renderHook(() => useLiveReleases(SNAPSHOT));
    unmount();

    expect(abort).toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
  });
});
