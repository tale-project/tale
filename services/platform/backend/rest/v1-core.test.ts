// @vitest-environment node

import { Hono } from 'hono';
import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DocumentError } from '../domains/documents/service.ts';
import { FileError, openFileContent } from '../domains/files/service.ts';
import {
  findActiveEntryForDocument,
  getKnowledgeEntryVersions,
} from '../domains/knowledge_entries/service.ts';
import { PurgeIncompleteError } from '../domains/retention/service.ts';
import { entityTagOf } from '../lib/conditional-get.ts';
import {
  mintCursorFor,
  parseKeysetCursor,
  type RestEnv,
  verifyCursorFor,
} from './shared.ts';
import { createCoreRoutes } from './v1-core.ts';

// The documents door is driven against the real routes with only its two
// service calls replaced: the hub row loads, and the hard delete reports a
// purge the object store could not finish.
/** The hub row the mocked loads answer; tests reshape it per case. */
const hubDocument = {
  id: 'doc-hub',
  organizationId: 'org-1',
  projectId: null,
  title: 'Hub Note.md',
  fileRef: null as string | null,
  mimeType: 'text/markdown',
  extension: 'md',
  sourceProvider: 'api_import',
  teamId: null,
  folderId: null,
  metadata: null,
  createdBy: 'user-1',
  lifecycleStatus: null,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
};

vi.mock('../domains/documents/service.ts', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../domains/documents/service.ts')>();
  return {
    ...actual,
    getDocumentById: vi.fn(async () => ({ ...hubDocument })),
    requireDocumentWriteAccess: vi.fn(async () => ({ ...hubDocument })),
    readDocumentRestExtras: vi.fn(async () => ({
      content: 'beta content',
      record: null,
    })),
    readDocumentIndexing: vi.fn(async () => new Map()),
    updateDocument: vi.fn(async () => ({
      teamScopeChanged: false,
      folderChanged: false,
      fileRef: null,
    })),
    deleteDocumentHard: vi.fn(async () => {
      throw new PurgeIncompleteError('doc-hub', [
        { ref: 's3:acme/doc-hub', stage: 'blob', message: 'store down' },
      ]);
    }),
  };
});
vi.mock('../domains/knowledge_entries/service.ts', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../domains/knowledge_entries/service.ts')
  >()),
  findActiveEntryForDocument: vi.fn(async () => null),
  createKnowledgeEntry: vi.fn(async () => ({
    id: 'ke-new',
    documentId: 'doc-ke',
  })),
  updateKnowledgeEntry: vi.fn(async () => ({
    id: 'ke-next',
    documentId: 'doc-ke',
  })),
  getKnowledgeEntryVersions: vi.fn(async () => []),
}));
// The bytes lane's store seam: the Hub content route serves a file-backed
// document through the same `openFileContent` the project lane uses.
vi.mock('../domains/files/service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../domains/files/service.ts')>()),
  openFileContent: vi.fn(async () => null),
}));

/**
 * GET /contacts and GET /products honour the pagination they document. The
 * regression under test: both routes emitted `continueCursor` / `isDone`
 * but never read `?cursor=`, so a spec-following pager received page one
 * forever and an organization with more rows than one page could never
 * enumerate the rest through the REST door. The cursor now reaches the
 * service as bound parameters, the emitted token round-trips through the
 * shared codec, and `limit` is clamped so no client value becomes a
 * negative or zero `LIMIT`.
 */

interface Captured {
  text: string;
  values: unknown[];
}

/** Tagged-template Sql double answering the list query with `rows`; an
 * optional `respond` answers a query by its text first (the rate limiter's
 * UPSERT/SELECT pair, say), falling back to `rows`. */
function fakeSql(
  rows: object[],
  respond?: (text: string) => object[] | undefined,
): { sql: Sql; queries: Captured[] } {
  const queries: Captured[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('$?').replace(/\s+/g, ' ').trim();
    queries.push({ text, values });
    return Promise.resolve(respond?.(text) ?? rows);
  };
  const unsafe = (text: string) => ({ unsafe: text });
  const begin = (fn: (tx: unknown) => Promise<unknown>) => fn(sql);
  const sql = Object.assign(tag, { unsafe, begin });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { sql: sql as unknown as Sql, queries };
}

/** The limiter's state for a spent bucket: the charging UPSERT returns no
 * row and the read-back finds an empty bucket. */
function spentBucket(text: string): object[] | undefined {
  if (text.includes('INSERT INTO app.rate_limits')) return [];
  if (text.includes('FROM app.rate_limits')) {
    return [{ value: '0', ts: String(Date.now()) }];
  }
  return undefined;
}

function contactRow(n: number) {
  return {
    id: `c-${n}`,
    organizationId: 'org-1',
    name: `Contact ${n}`,
    email: `c${n}@example.com`,
    phone: null,
    externalId: null,
    source: 'manual',
    locale: null,
    address: null,
    tags: [],
    metadata: null,
    notes: null,
    lifecycleStatus: null,
    createdAt: 1_700_000_000_000 - n,
    updatedAt: 1_700_000_000_000 - n,
  };
}

function productRow(n: number) {
  return {
    id: `p-${n}`,
    organizationId: 'org-1',
    name: `Product ${n}`,
    description: null,
    imageUrl: null,
    stock: null,
    price: null,
    currency: null,
    category: null,
    tags: [],
    status: 'active',
    translations: null,
    externalId: null,
    metadata: null,
    createdAt: 1_700_000_000_000 - n,
    updatedAt: 1_700_000_000_000 - n,
  };
}

/** The core routes behind a stub door that sets the request variables. */
function mount(sql: Sql, apiKeyId = 'key-1', role = 'admin') {
  const app = new Hono<RestEnv>();
  app.use(async (c, next) => {
    c.set('userId', 'user-1');
    c.set('userEmail', 'user@example.com');
    c.set('organizationId', 'org-1');
    c.set('orgSlug', 'acme');
    c.set('role', role);
    c.set('orgExplicit', false);
    c.set('clientIp', '203.0.113.9');
    c.set('apiKeyId', apiKeyId);
    return next();
  });
  app.route('/', createCoreRoutes({ sql }));
  return app;
}

