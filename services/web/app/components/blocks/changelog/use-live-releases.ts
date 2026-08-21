import { useEffect, useState } from 'react';

import type { Release } from '@/lib/releases/types';

/**
 * Runtime feed served by `server.ts` (see `lib/releases/feed.ts`). The page
 * renders the build-time snapshot first — so prerendered HTML and hydration
 * agree — then swaps in the live list, which is the only way the newest
 * release can show up: release images are built before the GitHub release is
 * published.
 */
const FEED_URL = '/api/releases';

export interface ReleaseList {
  releases: readonly Release[];
  /** ISO 8601 timestamp of when the list was obtained. */
  fetchedAt: string;
}

function isRelease(value: unknown): value is Release {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.tag === 'string' &&
    typeof candidate.version === 'string' &&
    typeof candidate.htmlUrl === 'string' &&
    (typeof candidate.name === 'string' || candidate.name === null) &&
    (typeof candidate.body === 'string' || candidate.body === null) &&
    (typeof candidate.publishedAt === 'string' ||
      candidate.publishedAt === null)
  );
}

/** Validate the endpoint payload at the boundary; `null` means "unusable". */
export function parseReleaseList(payload: unknown): ReleaseList | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const { releases, fetchedAt } = payload as Record<string, unknown>;
  if (!Array.isArray(releases) || releases.length === 0) return null;
  if (!releases.every(isRelease)) return null;
  if (typeof fetchedAt !== 'string' || fetchedAt.length === 0) return null;
  return { releases: releases as Release[], fetchedAt };
}

/**
 * Snapshot in, freshest-known list out. Any failure (offline, non-JSON dev
 * server, endpoint absent) keeps the snapshot — the page always renders.
 */
export function useLiveReleases(snapshot: ReleaseList): ReleaseList {
  const [list, setList] = useState(snapshot);

  useEffect(() => {
    const controller = new AbortController();

    void (async () => {
      try {
        const response = await fetch(FEED_URL, {
          headers: { accept: 'application/json' },
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`${FEED_URL} responded ${response.status}`);
        }
        const parsed = parseReleaseList(await response.json());
        if (!parsed) {
          throw new Error(`${FEED_URL} returned an unexpected payload`);
        }
        if (!controller.signal.aborted) setList(parsed);
      } catch (cause) {
        if (controller.signal.aborted) return;
        console.warn(
          '[changelog] live release feed unavailable — showing the build-time snapshot',
          cause,
        );
      }
    })();

    return () => controller.abort();
  }, []);

  return list;
}
