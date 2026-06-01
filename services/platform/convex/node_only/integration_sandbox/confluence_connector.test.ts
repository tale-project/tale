import fs from 'node:fs';
import path from 'node:path';

import { transform } from 'sucrase';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { executeIntegrationImpl } from './execute_integration_impl';
import type { StorageProvider } from './types';

// Load and transpile the real shipped connector, exactly as the sandbox does.
const connectorCode = transform(
  fs.readFileSync(
    path.resolve(
      __dirname,
      '../../../../../examples/default/integrations/confluence/connector.ts',
    ),
    'utf-8',
  ),
  { transforms: ['typescript'], disableESTransforms: true },
).code;

const SECRETS = {
  username: 'me@example.com',
  password: 'tok',
  domain: 'mysite',
};
const ALLOWED = ['atlassian.net'];

// Feed the sandbox a fixed sequence of HTTP responses and record requested URLs.
function seqFetch(responses: Array<() => Response>): string[] {
  let i = 0;
  const calls: string[] = [];
  globalThis.fetch = Object.assign(
    vi.fn().mockImplementation((url: string) => {
      calls.push(url);
      const factory = responses[i++];
      if (!factory) throw new Error('Unexpected fetch: ' + url);
      return Promise.resolve(factory());
    }),
    { preconnect: vi.fn() },
  );
  return calls;
}

function json(data: unknown, status = 200): () => Response {
  return () =>
    new Response(JSON.stringify(data), {
      status,
      headers: { 'content-type': 'application/json' },
    });
}

function page(id: string, version: number) {
  return {
    id,
    title: 'Page ' + id,
    version: { number: version, when: '2026-01-01T00:00:00Z' },
    ancestors: [{ title: 'Home' }],
    space: { key: 'ENG' },
    _links: { webui: '/spaces/ENG/pages/' + id },
  };
}

let stored: Array<{ data: string; fileName: string; contentType: string }>;
function mockStorage(): StorageProvider {
  stored = [];
  return {
    download() {
      return Promise.reject(new Error('download is not used by Confluence'));
    },
    store(args) {
      stored.push({
        data: args.data,
        fileName: args.fileName,
        contentType: args.contentType,
      });
      return Promise.resolve({
        fileId: 'stor_' + stored.length,
        url: 'https://storage.example.com/' + stored.length,
        fileName: args.fileName,
        contentType: args.contentType,
        size: args.data.length,
      });
    },
  };
}