/** The key row `/me` reads by the id the door stashed. */
const KEY_EXPIRES_AT = new Date('2026-10-12T00:00:00.000Z');
function keyRow(expiresAt: Date | null = KEY_EXPIRES_AT) {
  return { id: 'key-1', name: 'Billing sync', expiresAt };
}
const answerKeyRow =
  (row: object | null) =>
  (text: string): object[] | undefined =>
    text.includes('FROM "apikey"') ? (row === null ? [] : [row]) : undefined;

/**
 * `GET /me` answers the one gate a role does not decide (G-06): whether
 * the key may import or revoke browser sessions — the deployment editor
 * allowlist — computed from the memberships the route already loads, so
 * no client has to learn it from a 403.
 */
/**
 * `GET /teams` after the 2026-09-19 round-K evaluation (K4-1): the ids a
 * team audience takes, which no operation used to answer — a caller could
 * set `teamIds` only with an id a person copied out of the app. The app's
 * own directory read (every team, by name, for any member) plus `member`
 * from the holder's memberships, the pre-flight for `TEAM_ACCESS_DENIED`.
 */
describe('GET /teams', () => {
  it('lists every team of the organization with the key holder’s membership', async () => {
    const { sql, queries } = fakeSql([], (text) => {
      if (text.includes('FROM "team" WHERE "organizationId"')) {
        return [
          { id: 't-fin', name: 'Finance' },
          { id: 't-ops', name: 'Ops' },
        ];
      }
      if (text.includes('FROM "teamMember" tm')) return [{ teamId: 't-ops' }];
      return undefined;
    });
    const res = await mount(sql, 'key-1', 'member').request(
      'http://localhost/teams',
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      teams: [
        { id: 't-fin', name: 'Finance', member: false },
        { id: 't-ops', name: 'Ops', member: true },
      ],
    });
    // The directory is the organization's, never the holder's memberships.
    const directory = queries.find((q) => q.text.includes('FROM "team" WHERE'));
    expect(directory?.values).toEqual(['org-1']);
  });

  it('takes no query parameter', async () => {
    const { sql } = fakeSql([]);
    const res = await mount(sql).request('http://localhost/teams?limit=5');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'INVALID_QUERY' });
  });
});

describe('GET /me capabilities', () => {
  const membership = {
    organizationId: 'org-1',
    role: 'admin',
    name: 'Acme',
    slug: 'acme',
  };
  const me = async () => {
    const { sql, queries } = fakeSql([membership], answerKeyRow(keyRow()));
    const res = await mount(sql).request('http://localhost/me');
    expect(res.status).toBe(200);
    const body: { capabilities: { deploymentEditor: boolean } } =
      await res.json();
    // The memberships read and the key row are the only queries — the
    // gate itself costs nothing.
    expect(queries).toHaveLength(2);
    expect(queries[0]?.text).toContain('FROM "member" m');
    expect(queries[1]?.text).toContain('FROM "apikey"');
    return body;
  };
  let savedAdmins: string | undefined;
  beforeEach(() => {
    savedAdmins = process.env.TALE_DEPLOYMENT_CONFIG_ADMINS;
  });
  afterEach(() => {
    if (savedAdmins === undefined) {
      delete process.env.TALE_DEPLOYMENT_CONFIG_ADMINS;
    } else {
      process.env.TALE_DEPLOYMENT_CONFIG_ADMINS = savedAdmins;
    }
  });

  it('is false while the key holder is not on the allowlist', async () => {
    delete process.env.TALE_DEPLOYMENT_CONFIG_ADMINS;
    expect((await me()).capabilities).toEqual({
      deploymentEditor: false,
      developer: true,
      notificationExport: true,
      actAs: true,
    });
    process.env.TALE_DEPLOYMENT_CONFIG_ADMINS = 'someone-else@example.com';
    expect((await me()).capabilities).toEqual({
      deploymentEditor: false,
      developer: true,
      notificationExport: true,
      actAs: true,
    });
  });

  it('is true once the allowlist names the key holder (case-insensitively)', async () => {
    process.env.TALE_DEPLOYMENT_CONFIG_ADMINS =
      'ops@example.com, USER@example.com';
    expect((await me()).capabilities).toEqual({
      deploymentEditor: true,
      developer: true,
      notificationExport: true,
      actAs: true,
    });
  });
});

/**
 * `GET /me` answers the notification export's gate as
 * `capabilities.notificationExport` — the very function the export door runs
 * (v1-notifications.ts) — so a mirror worker an admin delegated the export to
 * confirms its grant before its first page. An admin's answer reads nothing
 * more (the two queries counted above).
 */
describe('GET /me notificationExport', () => {
  const meAs = async (role: string, grants: object[]) => {
    const { sql, queries } = fakeSql(
      [{ organizationId: 'org-1', role, name: 'Acme', slug: 'acme' }],
      (text) =>
        text.includes('FROM app.competence_records')
          ? grants
          : answerKeyRow(keyRow())(text),
    );
    const res = await mount(sql, 'key-1', role).request('http://localhost/me');
    expect(res.status).toBe(200);
    const body: { capabilities: { notificationExport: boolean } } =
      await res.json();
    return { exportable: body.capabilities.notificationExport, queries };
  };

  it('is false for a developer without a grant, read for the key holder in this organization', async () => {
    const { exportable, queries } = await meAs('developer', []);
    expect(exportable).toBe(false);
    const read = queries.find((q) =>
      q.text.includes('FROM app.competence_records'),
    );
    expect(read?.values).toEqual([
      'org-1',
      'user-1',
      'tale:notifications.export',
    ]);
  });

  it('is true for a member holding a live grant, and false once it expired', async () => {
    const live = { expiresAt: null, revokedAt: null };
    expect((await meAs('developer', [live])).exportable).toBe(true);
    const later = { expiresAt: Date.now() + 3_600_000, revokedAt: null };
    expect((await meAs('member', [later])).exportable).toBe(true);
    const expired = { expiresAt: Date.now() - 1, revokedAt: null };
    expect((await meAs('developer', [expired])).exportable).toBe(false);
  });
});

/**
 * `GET /me` names the key that made the request (H-06a): keys are minted,
 * rotated and revoked in the app only, so this is where an unattended
 * caller sees its own expiry coming instead of learning it from a 401.
 */
