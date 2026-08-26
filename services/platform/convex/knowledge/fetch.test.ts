// @vitest-environment node

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { KnowledgeAccessScope } from '../../lib/knowledge/types';
import {
  fetchDocumentByFileId as fetchDocumentByFileIdImpl,
  fetchWebPageByUrl,
} from './fetch';
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
const validateLiveFile = vi.fn(
  async (_ref: unknown, args: { fileIds: string[] }) => args.fileIds,
);

function fetchDocumentByFileId(
  orgSlug: string,
  fileId: string,
  access?: KnowledgeAccessScope,
) {
  return fetchDocumentByFileIdImpl({ runQuery: validateLiveFile } as never, {
    organizationId: 'org_1',
    orgSlug,
    fileId,
    ...(access !== undefined ? { access } : {}),
  });
}

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
  validateLiveFile.mockReset();
  validateLiveFile.mockImplementation(
    async (_ref: unknown, args: { fileIds: string[] }) => args.fileIds,
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
      // Surfaced so a caller can tell whether this text arrived by email and
      // must be wrapped as untrusted. Null for a hub document.
      conversationId: null,
    });
    // Both statements are org-scoped, and the chunk read addresses the
    // document's own id, never the caller-supplied file id.
    const [docCall, chunkCall] = unsafe.mock.calls;
    expect(docCall?.[0]).toContain('org_slug = $1');
    expect(docCall?.[0]).toContain("d.status = 'completed'");
    expect(docCall?.[1]).toEqual(['acme', 'file_9']);
    expect(chunkCall?.[0]).toContain('ORDER BY c.chunk_index');
    expect(chunkCall?.[1]).toEqual(['acme', '42']);
  });

  it('answers an unknown file id with null, without reading chunks', async () => {
    unsafe.mockResolvedValue([]);
    expect(await fetchDocumentByFileId('acme', 'file_missing')).toBeNull();
    expect(unsafe).toHaveBeenCalledTimes(1);
  });

  it('fails closed when live Convex state says the corpus ref is incomplete or stale', async () => {
    unsafe.mockResolvedValueOnce([
      {
        id: '42',
        filename: 'old.pdf',
        folder_path: null,
        modified_at: null,
      },
    ]);
    validateLiveFile.mockResolvedValueOnce([]);

    expect(await fetchDocumentByFileId('acme', 'file_stale')).toBeNull();
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

describe('fetchDocumentByFileId — access scope', () => {
  // The fetch-side twin of the search filter: a scoped caller holding a ref
  // (quoted from an old chat, guessed, leaked) must not read what a search
  // would never have shown them, and a denial must be indistinguishable from
  // a missing document.
  const SCOPED: KnowledgeAccessScope = {
    teamIds: ['team-a'],
    projectIds: ['proj-1'],
    includeHub: true,
  };

  /** Corpus double: one document row plus a chunk body that must never be
   * served to a denied caller. */
  function corpusWith(row: Record<string, unknown>): void {
    unsafe.mockImplementation((text) => {
      if (text.includes('.documents')) {
        return Promise.resolve([
          {
            id: '7',
            filename: 'doc.pdf',
            folder_path: null,
            modified_at: null,
            ...row,
          },
        ]);
      }
      if (text.includes('.chunks')) {
        return Promise.resolve([{ core_content: 'SCOPED BODY' }]);
      }
      return Promise.reject(new Error(`unexpected statement: ${text}`));
    });
  }

  it('joins the scope stamp into the statement the fetch already runs — no second round-trip', async () => {
    corpusWith({ team_id: null, project_id: null });
    await fetchDocumentByFileId('acme', 'file_9', SCOPED);
    const [docCall] = unsafe.mock.calls;
    expect(docCall?.[0]).toContain('d.team_ids, d.team_id, d.project_id');
    expect(docCall?.[0]).toContain('org_slug = $1');
  });

  it('an org-wide caller keeps today’s statement byte-for-byte — no scope columns selected', async () => {
    // A corpus that predates the scope migration has no team_id/project_id
    // columns; selecting them for an admin-keyed surface would break it.
    corpusWith({});
    await fetchDocumentByFileId('acme', 'file_9');
    const [docCall] = unsafe.mock.calls;
    expect(docCall?.[0]).not.toContain('team_id');
    expect(docCall?.[0]).not.toContain('project_id');
  });

  it('serves a hub row (no team, no project) when the scope includes the hub', async () => {
    corpusWith({ team_id: null, project_id: null });
    const doc = await fetchDocumentByFileId('acme', 'file_9', SCOPED);
    expect(doc?.text).toBe('SCOPED BODY');
  });

  it('hides hub rows from a caller without hub visibility', async () => {
    corpusWith({ team_id: null, project_id: null });
    const doc = await fetchDocumentByFileId('acme', 'file_9', {
      ...SCOPED,
      includeHub: false,
    });
    expect(doc).toBeNull();
  });

  it('does not serve an emailed attachment to a caller who cannot read mail', async () => {
    // Scope-by-set cannot decide a conversation row, so the SQL half only
    // decides whether such rows are in play at all. A caller whose scope
    // excludes them gets a miss without a Convex round-trip, and the body is
    // never read.
    corpusWith({ team_id: null, project_id: null, conversation_id: 'conv_1' });
    const doc = await fetchDocumentByFileId('acme', 'file_9', SCOPED);
    expect(doc).toBeNull();
    expect(unsafe.mock.calls.some(([text]) => text.includes('.chunks'))).toBe(
      false,
    );
    expect(validateLiveFile).not.toHaveBeenCalled();
  });

  it('hands an emailed attachment to the Convex re-check, hub visibility notwithstanding', async () => {
    // Its scope columns are all NULL, so scope-by-set would read it as an
    // org-hub document and serve it. It must instead reach the re-check, which
    // is the only code that can see the conversation's assignment.
    corpusWith({ team_id: null, project_id: null, conversation_id: 'conv_1' });
    validateLiveFile.mockImplementation(async () => []);
    const denied = await fetchDocumentByFileId('acme', 'file_9', {
      ...SCOPED,
      includeConversationScoped: true,
    });
    expect(denied).toBeNull();
    expect(validateLiveFile).toHaveBeenCalled();

    validateLiveFile.mockImplementation(
      async (_ref: unknown, args: { fileIds: string[] }) => args.fileIds,
    );
    const served = await fetchDocumentByFileId('acme', 'file_9', {
      ...SCOPED,
      includeConversationScoped: true,
    });
    expect(served?.text).toBe('SCOPED BODY');
  });

  it('selects the conversation column for a scoped caller', async () => {
    corpusWith({ team_id: null, project_id: null });
    await fetchDocumentByFileId('acme', 'file_9', SCOPED);
    const [docCall] = unsafe.mock.calls;
    expect(docCall?.[0]).toContain('d.conversation_id');
  });

  it('serves a team-library row to a member of that team', async () => {
    corpusWith({
      team_ids: ['team-a'],
      team_id: 'team-a',
      project_id: null,
    });
    const doc = await fetchDocumentByFileId('acme', 'file_9', SCOPED);
    expect(doc?.text).toBe('SCOPED BODY');
  });

  it('serves a multi-team row to a member of its SECOND team', async () => {
    // The regression the array fixed: a document shared to several teams was
    // fetchable only by the first team's members, though the library listed
    // it for all of them.
    corpusWith({
      team_ids: ['team-OTHER', 'team-a'],
      team_id: 'team-OTHER',
      project_id: null,
    });
    const doc = await fetchDocumentByFileId('acme', 'file_9', SCOPED);
    expect(doc?.text).toBe('SCOPED BODY');
  });

  it('denies a multi-team row to a member of NONE of its teams', async () => {
    corpusWith({
      team_ids: ['team-OTHER', 'team-THIRD'],
      team_id: 'team-OTHER',
      project_id: null,
    });
    expect(await fetchDocumentByFileId('acme', 'file_9', SCOPED)).toBeNull();
    expect(unsafe).toHaveBeenCalledTimes(1);
  });

  it('the array is the truth: a stale single-team mirror never widens it', async () => {
    corpusWith({
      team_ids: ['team-OTHER'],
      team_id: 'team-a',
      project_id: null,
    });
    expect(await fetchDocumentByFileId('acme', 'file_9', SCOPED)).toBeNull();
  });

  it('reads a row the array DDL has not stamped by its single-team mirror', async () => {
    // Written before the `team_ids` migration: only `team_id` carries scope.
    corpusWith({ team_ids: null, team_id: 'team-a', project_id: null });
    const doc = await fetchDocumentByFileId('acme', 'file_9', SCOPED);
    expect(doc?.text).toBe('SCOPED BODY');
  });

  it('serves a project row to a caller with access to that project', async () => {
    corpusWith({ team_id: null, project_id: 'proj-1' });
    const doc = await fetchDocumentByFileId('acme', 'file_9', SCOPED);
    expect(doc?.text).toBe('SCOPED BODY');
  });

  it('denies an out-of-scope row BEFORE the chunk read — the same null as a missing document', async () => {
    corpusWith({ team_id: 'team-OTHER', project_id: null });
    const denied = await fetchDocumentByFileId('acme', 'file_9', SCOPED);
    // Only the document statement ran: denied content is never even loaded.
    expect(unsafe).toHaveBeenCalledTimes(1);

    unsafe.mockClear();
    unsafe.mockResolvedValue([]);
    const missing = await fetchDocumentByFileId('acme', 'file_gone', SCOPED);

    expect(denied).toBeNull();
    expect(denied).toEqual(missing);
  });

  it('denies an out-of-scope project row the same way', async () => {
    corpusWith({ team_id: null, project_id: 'proj-OTHER' });
    expect(await fetchDocumentByFileId('acme', 'file_9', SCOPED)).toBeNull();
    expect(unsafe).toHaveBeenCalledTimes(1);
  });

  it('a row stamped before the backfill (both columns absent) reads as a hub row', async () => {
    // Rows ingested before scoping existed come back without the columns at
    // all on a pre-migration corpus mid-rollout; they keep hub visibility.
    corpusWith({});
    const doc = await fetchDocumentByFileId('acme', 'file_9', SCOPED);
    expect(doc?.text).toBe('SCOPED BODY');
    expect(
      await fetchDocumentByFileId('acme', 'file_9', {
        ...SCOPED,
        includeHub: false,
      }),
    ).toBeNull();
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
