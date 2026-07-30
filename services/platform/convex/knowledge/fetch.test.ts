// @vitest-environment node

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchDocumentByFileId, fetchWebPageByUrl } from './fetch';
import { closeKnowledgePools, setPoolFactory } from './pool';

/**
 * Whole-content reads are the same class of code as the corpus readers, so
 * they get the same class of test: a recording `sql.unsafe` double instead of
 * a database, because what matters is which statements are sent, that every
 * one is org-scoped, and that a corpus that was never created reads as an
 * honest miss. The pool is stubbed through the same `setPoolFactory` seam the
 * chokepoint tests use, so `getKnowledgePoolForOrg` still runs for real.
 */

const DEFAULT_URL = 'postgresql://tale:pw@knowledge-db:5432/tale_knowledge';

type Unsafe = (text: string, params?: unknown[]) => Promise<unknown[]>;

let configRoot: string;
let previousConfigDir: string | undefined;
let previousDatabaseUrl: string | undefined;
let unsafe: ReturnType<typeof vi.fn<Unsafe>>;

/** A pool double that answers every statement through the test's `unsafe`. */
function stubPool(): Sql {
  const sql = ((..._args: unknown[]) => Promise.resolve([])) as unknown as Sql;
  sql.end = () => Promise.resolve();
  sql.unsafe = ((text: string, params?: unknown[]) =>
    unsafe(text, params)) as unknown as Sql['unsafe'];
  return sql;
}

beforeEach(() => {
  configRoot = mkdtempSync(path.join(tmpdir(), 'knowledge-fetch-'));
  previousConfigDir = process.env.TALE_CONFIG_DIR;
  previousDatabaseUrl = process.env.KNOWLEDGE_DATABASE_URL;
  process.env.TALE_CONFIG_DIR = configRoot;
  process.env.KNOWLEDGE_DATABASE_URL = DEFAULT_URL;
  unsafe = vi.fn((_text: string, _params?: unknown[]) =>
    Promise.resolve<unknown[]>([]),
  );
  setPoolFactory(stubPool);
});

afterEach(async () => {
  await closeKnowledgePools();
  setPoolFactory(null);
  rmSync(configRoot, { recursive: true, force: true });
  if (previousConfigDir === undefined) delete process.env.TALE_CONFIG_DIR;
  else process.env.TALE_CONFIG_DIR = previousConfigDir;
  if (previousDatabaseUrl === undefined)
    delete process.env.KNOWLEDGE_DATABASE_URL;
  else process.env.KNOWLEDGE_DATABASE_URL = previousDatabaseUrl;
});

describe('fetchDocumentByFileId', () => {
  it('reassembles the document from its chunk spans in index order', async () => {
    const modified = new Date('2026-01-02T03:04:05Z');
    unsafe.mockImplementation((text) => {
      if (text.includes('.documents')) {
        return Promise.resolve([
          {
            id: '42',
            filename: 'handbook.pdf',
            folder_path: '/hr',
            modified_at: modified,
          },
        ]);
      }
      if (text.includes('.chunks')) {
        return Promise.resolve([{ core_content: 'A' }, { core_content: 'B' }]);
      }
      return Promise.reject(new Error(`unexpected statement: ${text}`));
    });

    const doc = await fetchDocumentByFileId('acme', 'file_9');

    expect(doc).toEqual({
      fileId: 'file_9',
      filename: 'handbook.pdf',
      folderPath: '/hr',
      modifiedAt: modified.getTime(),
      text: 'AB',
    });
    // Both statements are org-scoped, and the chunk read addresses the
    // document's own id, never the caller-supplied file id.
    const [docCall, chunkCall] = unsafe.mock.calls;
    expect(docCall?.[0]).toContain('org_slug = $1');
    expect(docCall?.[1]).toEqual(['acme', 'file_9']);
    expect(chunkCall?.[0]).toContain('ORDER BY c.chunk_index');
    expect(chunkCall?.[1]).toEqual(['acme', '42']);
  });

  it('answers an unknown file id with null, without reading chunks', async () => {
    unsafe.mockResolvedValue([]);
    expect(await fetchDocumentByFileId('acme', 'file_missing')).toBeNull();
    expect(unsafe).toHaveBeenCalledTimes(1);
  });

  it('reads a corpus that was never created as a miss, not an error', async () => {
    // `pool.ts::sqlState` only reads `code` off an Error INSTANCE — a plain
    // object with `.code` would not classify — so the double throws exactly
    // what postgres.js throws: an Error carrying the SQLSTATE.
    unsafe.mockImplementation(() =>
      Promise.reject(
        Object.assign(new Error('relation "documents" does not exist'), {
          code: '42P01',
        }),
      ),
    );
    expect(await fetchDocumentByFileId('acme', 'file_9')).toBeNull();
  });

  it('lets an unexpected database failure through rather than hiding it', async () => {
    unsafe.mockImplementation(() =>
      Promise.reject(
        Object.assign(new Error('permission denied'), { code: '42501' }),
      ),
    );
    await expect(fetchDocumentByFileId('acme', 'file_9')).rejects.toThrow(
      /permission denied/,
    );
  });
});