describe('GET /me key', () => {
  const membership = {
    organizationId: 'org-1',
    role: 'admin',
    name: 'Acme',
    slug: 'acme',
  };
  const me = async (row: object | null, apiKeyId = 'key-1') => {
    const { sql, queries } = fakeSql([membership], answerKeyRow(row));
    const res = await mount(sql, apiKeyId).request('http://localhost/me');
    expect(res.status).toBe(200);
    const body: { key: unknown } = await res.json();
    return { body, queries };
  };

  it('answers the key’s name and expiry as epoch milliseconds, read by the stashed id', async () => {
    const { body, queries } = await me(keyRow());
    expect(body.key).toEqual({
      id: 'key-1',
      name: 'Billing sync',
      expiresAt: KEY_EXPIRES_AT.getTime(),
    });
    const read = queries.find((q) => q.text.includes('FROM "apikey"'));
    expect(read?.values).toEqual(['key-1']);
  });

  it('answers expiresAt null for a key minted to never expire', async () => {
    const { body } = await me(keyRow(null));
    expect(body.key).toEqual({
      id: 'key-1',
      name: 'Billing sync',
      expiresAt: null,
    });
  });

  it('answers key null when the row is gone — revoked while the request was in flight', async () => {
    const { body } = await me(null);
    expect(body.key).toBeNull();
  });

  it('reads no row when the door stashed no key id', async () => {
    const { body, queries } = await me(keyRow(), '');
    expect(body.key).toBeNull();
    expect(queries.some((q) => q.text.includes('FROM "apikey"'))).toBe(false);
  });
});

/** The single list query the route issued. */
function listQuery(queries: Captured[], table: string): Captured {
  const hit = queries.find((q) => q.text.includes(`FROM app.${table}`));
  if (!hit) throw new Error(`no query against app.${table}`);
  return hit;
}

const FAMILIES = [
  { route: '/contacts', table: 'contacts', row: contactRow },
  { route: '/products', table: 'products', row: productRow },
] as const;

describe.each(FAMILIES)('GET $route pagination', ({ route, table, row }) => {
  it('passes ?cursor= through to the service as the keyset bounds', async () => {
    const { sql, queries } = fakeSql([row(3), row(4)]);
    const cursor = mintCursorFor(
      'org-1',
      table,
      `1699999999998:${table === 'contacts' ? 'c-2' : 'p-2'}`,
    );
    const res = await mount(sql).request(
      `http://localhost${route}?cursor=${encodeURIComponent(cursor)}&limit=2`,
    );
    expect(res.status).toBe(200);
    const { values } = listQuery(queries, table);
    expect(values).toContain(1_699_999_999_998);
    expect(values).toContain(table === 'contacts' ? 'c-2' : 'p-2');
    // limit + 1: the service over-fetches one row to learn whether more exist
    expect(values).toContain(3);
  });

  it('emits a continueCursor that round-trips into the next request', async () => {
    const { sql } = fakeSql([row(1), row(2), row(3)]);
    const res = await mount(sql).request(`http://localhost${route}?limit=2`);
    const body = (await res.json()) as {
      page: { id: string }[];
      isDone: boolean;
      continueCursor: string;
    };
    expect(body.page.map((item) => item.id)).toEqual(
      table === 'contacts' ? ['c-1', 'c-2'] : ['p-1', 'p-2'],
    );
    expect(body.isDone).toBe(false);
    const last = row(2);
    // Signed for THIS list in THIS organization: the position inside it is
    // the previous page's last row, and no other list redeems it.
    const position = verifyCursorFor('org-1', table, body.continueCursor);
    expect(parseKeysetCursor(position)).toEqual({
      at: last.updatedAt,
      id: last.id,
    });
    expect(verifyCursorFor('org-2', table, body.continueCursor)).toBeNull();
    expect(
      verifyCursorFor('org-1', 'documents', body.continueCursor),
    ).toBeNull();
  });

  it('refuses a well-formed position this list never signed', async () => {
    const { sql, queries } = fakeSql([row(3)]);
    const res = await mount(sql).request(
      `http://localhost${route}?cursor=9999999999999:00000000-0000-0000-0000-000000000000`,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'INVALID_CURSOR' });
    expect(queries.some((q) => q.text.includes(`FROM app.${table}`))).toBe(
      false,
    );
  });

  it('answers isDone with an empty cursor on the last page', async () => {
    const { sql } = fakeSql([row(1), row(2)]);
    const res = await mount(sql).request(`http://localhost${route}?limit=2`);
    const body = (await res.json()) as {
      isDone: boolean;
      continueCursor: string;
    };
    expect(body.isDone).toBe(true);
    expect(body.continueCursor).toBe('');
  });

  it('refuses a cursor it never answered with 400 instead of restarting at page one', async () => {
    // A consumer that mangled or truncated a stored cursor must learn it —
    // silently re-reading the first page re-processes what it already saw.
    for (const cursor of [
      '%7B%22updatedAt%22%3A1%7D',
      'malformed-eval-cursor',
      'not-a-number:c-2',
      // A finite number the bigint column cannot hold is still not a cursor.
      '1.5:c-2',
      '100000000000000000000:c-2',
      '1e100:c-2',
    ]) {
      const { sql, queries } = fakeSql([row(1)]);
      const res = await mount(sql).request(
        `http://localhost${route}?cursor=${cursor}`,
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: 'INVALID_CURSOR' });
      expect(queries.some((q) => q.text.includes(`FROM app.${table}`))).toBe(
        false,
      );
    }
  });

  it('clamps limit so no client value becomes a zero or negative LIMIT', async () => {
    for (const [limit, expected] of [
      ['0', 2],
      ['-4', 2],
      ['999', 201],
    ] as const) {
      const { sql, queries } = fakeSql([row(1)]);
      await mount(sql).request(`http://localhost${route}?limit=${limit}`);
      expect(listQuery(queries, table).values).toContain(expected);
    }
  });

  it('refuses a limit that is not a number with 400', async () => {
    const { sql } = fakeSql([row(1)]);
    const res = await mount(sql).request(`http://localhost${route}?limit=abc`);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'INVALID_LIMIT' });
  });
});

