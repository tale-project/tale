// @vitest-environment node

/**
 * The release notes are read from GitHub's release list one page at a time.
 * A reader names the version they are on; the list goes back until a page
 * reaches it, three pages at most. A page that fails after the first costs
 * the older releases only; a first page that fails is an error, and so is a
 * first page that lists no release.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

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

/** One release as GitHub's release list renders it: its tag, date and notes. */
function releaseEntry(version: string): string {
  return [
    `<a href="/tale-project/tale/releases/tag/v${version}">v${version}</a>`,
    '<relative-time datetime="2026-10-01T08:00:00Z"></relative-time>',
    `<div data-test-selector="body-content" class="markdown-body"><p>Notes for ${version}</p></div>`,
  ].join('\n');
}

const releasesPage = (...listed: string[]): string =>
  `<html><body>${listed.map(releaseEntry).join('\n')}</body></html>`;

/** A page past the end of the list: GitHub answers it 200, with no release. */
const PAST_THE_END =
  '<html><body><h2>There aren’t any releases here</h2></body></html>';

/** A first page after GitHub changed its markup: a release is listed, but
 * no notes can be read. */
const UNREADABLE_PAGE =
  '<html><body><a href="/tale-project/tale/releases/tag/v0.5.9">v0.5.9</a>' +
  '<div data-testid="release-notes"><p>Notes</p></div></body></html>';

describe('reading the release list from GitHub', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** GitHub answering each page from `pages`; a page not listed is past the
   * end of the list. */
  function github(pages: Record<number, () => Response>) {
    return vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const answer = pages[Number(url.searchParams.get('page') ?? '1')];
      return Promise.resolve(answer?.() ?? new Response(PAST_THE_END));
    });
  }

  /** `listReleases` on a service that has kept no page yet: the pages it
   * reads are kept for the whole process. */
  async function freshListReleases() {
    vi.resetModules();
    return (await import('./service.ts')).listReleases;
  }

  it('fails when the first page lists no release it can read [CLOG-R4]', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    github({ 1: () => new Response(UNREADABLE_PAGE) });
    const listReleasesNow = await freshListReleases();

    await expect(listReleasesNow()).rejects.toThrow('listed no release');
  });

  it('asks GitHub again on the next visit after the first page could not be read [CLOG-R5]', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let firstPage = () => new Response('unavailable', { status: 503 });
    const fetch = github({ 1: () => firstPage() });
    const listReleasesNow = await freshListReleases();

    await expect(listReleasesNow()).rejects.toThrow();
    firstPage = () => new Response(UNREADABLE_PAGE);
    await expect(listReleasesNow()).rejects.toThrow('listed no release');
    firstPage = () => new Response(releasesPage('0.5.9', '0.5.8'));
    expect(versions(await listReleasesNow())).toEqual(['0.5.9', '0.5.8']);
    expect(fetch).toHaveBeenCalledTimes(3);

    // A page that was read is kept: the next visit does not ask GitHub.
    expect(versions(await listReleasesNow())).toEqual(['0.5.9', '0.5.8']);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('ends the list where GitHub’s pages run out [CLOG-R2]', async () => {
    const fetch = github({
      1: () => new Response(releasesPage('0.5.9', '0.5.8')),
    });
    const listReleasesNow = await freshListReleases();

    expect(versions(await listReleasesNow({ from: '0.1.0' }))).toEqual([
      '0.5.9',
      '0.5.8',
    ]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
