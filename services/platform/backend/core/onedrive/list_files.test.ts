import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchGraphCollection } from './graph_collection';
import { listFiles } from './list_files';
import { listSharePointFiles } from './list_sharepoint_files';

/**
 * Regression: the browse/import listers took Graph's FIRST page only
 * (`$top=100`, `$top=200`) and never followed `@odata.nextLink`, so a folder
 * of 300 files showed 100 in the picker and a one-time folder import quietly
 * imported 100 while reporting success.
 */

type GraphChild = {
  id: string;
  name: string;
  size: number;
  file?: { mimeType?: string };
  folder?: { childCount?: number };
};

const file = (i: number): GraphChild => ({
  id: `f${i}`,
  name: `file-${i}.txt`,
  size: 10,
  file: { mimeType: 'text/plain' },
});

/**
 * Stub Graph that pages every `/children` and `/search` collection `pageSize`
 * items at a time through `@odata.nextLink` (`$skiptoken=<offset>`), and
 * records every URL it was asked for.
 */
function stubGraph(items: GraphChild[], pageSize: number): string[] {
  const urls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      urls.push(input);
      const parsed = new URL(input);
      const offset = Number(parsed.searchParams.get('$skiptoken') ?? '0');
      const value = items.slice(offset, offset + pageSize);
      const next = offset + pageSize;
      const body: Record<string, unknown> = { value };
      if (next < items.length) {
        parsed.searchParams.set('$skiptoken', String(next));
        body['@odata.nextLink'] = parsed.toString();
      }
      return Response.json(body);
    }),
  );
  return urls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchGraphCollection', () => {
  it('follows nextLink to the end and says the walk was whole', async () => {
    const urls = stubGraph(
      Array.from({ length: 450 }, (_, i) => file(i)),
      200,
    );
    const out = await fetchGraphCollection<GraphChild>({
      url: 'https://graph.microsoft.com/v1.0/me/drive/root/children?$top=200',
      token: 't',
      maxItems: 10_000,
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.items).toHaveLength(450);
    expect(out.truncated).toBe(false);
    expect(urls).toHaveLength(3);
  });

  it('stops at the bound and says the listing was cut', async () => {
    const urls = stubGraph(
      Array.from({ length: 1000 }, (_, i) => file(i)),
      200,
    );
    const out = await fetchGraphCollection<GraphChild>({
      url: 'https://graph.microsoft.com/v1.0/me/drive/root/children?$top=200',
      token: 't',
      maxItems: 500,
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.items).toHaveLength(500);
    expect(out.truncated).toBe(true);
    // Exactly the pages needed to reach the bound, not the whole folder.
    expect(urls).toHaveLength(3);
  });

  it('a page that overflows the bound is trimmed and flagged', async () => {
    stubGraph(
      Array.from({ length: 150 }, (_, i) => file(i)),
      200,
    );
    const out = await fetchGraphCollection<GraphChild>({
      url: 'https://graph.microsoft.com/v1.0/me/drive/root/children?$top=200',
      token: 't',
      maxItems: 100,
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.items).toHaveLength(100);
    expect(out.truncated).toBe(true);
  });

  it('surfaces a Graph error with its status and body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 403 })),
    );
    const out = await fetchGraphCollection<GraphChild>({
      url: 'https://graph.microsoft.com/v1.0/me/drive/root/children',
      token: 't',
      maxItems: 10,
    });
    expect(out).toEqual({ ok: false, status: 403, errorText: 'nope' });
  });
});

describe('listFiles (OneDrive browse)', () => {
  it('lists a multi-page folder whole', async () => {
    const urls = stubGraph(
      Array.from({ length: 300 }, (_, i) => file(i)),
      100,
    );
    const out = await listFiles('t', 'folder-1');
    expect(out.success).toBe(true);
    expect(out.items).toHaveLength(300);
    expect(out.truncated).toBe(false);
    expect(urls[0]).toContain('/items/folder-1/children');
    expect(urls).toHaveLength(3);
  });

  it('follows search pages too, and flags the search bound', async () => {
    stubGraph(
      Array.from({ length: 700 }, (_, i) => file(i)),
      200,
    );
    const out = await listFiles('t', undefined, 'report');
    expect(out.success).toBe(true);
    expect(out.items).toHaveLength(500);
    expect(out.truncated).toBe(true);
  });

  it('keeps the error contract on a failed page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('denied', { status: 401 })),
    );
    const out = await listFiles('t');
    expect(out.success).toBe(false);
    expect(out.error).toBe('OneDrive API error: 401 denied');
  });
});

describe('listSharePointFiles', () => {
  it('lists a multi-page library folder whole, folders first', async () => {
    const items: GraphChild[] = [
      ...Array.from({ length: 250 }, (_, i) => file(i)),
      { id: 'd1', name: 'Archive', size: 0, folder: { childCount: 3 } },
    ];
    const urls = stubGraph(items, 200);
    const out = await listSharePointFiles({
      siteId: 'site',
      driveId: 'drive',
      folderId: 'folder-1',
      token: 't',
    });
    expect(out.success).toBe(true);
    expect(out.items).toHaveLength(251);
    expect(out.items?.[0]?.name).toBe('Archive');
    expect(out.truncated).toBe(false);
    expect(urls).toHaveLength(2);
  });

  it('maps 403 and 404 to the picker’s sentences', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 404 })),
    );
    const out = await listSharePointFiles({
      siteId: 'site',
      driveId: 'drive',
      token: 't',
    });
    expect(out).toEqual({ success: false, error: 'Location not found.' });
  });
});