describe('GET /products filters', () => {
  it('passes the documented status filter to the service', async () => {
    const { sql, queries } = fakeSql([productRow(1)]);
    const res = await mount(sql).request(
      'http://localhost/products?status=archived&category=tools',
    );
    expect(res.status).toBe(200);
    const { values } = listQuery(queries, 'products');
    expect(values).toContain('archived');
    expect(values).toContain('tools');
  });
});

/**
 * DELETE /documents/:id is the third door onto `deleteDocumentHard`. A purge
 * that could not remove every dead surface keeps the row for a retry and
 * throws PurgeIncompleteError — an error without a 4xx status, which
 * `domainErrorResponse` rethrows as a bare 500. The session and folder doors
 * answer it as 503 PURGE_INCOMPLETE; this pins the REST door to the same
 * status and code — in the door's own `{error, code}` envelope — so the
 * three never drift.
 */
/**
 * `folderId` on the hub listing is three-valued at the door: absent lists
 * the whole hub, `root` the documents in no folder (a root no folder id
 * could name — until 1.10.0 REST had no way to ask for it), any other value
 * one folder. The service speaks `undefined` / `null` / the id.
 */
describe('GET /documents folder filter', () => {
  const FOLDER_CLAUSE = 'OR folder_id IS NOT DISTINCT FROM $?';
  /** The `(skip OR folder_id IS NOT DISTINCT FROM folder)` pair as bound. */
  const boundFolder = (query: Captured): { skip: unknown; folder: unknown } => {
    const at = query.text.indexOf(FOLDER_CLAUSE);
    expect(at).toBeGreaterThan(-1);
    const placeholders = query.text.slice(0, at).split('$?').length - 1;
    return {
      skip: query.values[placeholders - 1],
      folder: query.values[placeholders],
    };
  };

  it('lists the whole hub when no folderId is given', async () => {
    const { sql, queries } = fakeSql([]);
    const res = await mount(sql).request('http://localhost/documents');
    expect(res.status).toBe(200);
    expect(boundFolder(listQuery(queries, 'documents'))).toEqual({
      skip: true,
      folder: null,
    });
  });

  it('reads folderId=root as the documents in no folder', async () => {
    const { sql, queries } = fakeSql([]);
    const res = await mount(sql).request(
      'http://localhost/documents?folderId=root',
    );
    expect(res.status).toBe(200);
    expect(boundFolder(listQuery(queries, 'documents'))).toEqual({
      skip: false,
      folder: null,
    });
  });

  it('reads any other folderId as that one folder', async () => {
    const { sql, queries } = fakeSql([]);
    const res = await mount(sql).request(
      'http://localhost/documents?folderId=fold-1',
    );
    expect(res.status).toBe(200);
    expect(boundFolder(listQuery(queries, 'documents'))).toEqual({
      skip: false,
      folder: 'fold-1',
    });
  });
});

describe('DELETE /documents/:id purge mapping', () => {
  it('answers an incomplete purge as 503 PURGE_INCOMPLETE', async () => {
    const res = await mount(fakeSql([]).sql).request(
      'http://localhost/documents/doc-hub',
      { method: 'DELETE' },
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: expect.stringContaining('Purge incomplete'),
      code: 'PURGE_INCOMPLETE',
    });
  });
});

/**
 * PATCH /documents/{id} answers the document as it now stands, and refuses a
 * stale `expectedUpdatedAt` — the contacts/products precondition. The
 * regression under test: the route answered 204, so a client that sent the
 * precondition could never learn the `updatedAt` its next write needs, and
 * documents had no precondition at all while contacts and products did.
 */
