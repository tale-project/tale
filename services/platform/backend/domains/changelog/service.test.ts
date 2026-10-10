// @vitest-environment node

/**
 * The release notes are read from GitHub's release list one page at a time.
 * A reader names the version they are on; the list goes back until a page
 * reaches it, three pages at most. A page that fails after the first costs
 * the older releases only; a first page that fails is an error.
 */

import { describe, expect, it, vi } from 'vitest';

import { listReleases, type Release } from './service.ts';

function release(version: string): Release {
  return {
    tag: `v${version}`,
    version,
    name: null,
    body: null,
    htmlUrl: `https://example.test/releases/v${version}`,
    publishedAt: null,
  };
}

/** A fetcher over fixed pages; a page that is an `Error` rejects with it. */
function pagesOf(pages: (string[] | Error)[]) {
  return vi.fn((page: number): Promise<Release[]> => {
    const content = pages[page - 1] ?? [];
    return content instanceof Error
      ? Promise.reject(content)
      : Promise.resolve(content.map(release));
  });
}

const versions = (releases: Release[]): string[] =>
  releases.map(({ version }) => version);

describe('listReleases', () => {
  it('reads the newest page alone when the reader names no version [CLOG-R2]', async () => {
    const fetcher = pagesOf([['0.5.9', '0.5.8'], ['0.5.7']]);
    expect(versions(await listReleases({ fetcher }))).toEqual([
      '0.5.9',
      '0.5.8',
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('reads back until a page reaches the reader’s version [CLOG-R2]', async () => {
    const fetcher = pagesOf([
      ['0.5.9', '0.5.8'],
      ['0.5.7', '0.5.6'],
      ['0.5.5', '0.5.4'],
    ]);
    expect(versions(await listReleases({ from: '0.5.7', fetcher }))).toEqual([
      '0.5.9',
      '0.5.8',
      '0.5.7',
      '0.5.6',
    ]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('stops after three pages however far behind the reader is [CLOG-R2]', async () => {
    const fetcher = pagesOf([['0.5.9'], ['0.5.8'], ['0.5.7'], ['0.5.6']]);
    expect(versions(await listReleases({ from: '0.1.0', fetcher }))).toEqual([
      '0.5.9',
      '0.5.8',
      '0.5.7',
    ]);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('keeps the newer releases when an older page cannot be loaded [CLOG-R3]', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const fetcher = pagesOf([['0.5.9', '0.5.8'], new Error('offline')]);
      expect(versions(await listReleases({ from: '0.5.1', fetcher }))).toEqual([
        '0.5.9',
        '0.5.8',
      ]);
    } finally {
      warn.mockRestore();
    }
  });

  it('fails when the newest page cannot be loaded [CLOG-R4]', async () => {
    const fetcher = pagesOf([new Error('offline')]);
    await expect(listReleases({ from: '0.5.1', fetcher })).rejects.toThrow(
      'offline',
    );
  });
});
