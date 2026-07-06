import { afterEach, describe, expect, it, vi } from 'vitest';

import { listFolderContents } from './list_folder_contents';

type GraphChild = {
  id: string;
  name: string;
  size: number;
  file?: { mimeType?: string };
  folder?: Record<string, never>;
  lastModifiedDateTime?: string;
};

/** Stub Graph: maps folder itemId → children. */
function stubGraph(tree: Record<string, GraphChild[]>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const itemId = /items\/([^/]+)\/children/.exec(url)?.[1];
      const value = itemId ? tree[itemId] : undefined;
      if (!value) {
        return new Response('not found', { status: 404 });
      }
      return Response.json({ value });
    }),
  );
}

const file = (id: string, name: string): GraphChild => ({
  id,
  name,
  size: 10,
  file: { mimeType: 'text/plain' },
  lastModifiedDateTime: '2026-01-01T00:00:00Z',
});

const folder = (id: string, name: string): GraphChild => ({
  id,
  name,
  size: 0,
  folder: {},
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('listFolderContents', () => {
  it('lists direct files only when not recursive', async () => {
    stubGraph({
      root: [file('f1', 'a.txt'), folder('sub', 'Sub')],
      sub: [file('f2', 'b.txt')],
    });

    const result = await listFolderContents({ itemId: 'root', token: 't' });

    expect(result.success).toBe(true);
    expect(result.files?.map((f) => f.id)).toEqual(['f1']);
    expect(result.files?.[0].relativePath).toBeUndefined();
  });

  // Regression: sync only picked up a folder's top-level files, so anything
  // in a subfolder silently never synced.
  it('walks subfolders and stamps relativePath when recursive', async () => {
    stubGraph({
      root: [file('f1', 'a.txt'), folder('sub', 'Sub')],
      sub: [file('f2', 'b.txt'), folder('deep', 'Deep')],
      deep: [file('f3', 'c.txt')],
    });

    const result = await listFolderContents({
      itemId: 'root',
      token: 't',
      recursive: true,
    });

    expect(result.success).toBe(true);
    expect(result.files?.map((f) => f.relativePath)).toEqual([
      'a.txt',
      'Sub/b.txt',
      'Sub/Deep/c.txt',
    ]);
  });

  it('propagates Graph errors', async () => {
    stubGraph({});

    const result = await listFolderContents({ itemId: 'root', token: 't' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('404');
  });

  // Regression: a folder larger than one Graph page (~200 items) only listed
  // its first page, so the sync reconcile pruned every later file as "gone".
  it('follows @odata.nextLink across pages', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('skiptoken=PAGE2')) {
          return Promise.resolve(
            Response.json({ value: [file('f3', 'c.txt')] }),
          );
        }
        return Promise.resolve(
          Response.json({
            value: [file('f1', 'a.txt'), file('f2', 'b.txt')],
            '@odata.nextLink':
              'https://graph.microsoft.com/v1.0/me/drive/items/root/children?$skiptoken=PAGE2',
          }),
        );
      }),
    );

    const result = await listFolderContents({ itemId: 'root', token: 't' });

    expect(result.success).toBe(true);
    expect(result.files?.map((f) => f.id)).toEqual(['f1', 'f2', 'f3']);
  });

  // A never-ending nextLink must fail the listing, never return a truncated
  // set — a short read would make reconcile delete the un-listed documents.
  it('throws rather than truncating when pagination never ends', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          Response.json({
            value: [file('f', 'x.txt')],
            '@odata.nextLink':
              'https://graph.microsoft.com/v1.0/me/drive/items/root/children?$skiptoken=LOOP',
          }),
        ),
      ),
    );

    const result = await listFolderContents({ itemId: 'root', token: 't' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('pages');
  });
});