describe('PATCH /documents/:id', () => {
  it('answers 200 with the updated document, indexing state included', async () => {
    const { readDocumentIndexing } =
      await import('../domains/documents/service.ts');
    vi.mocked(readDocumentIndexing).mockResolvedValueOnce(
      new Map([['s3:acme/blob-1', { status: 'completed', indexedAt: 5 }]]),
    );
    const { getDocumentById } = await import('../domains/documents/service.ts');
    vi.mocked(getDocumentById).mockResolvedValue({
      ...hubDocument,
      fileRef: 's3:acme/blob-1',
    } as never);
    const res = await mount(fakeSql([]).sql).request(
      'http://localhost/documents/doc-hub',
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: 'Renamed',
          expectedUpdatedAt: 1_700_000_000_000,
        }),
      },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      id: 'doc-hub',
      content: 'beta content',
      updatedAt: 1_700_000_000_000,
      indexing: { status: 'completed', indexedAt: 5 },
    });
    vi.mocked(getDocumentById).mockResolvedValue({ ...hubDocument } as never);
  });

  it('maps a stale precondition to 409 DOCUMENT_STALE', async () => {
    const { updateDocument } = await import('../domains/documents/service.ts');
    vi.mocked(updateDocument).mockRejectedValueOnce(
      new DocumentError('DOCUMENT_STALE', 'The document changed', 409),
    );
    const res = await mount(fakeSql([]).sql).request(
      'http://localhost/documents/doc-hub',
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Renamed', expectedUpdatedAt: 1 }),
      },
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'DOCUMENT_STALE' });
  });

  // `If-Match` is the HTTP form of the same guard (2026-09-14 evaluation,
  // g8-5): the tag the GET answered must still name the representation —
  // strongly compared, so a weak tag never matches — else 412 with the
  // current tag beside it and nothing written.
  it('refuses a stale If-Match with 412 PRECONDITION_FAILED naming the current tag, writing nothing', async () => {
    const { updateDocument } = await import('../domains/documents/service.ts');
    const app = mount(fakeSql([]).sql);
    const read = await app.request('http://localhost/documents/doc-hub');
    expect(read.status).toBe(200);
    const current = entityTagOf(new TextEncoder().encode(await read.text()));
    const writesBefore = vi.mocked(updateDocument).mock.calls.length;
    for (const header of ['"someone-elses"', `W/${current}`]) {
      const res = await app.request('http://localhost/documents/doc-hub', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'if-match': header },
        body: JSON.stringify({ title: 'Renamed' }),
      });
      expect(res.status, header).toBe(412);
      expect(await res.json()).toMatchObject({
        code: 'PRECONDITION_FAILED',
        data: { etag: current },
      });
    }
    expect(vi.mocked(updateDocument).mock.calls.length).toBe(writesBefore);
  });

  it('rechecks If-Match after a concurrent edit while acquiring the document write lock', async () => {
    const { requireDocumentWriteAccess, updateDocument } =
      await import('../domains/documents/service.ts');
    const { sql } = fakeSql([]);
    const transaction = fakeSql([]).sql;
    const app = mount(sql);
    const read = await app.request('http://localhost/documents/doc-hub');
    const current = entityTagOf(new TextEncoder().encode(await read.text()));
    const writesBefore = vi.mocked(updateDocument).mock.calls.length;
    Object.assign(sql, {
      begin: async (run: (tx: Sql) => Promise<unknown>) => {
        // Another writer commits after the request's preflight read but
        // before its transaction acquires the row lock.
        vi.mocked(requireDocumentWriteAccess).mockResolvedValueOnce({
          ...hubDocument,
          title: 'Concurrent edit',
          updatedAt: hubDocument.updatedAt + 1,
        } as never);
        return run(transaction);
      },
    });
    try {
      const response = await app.request('http://localhost/documents/doc-hub', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'if-match': current },
        body: JSON.stringify({ title: 'Stale overwrite' }),
      });
      expect(response.status).toBe(412);
      expect(await response.json()).toMatchObject({
        code: 'PRECONDITION_FAILED',
        data: { etag: expect.not.stringMatching(new RegExp(`^${current}$`)) },
      });
      expect(requireDocumentWriteAccess).toHaveBeenLastCalledWith(
        transaction,
        expect.objectContaining({ organizationId: 'org-1' }),
        'doc-hub',
        { lock: true },
      );
      expect(vi.mocked(updateDocument).mock.calls.length).toBe(writesBefore);
    } finally {
      vi.mocked(requireDocumentWriteAccess)
        .mockReset()
        .mockResolvedValue({ ...hubDocument } as never);
    }
  });

  // RFC 5789: a successful PATCH answers the new representation's tag, so
  // the next `If-Match` needs no read in between (2026-09-14 evaluation, h4).
  it('answers the updated representation with its own ETag', async () => {
    const app = mount(fakeSql([]).sql);
    const res = await app.request('http://localhost/documents/doc-hub', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Renamed' }),
    });
    expect(res.status).toBe(200);
    const etag = res.headers.get('etag');
    expect(etag).toBe(entityTagOf(new TextEncoder().encode(await res.text())));
  });

  it('applies a PATCH whose If-Match names the current representation, or any (*)', async () => {
    const app = mount(fakeSql([]).sql);
    const read = await app.request('http://localhost/documents/doc-hub');
    const current = entityTagOf(new TextEncoder().encode(await read.text()));
    for (const header of [current, `"other", ${current}`, '*']) {
      const res = await app.request('http://localhost/documents/doc-hub', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'if-match': header },
        body: JSON.stringify({ title: 'Renamed' }),
      });
      expect(res.status, header).toBe(200);
    }
  });
});

/**
 * A `knowledge`-sourced document is a knowledge entry's own storage: the
 * entry's delete retires the chain and trashes the document, so the
 * document door must not do it sideways. The regression under test:
 * `DELETE /documents/{id}` on such a document silently destroyed the entry.
 */
describe('documents that back an active knowledge entry', () => {
  const backing = { ...hubDocument, sourceProvider: 'knowledge' };

  it('refuses the delete with 409 naming the entry', async () => {
    const { getDocumentById } = await import('../domains/documents/service.ts');
    vi.mocked(getDocumentById).mockResolvedValueOnce(backing as never);
    vi.mocked(findActiveEntryForDocument).mockResolvedValueOnce({
      id: 'ke-1',
      topic: 'VAT filing deadline',
    });
    const res = await mount(fakeSql([]).sql).request(
      'http://localhost/documents/doc-hub',
      { method: 'DELETE' },
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      code: 'DOCUMENT_HAS_KNOWLEDGE_ENTRY',
      data: { entryId: 'ke-1' },
    });
  });

  it('refuses a content or identity rewrite with the same 409, but lets a folder move through', async () => {
    const { getDocumentById, updateDocument } =
      await import('../domains/documents/service.ts');
    vi.mocked(getDocumentById).mockResolvedValue(backing as never);
    vi.mocked(findActiveEntryForDocument).mockResolvedValue({
      id: 'ke-1',
      topic: 'VAT filing deadline',
    });
    const rewrite = await mount(fakeSql([]).sql).request(
      'http://localhost/documents/doc-hub',
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: 'something else' }),
      },
    );
    expect(rewrite.status).toBe(409);
    expect(updateDocument).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ content: 'something else' }),
    );
    const move = await mount(fakeSql([]).sql).request(
      'http://localhost/documents/doc-hub',
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ folderId: 'fold-2' }),
      },
    );
    expect(move.status).toBe(200);
    vi.mocked(getDocumentById).mockResolvedValue({ ...hubDocument } as never);
    vi.mocked(findActiveEntryForDocument).mockResolvedValue(null);
  });
});

/**
 * A body that is not JSON is a client mistake in the documented 400 envelope.
 * The regression under test: every write route handed `c.req.json()` — a
 * bare `JSON.parse` — straight to zod, so a truncated or empty `curl -d`
 * body threw a SyntaxError through Hono into the app-level handler: a
 * text/plain 500 outside the envelope, reported as a backend defect.
 */