describe('fetchWebPageByUrl', () => {
  it('loads a crawled page through the membership join', async () => {
    const crawled = new Date('2026-03-04T05:06:07Z');
    unsafe.mockResolvedValue([
      {
        url: 'https://acme.com/pricing',
        title: 'Pricing',
        content: 'Full page text',
        last_crawled_at: crawled,
      },
    ]);

    const page = await fetchWebPageByUrl('acme', 'https://acme.com/pricing');

    expect(page).toEqual({
      url: 'https://acme.com/pricing',
      title: 'Pricing',
      lastCrawledAt: crawled.getTime(),
      text: 'Full page text',
    });
    // The membership join is the ONLY thing that scopes this corpus.
    const [text, params] = unsafe.mock.calls[0] ?? [];
    expect(text).toContain('website_org_memberships');
    expect(text).toContain('m.org_slug = $1');
    expect(params?.[0]).toBe('acme');
  });

  it('matches the trailing-slash variant in both directions', async () => {
    unsafe.mockResolvedValue([]);
    await fetchWebPageByUrl('acme', 'https://acme.com/docs');
    await fetchWebPageByUrl('acme', 'https://acme.com/docs/');
    // ANY($2) carries the exact URL plus its slash sibling, so a model
    // quoting a search hit's ref never misses on a slash.
    expect(unsafe.mock.calls[0]?.[1]?.[1]).toEqual([
      'https://acme.com/docs',
      'https://acme.com/docs/',
    ]);
    expect(unsafe.mock.calls[1]?.[1]?.[1]).toEqual([
      'https://acme.com/docs/',
      'https://acme.com/docs',
    ]);
  });

  it('reads a page with no stored content as a miss', async () => {
    unsafe.mockResolvedValue([
      {
        url: 'https://acme.com/empty',
        title: 'Empty',
        content: null,
        last_crawled_at: null,
      },
    ]);
    expect(
      await fetchWebPageByUrl('acme', 'https://acme.com/empty'),
    ).toBeNull();
  });

  it('answers an unknown URL with null', async () => {
    unsafe.mockResolvedValue([]);
    expect(await fetchWebPageByUrl('acme', 'https://acme.com/nope')).toBeNull();
  });

  it('reads a corpus that was never created as a miss, not an error', async () => {
    unsafe.mockImplementation(() =>
      Promise.reject(
        Object.assign(new Error('relation "website_urls" does not exist'), {
          code: '42P01',
        }),
      ),
    );
    expect(
      await fetchWebPageByUrl('acme', 'https://acme.com/pricing'),
    ).toBeNull();
  });
});
