import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createReleaseFeed,
  releaseFeedHealth,
  RELEASES_STALE_AFTER_MS,
} from './feed';
import type { Release } from './types';

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

const SNAPSHOT = [release('0.3.3')] as const;
const SNAPSHOT_FETCHED_AT = '2026-07-15T02:02:22.496Z';
const LIVE = [release('0.4.9'), release('0.4.8')];

function setup(
  fetchReleases: () => Promise<Release[]>,
  overrides: { ttlMs?: number; errorTtlMs?: number } = {},
) {
  let clock = Date.parse('2026-08-21T10:00:00Z');
  const feed = createReleaseFeed({
    snapshot: SNAPSHOT,
    snapshotFetchedAt: SNAPSHOT_FETCHED_AT,
    ttlMs: overrides.ttlMs ?? 30 * 60 * 1000,
    errorTtlMs: overrides.errorTtlMs ?? 5 * 60 * 1000,
    fetchReleases: fetchReleases as never,
    now: () => clock,
  });
  return { feed, advance: (ms: number) => (clock += ms) };
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createReleaseFeed', () => {
  it('serves the snapshot before any refresh lands', () => {
    const { feed } = setup(async () => LIVE);

    const payload = feed.read();

    expect(payload.source).toBe('snapshot');
    expect(payload.fetchedAt).toBe(SNAPSHOT_FETCHED_AT);
    expect(payload.releases).toEqual(SNAPSHOT);
  });

  it('serves the live list once a refresh lands', async () => {
    const { feed } = setup(async () => LIVE);

    await feed.refresh();
    const payload = feed.read();

    expect(payload.source).toBe('live');
    expect(payload.releases).toEqual(LIVE);
    expect(payload.fetchedAt).toBe('2026-08-21T10:00:00.000Z');
  });

  it('does not refetch while the cache is fresh', async () => {
    const fetchReleases = vi.fn(async () => LIVE);
    const { feed, advance } = setup(fetchReleases, { ttlMs: 60_000 });

    await feed.refresh();
    advance(30_000);
    feed.read();
    feed.read();

    expect(fetchReleases).toHaveBeenCalledTimes(1);
  });

  it('refreshes in the background once stale, serving the previous list meanwhile', async () => {
    const fetchReleases = vi.fn(async () => LIVE);
    const { feed, advance } = setup(fetchReleases, { ttlMs: 60_000 });

    await feed.refresh();
    fetchReleases.mockImplementation(async () => [release('0.5.0')]);
    advance(61_000);

    // Stale read is served immediately from cache — no await on the network.
    expect(feed.read().releases).toEqual(LIVE);
    await vi.waitFor(() => {
      expect(feed.read().releases).toEqual([release('0.5.0')]);
    });
    expect(fetchReleases).toHaveBeenCalledTimes(2);
  });

  it('shares one in-flight fetch across concurrent refreshes', async () => {
    const fetchReleases = vi.fn(async () => LIVE);
    const { feed } = setup(fetchReleases);

    await Promise.all([feed.refresh(), feed.refresh(), feed.refresh()]);

    expect(fetchReleases).toHaveBeenCalledTimes(1);
  });

  it('keeps the snapshot and backs off when the first refresh fails', async () => {
    const fetchReleases = vi.fn(async () => {
      throw new Error('offline');
    });
    const { feed, advance } = setup(fetchReleases, { errorTtlMs: 60_000 });

    await feed.refresh();

    expect(feed.read().source).toBe('snapshot');
    expect(console.warn).toHaveBeenCalled();

    advance(30_000);
    feed.read();
    expect(fetchReleases).toHaveBeenCalledTimes(1);

    advance(31_000);
    feed.read();
    await vi.waitFor(() => {
      expect(fetchReleases).toHaveBeenCalledTimes(2);
    });
  });

  it('keeps the last good list when a later refresh fails', async () => {
    const fetchReleases = vi.fn(async () => LIVE);
    const { feed, advance } = setup(fetchReleases, { ttlMs: 60_000 });

    await feed.refresh();
    fetchReleases.mockImplementation(async () => {
      throw new Error('502');
    });
    advance(61_000);
    await feed.refresh();

    const payload = feed.read();
    expect(payload.source).toBe('live');
    expect(payload.releases).toEqual(LIVE);
  });

  it('treats an empty upstream list as a failure', async () => {
    const { feed } = setup(async () => []);

    await feed.refresh();

    expect(feed.read().source).toBe('snapshot');
    expect(console.warn).toHaveBeenCalled();
  });

  it('never rejects out of refresh', async () => {
    const { feed } = setup(async () => {
      throw new Error('boom');
    });

    await expect(feed.refresh()).resolves.toBeUndefined();
  });
});

describe('release feed freshness', () => {
  it('reports stale data once, recovers, then reports a later outage', async () => {
    let clock = Date.parse('2026-08-21T10:00:00Z');
    const fetchReleases = vi
      .fn<() => Promise<Release[]>>()
      .mockRejectedValue(new Error('offline'));
    const reportStale = vi.fn();
    const feed = createReleaseFeed({
      snapshot: SNAPSHOT,
      snapshotFetchedAt: SNAPSHOT_FETCHED_AT,
      fetchReleases,
      reportStale,
      now: () => clock,
    });
    clock += RELEASES_STALE_AFTER_MS + 1;
    await feed.refresh();
    await feed.refresh();
    expect(reportStale).toHaveBeenCalledTimes(1);
    expect(releaseFeedHealth(feed.read(), clock)).toMatchObject({
      ok: false,
      source: 'snapshot',
      releasesFetchedAt: SNAPSHOT_FETCHED_AT,
    });
    fetchReleases.mockResolvedValue(LIVE);
    await feed.refresh();
    expect(releaseFeedHealth(feed.read(), clock)).toMatchObject({
      ok: true,
      source: 'live',
      ageSeconds: 0,
    });
    fetchReleases.mockRejectedValue(new Error('offline again'));
    clock += RELEASES_STALE_AFTER_MS;
    await feed.refresh();
    expect(reportStale).toHaveBeenCalledTimes(1);
    clock += 1;
    await feed.refresh();
    expect(reportStale).toHaveBeenCalledTimes(2);
  });

  it('gives a deploy six hours to refresh an older snapshot before reporting', async () => {
    let clock = Date.parse('2026-08-21T10:00:00Z');
    const fetchReleases = vi
      .fn<() => Promise<Release[]>>()
      .mockRejectedValue(new Error('offline'));
    const reportStale = vi.fn();
    const feed = createReleaseFeed({
      snapshot: SNAPSHOT,
      snapshotFetchedAt: SNAPSHOT_FETCHED_AT,
      fetchReleases,
      reportStale,
      now: () => clock,
    });
    await feed.refresh();
    expect(reportStale).not.toHaveBeenCalled();
    // Health still describes what is served: a list older than six hours.
    expect(releaseFeedHealth(feed.read(), clock).ok).toBe(false);
    clock += RELEASES_STALE_AFTER_MS;
    await feed.refresh();
    expect(reportStale).not.toHaveBeenCalled();
    clock += 1;
    await feed.refresh();
    await feed.refresh();
    expect(reportStale).toHaveBeenCalledTimes(1);
  });

  it('does not claim freshness for invalid or future snapshot dates', () => {
    for (const fetchedAt of ['invalid', '2030-01-01T00:00:00Z']) {
      expect(
        releaseFeedHealth(
          { releases: SNAPSHOT, fetchedAt, source: 'snapshot' },
          Date.parse('2026-08-21T10:00:00Z'),
        ).ok,
      ).toBe(false);
    }
  });
});