describe('malformed JSON bodies', () => {
  const send = (route: string, method: string, body: string) =>
    mount(fakeSql([]).sql).request(`http://localhost${route}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body,
    });

  it.each([
    ['POST', '/contacts', '{'],
    ['POST', '/contacts', ''],
    ['POST', '/contacts/bulk', '{"contacts": ['],
    ['POST', '/products', 'not json'],
    ['PATCH', '/products/p-1', ''],
    ['POST', '/documents', '{'],
    ['PATCH', '/documents/d-1', '{'],
    ['POST', '/knowledge/search', ''],
    ['POST', '/knowledge-entries', '{'],
    ['PATCH', '/knowledge-entries/k-1', ''],
    ['PUT', '/skills/helper', ''],
  ])(
    '%s %s with body %j answers 400 in the JSON envelope',
    async (method, route, body) => {
      const res = await send(route, method, body);
      expect(res.status).toBe(400);
      expect(res.headers.get('content-type')).toContain('application/json');
      expect(await res.json()).toMatchObject({ error: expect.any(String) });
    },
  );
});

/**
 * The knowledge-entry writes share the per-org `knowledge:mutate` budget
 * with their in-app twins. The regression under test: the charge ran inside
 * the try whose only catch maps CODED domain errors, and the limiter's
 * error carries no code — so a REST bulk import past the bucket got opaque
 * text/plain 500s (each captured as a backend defect) instead of the 429 +
 * `Retry-After` the spec promises on every route.
 */
describe('knowledge-entry writes over the knowledge:mutate budget', () => {
  const entry = { topic: 'Refunds', content: 'Refunds settle in 14 days.' };

  it.each([
    ['POST', '/knowledge-entries'],
    ['PATCH', '/knowledge-entries/k-1'],
    ['DELETE', '/knowledge-entries/k-1'],
  ])(
    '%s %s answers 429 with Retry-After, and touches nothing else',
    async (method, route) => {
      const { sql, queries } = fakeSql([], spentBucket);
      const res = await mount(sql).request(`http://localhost${route}`, {
        method,
        headers: { 'content-type': 'application/json' },
        ...(method === 'DELETE' ? {} : { body: JSON.stringify(entry) }),
      });
      expect(res.status).toBe(429);
      expect(Number(res.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
      expect(await res.json()).toMatchObject({
        code: 'RATE_LIMITED',
        error: expect.stringMatching(
          /^Too many requests — retry after \d+ ms$/,
        ),
      });
      const charge = queries.find((q) =>
        q.text.includes('INSERT INTO app.rate_limits'),
      );
      expect(charge?.values).toContain('knowledge:mutate');
      expect(charge?.values).toContain('org:org-1');
      expect(
        queries.some((q) => q.text.includes('app.knowledge_entries')),
      ).toBe(false);
    },
  );
});

/**
 * Every list route truncates AND clamps `limit` through the shared
 * `pageLimit`. The regression under test: `/documents` and
 * `/knowledge-entries` clamped without truncating, so `?limit=2.5` reached
 * Postgres as the text `3.5` and `int8in` refused it — a 500 plus an error
 * report for a malformed query string.
 */
describe.each([
  { route: '/documents', table: 'documents' },
  { route: '/knowledge-entries', table: 'knowledge_entries' },
])('GET $route limit', ({ route, table }) => {
  it('refuses a limit that is not a number with 400', async () => {
    const { sql } = fakeSql([]);
    const res = await mount(sql).request(`http://localhost${route}?limit=abc`);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'INVALID_LIMIT' });
  });

  it.each([
    ['-4', 2],
    ['999', 101],
  ])(
    'clamps ?limit=%s into a whole LIMIT of %i (page + 1)',
    async (limit, expected) => {
      const { sql, queries } = fakeSql([]);
      const res = await mount(sql).request(
        `http://localhost${route}?limit=${limit}`,
      );
      expect(res.status).toBe(200);
      expect(listQuery(queries, table).values).toContain(expected);
    },
  );

  it('refuses a fractional limit instead of silently truncating it', async () => {
    const { sql, queries } = fakeSql([]);
    const res = await mount(sql).request(`http://localhost${route}?limit=2.5`);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'INVALID_LIMIT' });
    expect(queries.some((q) => q.text.includes(table))).toBe(false);
  });

  it('refuses a query parameter the route does not take, naming it', async () => {
    const { sql, queries } = fakeSql([]);
    const res = await mount(sql).request(
      `http://localhost${route}?statuss=active`,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      code: 'INVALID_QUERY',
      data: {
        issues: [
          { path: 'statuss', message: 'is not a parameter this route takes' },
        ],
      },
    });
    expect(queries.some((q) => q.text.includes(table))).toBe(false);
  });
});

/**
 * The Hub bytes lane: `GET /documents/{id}/content` serves a file-backed
 * document's blob with the download choreography the project lane speaks
 * (`serveDocumentBytes`), and a content-only document's inline text — the
 * one URL every Hub document reads back from, where `GET /documents/{id}`
 * answers `content: null` for a blob. The regression under test: an
 * uploaded Hub file, and every document a knowledge entry mints, was
 * write-only over REST.
 */
