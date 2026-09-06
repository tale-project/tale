import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DRIVE_LIST_MAX_ITEMS,
  DRIVE_SEARCH_MAX_ITEMS,
  isGoogleWorkspaceMime,
  listFiles,
} from './list_files';

describe('isGoogleWorkspaceMime', () => {
  it('treats native Docs/Sheets as non-binary', () => {
    expect(isGoogleWorkspaceMime('application/vnd.google-apps.document')).toBe(
      true,
    );
    expect(
      isGoogleWorkspaceMime('application/vnd.google-apps.spreadsheet'),
    ).toBe(true);
  });

  it('allows folders and ordinary files', () => {
    expect(isGoogleWorkspaceMime('application/vnd.google-apps.folder')).toBe(
      false,
    );
    expect(isGoogleWorkspaceMime('application/pdf')).toBe(false);
    expect(isGoogleWorkspaceMime(undefined)).toBe(false);
  });
});

/**
 * Regression: the browse/search walk followed `nextPageToken` with no
 * bound — a short search term over a large tenant meant hundreds of
 * sequential Drive calls and an unbounded array inside one request.
 */
type DriveFile = { id: string; name: string; size?: string; mimeType?: string };

const file = (i: number): DriveFile => ({
  id: `f${i}`,
  name: `file-${i}.txt`,
  size: '10',
  mimeType: 'text/plain',
});

/** Stub Drive that pages `files.list` `pageSize` items at a time through
 * `nextPageToken` (= the next offset) and records every URL. */
function stubDrive(items: DriveFile[], pageSize: number): string[] {
  const urls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string) => {
      urls.push(input);
      const parsed = new URL(input);
      const offset = Number(parsed.searchParams.get('pageToken') ?? '0');
      const files = items.slice(offset, offset + pageSize);
      const next = offset + pageSize;
      const body: Record<string, unknown> = { files };
      if (next < items.length) body.nextPageToken = String(next);
      return Promise.resolve(Response.json(body));
    }),
  );
  return urls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('listFiles', () => {
  it('follows nextPageToken to the end and says the walk was whole', async () => {
    const urls = stubDrive(
      Array.from({ length: 250 }, (_, i) => file(i)),
      100,
    );

    const out = await listFiles('tok', 'folder-1');

    expect(out.success).toBe(true);
    expect(out.items).toHaveLength(250);
    expect(out.truncated).toBe(false);
    expect(urls).toHaveLength(3);
    expect(urls[0]).toContain('%27folder-1%27+in+parents');
  });

  it('stops a folder listing at the bound and says so', async () => {
    const urls = stubDrive(
      Array.from({ length: DRIVE_LIST_MAX_ITEMS + 150 }, (_, i) => file(i)),
      1000,
    );

    const out = await listFiles('tok', 'folder-1');

    expect(out.items).toHaveLength(DRIVE_LIST_MAX_ITEMS);
    expect(out.truncated).toBe(true);
    expect(urls).toHaveLength(DRIVE_LIST_MAX_ITEMS / 1000);
  });

  it('bounds a search tighter than a folder browse', async () => {
    const urls = stubDrive(
      Array.from({ length: 2000 }, (_, i) => file(i)),
      100,
    );

    const out = await listFiles('tok', undefined, 'report');

    expect(out.items).toHaveLength(DRIVE_SEARCH_MAX_ITEMS);
    expect(out.truncated).toBe(true);
    expect(urls).toHaveLength(DRIVE_SEARCH_MAX_ITEMS / 100);
    expect(urls[0]).toContain('report');
  });

  it('a listing that lands exactly on the bound is whole', async () => {
    stubDrive(
      Array.from({ length: DRIVE_SEARCH_MAX_ITEMS }, (_, i) => file(i)),
      100,
    );

    const out = await listFiles('tok', undefined, 'report');

    expect(out.items).toHaveLength(DRIVE_SEARCH_MAX_ITEMS);
    expect(out.truncated).toBe(false);
  });

  it('gives up on a page-token cycle and reports the cut', async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(Response.json({ files: [], nextPageToken: 'again' })),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const out = await listFiles('tok', 'folder-1');

    expect(out).toEqual({ success: true, items: [], truncated: true });
    expect(fetchSpy).toHaveBeenCalledTimes(500);
  });
});