describe('Confluence connector', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('list_pages follows _links.next cursor pagination and maps page fields', async () => {
    const base = 'https://mysite.atlassian.net/wiki';
    // Real shape verified against the live API: `next` is relative to `base`,
    // carries a cursor, and omits the `/wiki` prefix that `base` provides.
    const next =
      '/rest/api/content/search?next=true&cursor=X3RfW10&limit=100&start=100&cql=type%3Dpage';
    const calls = seqFetch([
      json({ results: [page('1', 3)], _links: { base, next } }),
      json({ results: [page('2', 7)], _links: { base } }),
    ]);

    const out = await executeIntegrationImpl({
      code: connectorCode,
      operation: 'list_pages',
      params: { spaceKey: 'ENG' },
      variables: {},
      secrets: SECRETS,
      allowedHosts: ALLOWED,
      timeoutMs: 5000,
    });

    expect(out.success).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain('/wiki/rest/api/content/search?cql=');
    // CQL must NOT carry a `status` field — Confluence rejects it with HTTP 400.
    const cql = decodeURIComponent(calls[0].split('cql=')[1].split('&')[0]);
    expect(cql).toBe('space="ENG" and type=page');
    expect(calls[1]).toBe(base + next);

    const result = out.result as {
      data: {
        truncated: boolean;
        pages: Array<{
          id: string;
          version: number;
          spaceKey: string;
          ancestorPath: string;
          webUrl: string;
        }>;
      };
    };
    expect(result.data.truncated).toBe(false);
    expect(result.data.pages).toHaveLength(2);
    expect(result.data.pages[0]).toMatchObject({
      id: '1',
      version: 3,
      spaceKey: 'ENG',
      ancestorPath: 'Home',
      webUrl: base + '/spaces/ENG/pages/1',
    });
  });

  it('list_pages nests a container page into its own folder (page-as-folder)', async () => {
    const base = 'https://mysite.atlassian.net/wiki';
    const ver = { number: 1, when: '2026-01-01T00:00:00Z' };
    seqFetch([
      json({
        results: [
          // Parent page "10" (Overview) — referenced as an ancestor by "11".
          {
            id: '10',
            title: 'Overview',
            version: ver,
            ancestors: [],
            space: { key: 'ENG' },
            _links: { webui: '/spaces/ENG/pages/10' },
          },
          // Leaf child "11" lists Overview (id 10) as its ancestor.
          {
            id: '11',
            title: 'Child',
            version: ver,
            ancestors: [{ id: '10', title: 'Overview' }],
            space: { key: 'ENG' },
            _links: { webui: '/spaces/ENG/pages/11' },
          },
        ],
        _links: { base },
      }),
    ]);

    const out = await executeIntegrationImpl({
      code: connectorCode,
      operation: 'list_pages',
      params: { spaceKey: 'ENG' },
      variables: {},
      secrets: SECRETS,
      allowedHosts: ALLOWED,
      timeoutMs: 5000,
    });

    expect(out.success).toBe(true);
    const result = out.result as {
      data: {
        pages: Array<{
          id: string;
          hasChildren: boolean;
          folderSubPath: string;
        }>;
      };
    };
    const overview = result.data.pages.find((p) => p.id === '10');
    const child = result.data.pages.find((p) => p.id === '11');
    // The container page becomes a folder named after itself — its own content
    // and its children both live under "Overview/" (no same-named sibling).
    expect(overview?.hasChildren).toBe(true);
    expect(overview?.folderSubPath).toBe('Overview');
    expect(child?.hasChildren).toBe(false);
    expect(child?.folderSubPath).toBe('Overview');
  });

  it('get_page converts rendered HTML to plain text and returns the Drive-shaped envelope', async () => {
    seqFetch([
      json({
        body: {
          export_view: { value: '<h1>Title</h1><p>Hello <b>world</b></p>' },
          storage: { value: '' },
        },
      }),
    ]);

    const out = await executeIntegrationImpl({
      code: connectorCode,
      operation: 'get_page',
      params: { pageId: '42', title: 'Guide' },
      variables: {},
      secrets: SECRETS,
      allowedHosts: ALLOWED,
      timeoutMs: 5000,
      storageProvider: mockStorage(),
    });

    expect(out.success).toBe(true);
    // The sync workflow reads fileId, size, and contentType off this envelope.
    const result = out.result as {
      data: { fileId: string; size: number; contentType: string };
    };
    expect(result.data.fileId).toBe('stor_1');
    expect(result.data.contentType).toBe('text/plain');
    expect(result.data.size).toBeGreaterThan(0);
    expect(stored[0]).toMatchObject({
      fileName: 'Guide.txt',
      contentType: 'text/plain',
      data: 'Title\nHello world',
    });
  });

  it('get_page falls back to storage format when export_view is a near-empty husk', async () => {
    seqFetch([
      json({
        body: {
          export_view: { value: '<p></p>' },
          storage: { value: '<p>Macro body text that survived</p>' },
        },
      }),
    ]);

    const out = await executeIntegrationImpl({
      code: connectorCode,
      operation: 'get_page',
      params: { pageId: '7', title: 'Macro Page' },
      variables: {},
      secrets: SECRETS,
      allowedHosts: ALLOWED,
      timeoutMs: 5000,
      storageProvider: mockStorage(),
    });

    expect(out.success).toBe(true);
    expect(stored[0].data).toBe('Macro body text that survived');
  });

  it('get_page skips a restricted (403) page without storing anything', async () => {
    seqFetch([json({ message: 'forbidden' }, 403)]);

    const out = await executeIntegrationImpl({
      code: connectorCode,
      operation: 'get_page',
      params: { pageId: '99', title: 'Secret' },
      variables: {},
      secrets: SECRETS,
      allowedHosts: ALLOWED,
      timeoutMs: 5000,
      storageProvider: mockStorage(),
    });

    expect(out.success).toBe(false);
    expect(out.error).toMatch(/restricted/);
    expect(stored).toHaveLength(0);
  });

  it('rejects a malformed site domain with a clear setup error', async () => {
    seqFetch([]);

    const out = await executeIntegrationImpl({
      code: connectorCode,
      operation: 'list_pages',
      params: { spaceKey: 'ENG' },
      variables: {},
      secrets: { username: 'a@b.com', password: 't', domain: 'evil.com/@x' },
      allowedHosts: ALLOWED,
      timeoutMs: 5000,
    });

    expect(out.success).toBe(false);
    expect(out.error).toMatch(/not configured or is invalid/);
  });
});