describe('GET /documents/:id/content', () => {
  const route = 'http://localhost/documents/doc-hub/content';

  it('serves a content-only document’s inline text, typed and named', async () => {
    const res = await mount(fakeSql([]).sql).request(route);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe(
      'text/markdown; charset=utf-8',
    );
    expect(res.headers.get('content-disposition')).toContain(
      'filename="Hub Note.md"',
    );
    expect(res.headers.get('content-length')).toBe(
      String(Buffer.byteLength('beta content')),
    );
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cache-control')).toBe('private, no-cache');
    expect(res.headers.get('accept-ranges')).toBe('none');
    expect(await res.text()).toBe('beta content');
  });

  it('answers the headers alone on HEAD', async () => {
    const res = await mount(fakeSql([]).sql).request(route, {
      method: 'HEAD',
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-length')).toBe(
      String(Buffer.byteLength('beta content')),
    );
    expect(await res.text()).toBe('');
  });

  /** The date validator of the inline branch. The regression under test
   * (round e, E5-02): the lane issued `Last-Modified` from the document's
   * `updatedAt` and never read it back, so `If-Modified-Since` answered
   * the whole text every time while `If-None-Match` on the same URL, and
   * the same date on a file-backed document, answered 304. */
  it('answers 304, bodiless, to an If-Modified-Since at or past the Last-Modified it issued', async () => {
    const first = await mount(fakeSql([]).sql).request(route);
    const lastModified = first.headers.get('last-modified');
    expect(lastModified).toBe('Tue, 14 Nov 2023 22:13:20 GMT');
    for (const since of [lastModified ?? '', 'Sun, 13 Sep 2026 10:46:39 GMT']) {
      const res = await mount(fakeSql([]).sql).request(route, {
        headers: { 'if-modified-since': since },
      });
      expect(res.status).toBe(304);
      expect(await res.text()).toBe('');
      expect(res.headers.get('etag')).toBe(first.headers.get('etag'));
      expect(res.headers.get('last-modified')).toBe(lastModified);
      expect(res.headers.get('cache-control')).toBe('private, no-cache');
      expect(res.headers.get('accept-ranges')).toBe('none');
      expect(res.headers.get('content-type')).toBeNull();
      expect(res.headers.get('content-length')).toBeNull();
    }
    const head = await mount(fakeSql([]).sql).request(route, {
      method: 'HEAD',
      headers: { 'if-modified-since': lastModified ?? '' },
    });
    expect(head.status).toBe(304);
  });

  it('answers the text to an If-Modified-Since before the Last-Modified, or one that does not parse', async () => {
    for (const since of ['Tue, 14 Nov 2023 22:13:19 GMT', 'yesterday']) {
      const res = await mount(fakeSql([]).sql).request(route, {
        headers: { 'if-modified-since': since },
      });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('beta content');
    }
  });

  it('lets If-None-Match decide when both validators are sent', async () => {
    // RFC 9110 §13.1.3: a stale tag beside a current date is a changed
    // representation — the date is ignored and the bytes answer; a
    // current tag beside a stale date is unchanged.
    const stale = await mount(fakeSql([]).sql).request(route, {
      headers: {
        'if-none-match': '"stale"',
        'if-modified-since': 'Tue, 14 Nov 2023 22:13:20 GMT',
      },
    });
    expect(stale.status).toBe(200);
    expect(await stale.text()).toBe('beta content');
    const first = await mount(fakeSql([]).sql).request(route);
    const current = await mount(fakeSql([]).sql).request(route, {
      headers: {
        'if-none-match': first.headers.get('etag') ?? '',
        'if-modified-since': 'Tue, 14 Nov 2023 22:13:19 GMT',
      },
    });
    expect(current.status).toBe(304);
    expect(await current.text()).toBe('');
  });

  it('streams a file-backed document from the store, Range honoured', async () => {
    const { getDocumentById } = await import('../domains/documents/service.ts');
    vi.mocked(getDocumentById).mockResolvedValue({
      ...hubDocument,
      fileRef: 's3:acme/blob-1',
    } as never);
    vi.mocked(openFileContent).mockResolvedValueOnce({
      status: 206,
      headers: new Headers({
        'content-type': 'application/pdf',
        'content-range': 'bytes 0-1/2',
        'content-length': '2',
        etag: '"e1"',
      }),
      body: new Response('ab').body,
    });
    const res = await mount(fakeSql([]).sql).request(route, {
      headers: { range: 'bytes=0-1' },
    });
    expect(res.status).toBe(206);
    expect(openFileContent).toHaveBeenCalledWith(
      expect.anything(),
      { organizationId: 'org-1' },
      's3:acme/blob-1',
      expect.objectContaining({ head: false, range: 'bytes=0-1' }),
    );
    expect(res.headers.get('content-range')).toBe('bytes 0-1/2');
    expect(res.headers.get('etag')).toBe('"e1"');
    expect(res.headers.get('content-disposition')).toContain(
      'filename="Hub Note.md"',
    );
    expect(res.headers.get('cache-control')).toBe('private, no-cache');
    expect(await res.text()).toBe('ab');
    vi.mocked(getDocumentById).mockResolvedValue({ ...hubDocument } as never);
  });

  it('answers a bodiless 416 naming the size for a range the file cannot satisfy', async () => {
    const { getDocumentById } = await import('../domains/documents/service.ts');
    vi.mocked(getDocumentById).mockResolvedValue({
      ...hubDocument,
      fileRef: 's3:acme/blob-1',
    } as never);
    vi.mocked(openFileContent).mockResolvedValueOnce({
      status: 416,
      headers: new Headers({
        'content-range': 'bytes */2',
        'accept-ranges': 'bytes',
        'content-length': '0',
      }),
      body: null,
    });
    const res = await mount(fakeSql([]).sql).request(route, {
      headers: { range: 'bytes=2-' },
    });
    expect(res.status).toBe(416);
    expect(await res.text()).toBe('');
    expect(res.headers.get('content-range')).toBe('bytes */2');
    expect(res.headers.get('content-length')).toBe('0');
    expect(res.headers.get('content-type')).toBeNull();
    expect(res.headers.get('content-disposition')).toBeNull();
    vi.mocked(getDocumentById).mockResolvedValue({ ...hubDocument } as never);
  });

  it('answers the opaque 404 for a blob the store no longer holds', async () => {
    const { getDocumentById } = await import('../domains/documents/service.ts');
    vi.mocked(getDocumentById).mockResolvedValue({
      ...hubDocument,
      fileRef: 's3:acme/blob-gone',
    } as never);
    vi.mocked(openFileContent).mockResolvedValueOnce(null);
    const res = await mount(fakeSql([]).sql).request(route);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: 'Document not found',
      code: 'DOCUMENT_NOT_FOUND',
    });
    vi.mocked(getDocumentById).mockResolvedValue({ ...hubDocument } as never);
  });

  it('answers 503 with Retry-After when the store does not answer', async () => {
    const { getDocumentById } = await import('../domains/documents/service.ts');
    vi.mocked(getDocumentById).mockResolvedValue({
      ...hubDocument,
      fileRef: 's3:acme/blob-1',
    } as never);
    vi.mocked(openFileContent).mockRejectedValueOnce(
      new FileError('OBJECT_STORE_UNAVAILABLE', 'store down', 503),
    );
    const res = await mount(fakeSql([]).sql).request(route);
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('5');
    expect(await res.json()).toMatchObject({
      code: 'OBJECT_STORE_UNAVAILABLE',
    });
    vi.mocked(getDocumentById).mockResolvedValue({ ...hubDocument } as never);
  });

  it('refuses a query parameter, like every lookup', async () => {
    const res = await mount(fakeSql([]).sql).request(`${route}?foo=1`);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'INVALID_QUERY' });
  });
});

/** The limiter's UPSERT answers a row (capacity left); the entry loads
 * answer `entry`. */
function entryDoor(entry: object | null) {
  return fakeSql([], (text) => {
    if (text.includes('INSERT INTO app.rate_limits')) return [{ value: '9' }];
    if (text.includes('FROM app.knowledge_entries')) {
      return entry === null ? [] : [entry];
    }
    return undefined;
  });
}

const superseded = {
  id: 'ke-old',
  topic: 'Refunds',
  content: 'Refunds settle in 14 days.',
  status: 'superseded',
  source: 'manual',
  documentId: 'doc-ke',
  supersededBy: 'ke-next',
  supersededAt: 1_700_000_000_500,
  createdBy: 'user-1',
  createdAt: 1_700_000_000_000,
  seq: 7,
};

/**
 * The entry write answers the document it lives in: a create-then-poll of
 * `indexing` is two calls, not a read of the entry in between; the version
 * chain and a topic's history are reachable without paging every
 * superseded row of the organization.
 */
describe('knowledge entries: documentId, versions, topic, supersededAt', () => {
  it('POST answers 201 with the entry id AND its document', async () => {
    const res = await mount(entryDoor(null).sql).request(
      'http://localhost/knowledge-entries',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ topic: 'Refunds', content: 'Refunds settle.' }),
      },
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: 'ke-new', documentId: 'doc-ke' });
  });

  it('PATCH answers the NEW row and the document it re-indexes under', async () => {
    const res = await mount(entryDoor(null).sql).request(
      'http://localhost/knowledge-entries/ke-old',
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ topic: 'Refunds', content: 'Refunds settle.' }),
      },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 'ke-next', documentId: 'doc-ke' });
  });

  it('answers supersededAt on a superseded row, and never on an active one', async () => {
    const res = await mount(entryDoor(superseded).sql).request(
      'http://localhost/knowledge-entries/ke-old',
    );
    expect(await res.json()).toMatchObject({
      status: 'superseded',
      supersededBy: 'ke-next',
      supersededAt: 1_700_000_000_500,
    });
    const active = await mount(
      entryDoor({
        ...superseded,
        status: 'active',
        supersededBy: null,
        supersededAt: null,
      }).sql,
    ).request('http://localhost/knowledge-entries/ke-old');
    const body = (await active.json()) as Record<string, unknown>;
    expect('supersededAt' in body).toBe(false);
    expect('supersededBy' in body).toBe(false);
  });

  it('lists one topic’s rows on its normalized key, composable with status', async () => {
    const { sql, queries } = entryDoor(superseded);
    const res = await mount(sql).request(
      'http://localhost/knowledge-entries?topic=%20%20Refunds%20%20&status=superseded',
    );
    expect(res.status).toBe(200);
    const list = listQuery(queries, 'knowledge_entries');
    expect(list.text).toContain('topic_key = $?');
    expect(list.values).toContain('refunds');
    expect(list.values).toContain('superseded');
  });

  it('refuses a blank topic filter', async () => {
    const res = await mount(entryDoor(null).sql).request(
      'http://localhost/knowledge-entries?topic=',
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'INVALID_QUERY' });
  });

  it('answers the version chain of a known entry, and 404 for an unknown one', async () => {
    vi.mocked(getKnowledgeEntryVersions).mockResolvedValueOnce([
      {
        ...superseded,
        id: 'ke-next',
        status: 'active',
        supersededBy: null,
        supersededAt: null,
      },
      superseded,
    ]);
    const res = await mount(entryDoor(superseded).sql).request(
      'http://localhost/knowledge-entries/ke-old/versions',
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { versions: Record<string, unknown>[] };
    expect(body.versions.map((row) => [row.id, row.status])).toEqual([
      ['ke-next', 'active'],
      ['ke-old', 'superseded'],
    ]);
    expect(body.versions[1]).toMatchObject({ supersededAt: 1_700_000_000_500 });
    expect('seq' in (body.versions[0] ?? {})).toBe(false);
    expect(getKnowledgeEntryVersions).toHaveBeenCalledWith(
      expect.anything(),
      'org-1',
      'ke-old',
    );
    const missing = await mount(entryDoor(null).sql).request(
      'http://localhost/knowledge-entries/ke-none/versions',
    );
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({
      code: 'KNOWLEDGE_ENTRY_NOT_FOUND',
    });
  });
});

describe('REST product upload image round trips', () => {
  const imageId = '05b12345-1020-4000-8000-123456789abc';
  const imageUrl = `/api/app/products/images/${imageId}?orgId=org-1`;
  beforeEach(() => {
    vi.stubEnv('SITE_URL', 'http://localhost:3000');
    vi.stubEnv('ADDITIONAL_SITE_URLS', '');
    vi.stubEnv('BASE_PATH', '');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('projects managed images as absolute URIs on single and list reads', async () => {
    const row = { ...productRow(1), imageUrl };
    const { sql } = fakeSql([row]);
    const app = mount(sql);
    const single = await app.request('http://internal/products/p-1');
    expect(single.status).toBe(200);
    expect(await single.json()).toMatchObject({
      imageUrl: `http://localhost:3000${imageUrl}`,
    });
    const list = await app.request('http://internal/products');
    expect(await list.json()).toMatchObject({
      page: [{ imageUrl: `http://localhost:3000${imageUrl}` }],
    });
  });

  it('keeps a read-and-replayed managed image bound without changing its revision', async () => {
    const row = { ...productRow(1), imageUrl };
    const { sql, queries } = fakeSql([row], (text) =>
      text.includes('FROM app.file_metadata')
        ? [
            {
              id: imageId,
              uploadedBy: 'user-1',
              contentType: 'image/png',
              storageRef: 's3:acme/image',
            },
          ]
        : undefined,
    );
    const response = await mount(sql).request('http://internal/products/p-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        imageUrl: `http://localhost:3000${imageUrl}`,
        expectedUpdatedAt: row.updatedAt,
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      imageUrl: `http://localhost:3000${imageUrl}`,
      updatedAt: row.updatedAt,
    });
    expect(
      queries.find((q) => q.text.includes('FROM app.file_metadata'))?.values,
    ).toContainEqual({ unsafe: 'FOR UPDATE' });
    expect(queries.some((q) => q.text.startsWith('UPDATE app.products'))).toBe(
      false,
    );
  });
});
