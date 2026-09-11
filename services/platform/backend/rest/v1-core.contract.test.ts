// @vitest-environment node

import { Hono } from 'hono';
import type { Sql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';

import { getDocumentById } from '../domains/documents/service.ts';
import {
  KnowledgeError,
  searchKnowledgeForOrg,
} from '../domains/knowledge/service.ts';
import type { RestEnv } from './shared.ts';
import { createCoreRoutes } from './v1-core.ts';

/**
 * Core-family refusals the API reference promises. The regressions under
 * test:
 *
 * - A trashed contact stayed readable, patchable and re-deletable (200 /
 *   200 / 204) after the DELETE that trashed it — the reference says a
 *   deleted resource answers 404.
 * - `POST /knowledge/search` on an organization without an embedding model
 *   surfaced the domain's 503 as a bare 500 (the door maps 4xx only); the
 *   spec promises 409.
 * - `POST /knowledge/search` passed the embedding provider's own 429 (a
 *   spent balance, code 1113) through as the door's 429 — without the
 *   `Retry-After` every documented 429 carries, inviting endless retries of
 *   a refusal no wait can lift; the spec now promises 409 for account
 *   refusals and 503 for other provider failures.
 * - `POST /documents/{id}/retry-indexing` answered `skipped` for three
 *   different reasons without saying which.
 * - A hub document that left the active lifecycle (expired by a project
 *   cascade, waiting for the retention sweep) still read as a live document.
 * - `PUT /skills/{slug}` shared a skill with team ids nobody could check.
 */

vi.mock('../domains/knowledge/service.ts', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../domains/knowledge/service.ts')>();
  return {
    ...actual,
    searchKnowledgeForOrg: vi.fn(),
  };
});

vi.mock('../domains/audit_logs/service.ts', () => ({
  createAuditLog: vi.fn(),
}));
vi.mock('../realtime/outbox.ts', () => ({ emitHintInTx: vi.fn() }));
vi.mock('../jobs/enqueue.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../jobs/enqueue.ts')>()),
  addJobInTx: vi.fn(),
}));

vi.mock('../domains/documents/service.ts', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../domains/documents/service.ts')>();
  return {
    ...actual,
    getDocumentById: vi.fn(async () => ({
      id: 'doc-expired',
      organizationId: 'org-1',
      projectId: null,
      lifecycleStatus: 'expired',
      fileRef: null,
      title: 'Ledger',
    })),
  };
});

const trashed = {
  id: 'c-1',
  organizationId: 'org-1',
  name: 'Gone',
  email: 'gone@example.invalid',
  phone: null,
  externalId: null,
  source: 'api_import',
  locale: null,
  address: null,
  tags: [],
  metadata: null,
  notes: null,
  lifecycleStatus: 'trashed',
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
};

interface FixtureOptions {
  project?: Record<string, unknown> | null;
  file?: Record<string, unknown> | null;
  role?: string;
}

function fakeSql(options: FixtureOptions = {}): {
  sql: Sql;
  queries: string[];
} {
  const queries: string[] = [];
  const tag = (strings: TemplateStringsArray, ..._values: unknown[]) => {
    const text = strings.join('$?').replace(/\s+/g, ' ').trim();
    queries.push(text);
    if (text.includes('FROM app.contacts WHERE id')) {
      return Promise.resolve([trashed]);
    }
    if (text.includes('FROM app.file_metadata')) {
      return Promise.resolve(
        options.file === null
          ? []
          : [
              {
                id: 'file-1',
                organizationId: 'org-1',
                uploadedBy: 'user-1',
                storageRef: 's3:acme/private',
                documentId: null,
                threadId: null,
                conversationId: null,
                lifecycleStatus: null,
                contentType: 'text/plain',
                ...options.file,
              },
            ],
      );
    }
    if (text.startsWith('INSERT INTO app.documents')) {
      return Promise.resolve([{ id: 'hub-1' }]);
    }
    if (text.includes('FROM app.projects')) {
      return Promise.resolve(
        options.project === null
          ? []
          : [
              {
                id: 'p-1',
                organizationId: 'org-1',
                teamId: null,
                sharedWithTeamIds: [],
                archivedAt: null,
                ...options.project,
              },
            ],
      );
    }
    if (text.includes('FROM "teamMember"')) {
      return Promise.resolve([{ teamId: 'team-1' }]);
    }
    if (text.includes('INSERT INTO app.rate_limits')) {
      return Promise.resolve([{ value: '1' }]);
    }
    return Promise.resolve([]);
  };
  const begin = (fn: (tx: unknown) => Promise<unknown>) => fn(sql);
  const sql = Object.assign(tag, {
    unsafe: (t: string) => t,
    json: (v: unknown) => v,
    begin,
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { sql: sql as unknown as Sql, queries };
}

function mount(options: FixtureOptions = {}) {
  const fake = fakeSql(options);
  const app = new Hono<RestEnv>();
  app.use(async (c, next) => {
    c.set('userId', 'user-1');
    c.set('userEmail', 'user@example.com');
    c.set('organizationId', 'org-1');
    c.set('orgSlug', 'acme');
    c.set('role', options.role ?? 'admin');
    c.set('orgExplicit', true);
    c.set('clientIp', '203.0.113.9');
    return next();
  });
  app.route('/', createCoreRoutes({ sql: fake.sql }));
  return { app, queries: fake.queries };
}

const json = (method: string, body?: unknown) => ({
  method,
  headers: { 'content-type': 'application/json' },
  ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
});

describe('a trashed contact', () => {
  it('reads as 404', async () => {
    const { app } = mount();
    const res = await app.request('http://localhost/contacts/c-1');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: 'Contact not found',
      code: 'CONTACT_NOT_FOUND',
    });
  });

  it('refuses a PATCH with 404 and writes nothing', async () => {
    const { app, queries } = mount();
    const res = await app.request(
      'http://localhost/contacts/c-1',
      json('PATCH', { name: 'Back' }),
    );
    expect(res.status).toBe(404);
    expect(queries.some((q) => q.startsWith('UPDATE app.contacts'))).toBe(
      false,
    );
  });

  it('answers a second DELETE with 404 instead of trashing it again', async () => {
    const { app, queries } = mount();
    const res = await app.request('http://localhost/contacts/c-1', {
      method: 'DELETE',
    });
    expect(res.status).toBe(404);
    expect(queries.some((q) => q.startsWith('UPDATE app.contacts'))).toBe(
      false,
    );
  });
});

describe('POST /knowledge/search without an embedding model', () => {
  it('answers the documented 409 with the domain code', async () => {
    vi.mocked(searchKnowledgeForOrg).mockRejectedValueOnce(
      new KnowledgeError(
        'EMBEDDING_NOT_CONFIGURED',
        'No embedding model is configured for this organization',
        503,
      ),
    );
    const { app } = mount();
    const res = await app.request(
      'http://localhost/knowledge/search',
      json('POST', { query: 'refunds' }),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'No embedding model is configured for this organization',
      code: 'EMBEDDING_NOT_CONFIGURED',
    });
  });
});

describe('POST /knowledge/search when the embedding provider fails', () => {
  it('answers 409 for an account refusal (balance or plan), never a 429', async () => {
    vi.mocked(searchKnowledgeForOrg).mockRejectedValueOnce(
      new KnowledgeError(
        'EMBEDDING_CREDIT_EXHAUSTED',
        "The organization's embedding provider refused the request for account reasons (balance or plan): 429 Insufficient balance or no resource package. Please recharge.",
        503,
      ),
    );
    const { app } = mount();
    const res = await app.request(
      'http://localhost/knowledge/search',
      json('POST', { query: 'refunds' }),
    );
    expect(res.status).toBe(409);
    expect(res.headers.get('retry-after')).toBeNull();
    expect(await res.json()).toEqual({
      error: expect.stringContaining('Insufficient balance'),
      code: 'EMBEDDING_CREDIT_EXHAUSTED',
    });
  });

  it('answers 409 for a rejected credential — provider settings an admin fixes, never a retry', async () => {
    vi.mocked(searchKnowledgeForOrg).mockRejectedValueOnce(
      new KnowledgeError(
        'EMBEDDING_CREDENTIAL_REJECTED',
        "The organization's embedding provider rejected its credential or refused it the model — provider settings an admin must fix: 401 Incorrect API key provided",
        503,
      ),
    );
    const { app } = mount();
    const res = await app.request(
      'http://localhost/knowledge/search',
      json('POST', { query: 'refunds' }),
    );
    expect(res.status).toBe(409);
    expect(res.headers.get('retry-after')).toBeNull();
    expect(await res.json()).toMatchObject({
      code: 'EMBEDDING_CREDENTIAL_REJECTED',
    });
  });

  it('answers 503 for any other provider-side failure', async () => {
    vi.mocked(searchKnowledgeForOrg).mockRejectedValueOnce(
      new KnowledgeError(
        'EMBEDDING_UPSTREAM_ERROR',
        "The organization's embedding provider could not serve the request: 502 Bad Gateway",
        503,
      ),
    );
    const { app } = mount();
    const res = await app.request(
      'http://localhost/knowledge/search',
      json('POST', { query: 'refunds' }),
    );
    expect(res.status).toBe(503);
    // The wait the retry-with-backoff guidance names.
    expect(res.headers.get('retry-after')).toBe('5');
    expect(await res.json()).toEqual({
      error: expect.stringContaining('502 Bad Gateway'),
      code: 'EMBEDDING_UPSTREAM_ERROR',
    });
  });
});

describe('POST /documents/{id}/retry-indexing', () => {
  const hubDocument = (fileRef: string | null) =>
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the projection the route reads
    ({
      id: 'doc-1',
      organizationId: 'org-1',
      projectId: null,
      lifecycleStatus: 'active',
      fileRef,
      title: 'Ledger',
    }) as never;

  const retry = (app: Hono<RestEnv>) =>
    app.request('http://localhost/documents/doc-1/retry-indexing', {
      method: 'POST',
    });

  it('names the content-only skip', async () => {
    vi.mocked(getDocumentById).mockResolvedValueOnce(hubDocument(null));
    const { app } = mount();
    const res = await retry(app);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: 'skipped',
      reason: 'content-only',
    });
  });

  it('names the untracked-blob skip', async () => {
    vi.mocked(getDocumentById).mockResolvedValueOnce(
      hubDocument('s3:acme/private'),
    );
    const { app } = mount({ file: null });
    const res = await retry(app);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: 'skipped',
      reason: 'untracked-blob',
    });
  });

  it('names the persisted opt-out skip', async () => {
    vi.mocked(getDocumentById).mockResolvedValueOnce(
      hubDocument('s3:acme/private'),
    );
    const { app } = mount({ file: { skipRagIndexing: true } });
    const res = await retry(app);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: 'skipped',
      reason: 'rag-opt-out',
    });
  });

  it('queues indexing for a tracked blob without an opt-out', async () => {
    vi.mocked(getDocumentById).mockResolvedValueOnce(
      hubDocument('s3:acme/private'),
    );
    const { app } = mount({ file: { skipRagIndexing: false } });
    const res = await retry(app);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'indexing' });
  });
});

/**
 * A refused body names the field that failed. Each route used to answer a
 * fixed sentence — `invalid body ("name" is required)` for ANY schema
 * failure — so a product with a string `price` was told to add the name it
 * had sent, and a document with an unknown `projectId` to add its title.
 * The cases are the evaluation's own repros.
 */
describe('a refused body names the field that failed', () => {
  const refused = async (
    route: string,
    body: unknown,
  ): Promise<{
    error: string;
    issues: { path: string; message: string }[];
  }> => {
    const { app, queries } = mount();
    const res = await app.request(
      `http://localhost${route}`,
      json('POST', body),
    );
    expect(res.status).toBe(400);
    expect(queries.some((q) => /^(INSERT|UPDATE) (INTO )?app\./.test(q))).toBe(
      false,
    );
    const payload = (await res.json()) as {
      error: string;
      code: string;
      data: { issues: { path: string; message: string }[] };
    };
    expect(payload.code).toBe('INVALID_BODY');
    return { error: payload.error, issues: payload.data.issues };
  };

  it('blames the string price, not the name that was sent', async () => {
    const { error, issues } = await refused('/products', {
      name: 'TALE-EVAL-20260910-INVALID',
      price: '12.34',
    });
    expect(issues).toEqual([
      { path: 'price', message: expect.stringContaining('number') },
    ]);
    expect(error).toContain('"price"');
    expect(error).not.toContain('name');
  });

  it('names the missing product name', async () => {
    const { issues } = await refused('/products', {
      category: 'TALE-EVAL-20260910',
    });
    expect(issues).toEqual([
      { path: 'name', message: expect.stringContaining('string') },
    ]);
  });

  it('names the unknown key a strict body refuses', async () => {
    const { error, issues } = await refused('/documents', {
      title: 'TALE-EVAL-20260910-INVALID',
      content: 'Synthetic test',
      projectId: '00000000-0000-4000-8000-000000000009',
    });
    // The stray key is named as the issue's own path — the field to fix,
    // not a sentence about the body as a whole.
    expect(issues).toEqual([
      { path: 'projectId', message: 'is not a field this body takes' },
    ]);
    expect(error).not.toContain('title');
  });

  it('names the contact source vocabulary the public schema never listed', async () => {
    const { issues } = await refused('/contacts', {
      name: 'TALE-EVAL-20260910-CONTACT-A',
      source: 'TALE-EVAL-20260910',
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ path: 'source' });
    expect(issues[0]?.message).toContain('api_import');
    expect(issues[0]?.message).toContain('custom');
  });

  it('says so when the body is not JSON at all', async () => {
    const { app } = mount();
    const res = await app.request('http://localhost/products', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"name": ',
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'invalid body: The body is not valid JSON',
      code: 'INVALID_BODY',
      data: { issues: [{ path: '', message: 'The body is not valid JSON' }] },
    });
  });
});

describe('knowledge search resource scope', () => {
  it.each([
    ['/knowledge/search', [], true, 'all'],
    ['/projects/p-1/knowledge/search', ['p-1'], false, 'documents'],
  ])(
    'limits %s to the caller and the URL scope',
    async (route, projectIds, includeHub, corpus) => {
      vi.mocked(searchKnowledgeForOrg).mockReset();
      vi.mocked(searchKnowledgeForOrg).mockResolvedValueOnce({
        hits: [],
        diagnostics: { bm25: true, reranked: false, cached: false, legs: {} },
      });
      const { app } = mount({ role: 'member' });
      const res = await app.request(
        `http://localhost${route}`,
        json('POST', { query: 'refunds' }),
      );
      expect(res.status).toBe(200);
      expect(searchKnowledgeForOrg).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          organizationId: 'org-1',
          corpus,
          access: expect.objectContaining({
            userId: 'user-1',
            teamIds: includeHub ? ['org_org-1', 'team-1'] : [],
            projectIds,
            includeHub,
            includeConversationScoped: false,
          }),
        }),
      );
    },
  );

  it.each(['/knowledge/search', '/projects/p-1/knowledge/search'])(
    'rejects payload scope on %s',
    async (route) => {
      vi.mocked(searchKnowledgeForOrg).mockClear();
      const { app } = mount();
      const res = await app.request(
        `http://localhost${route}`,
        json('POST', { query: 'refunds', projectId: 'p-2' }),
      );
      expect(res.status).toBe(400);
      expect(searchKnowledgeForOrg).not.toHaveBeenCalled();
    },
  );

  it.each([null, { organizationId: 'other-org' }, { teamId: 'private-team' }])(
    'hides inaccessible projects before retrieval: %s',
    async (project) => {
      vi.mocked(searchKnowledgeForOrg).mockClear();
      const { app } = mount({ project, role: 'member' });
      const res = await app.request(
        'http://localhost/projects/p-1/knowledge/search',
        json('POST', { query: 'refunds' }),
      );
      expect(res.status).toBe(404);
      expect(searchKnowledgeForOrg).not.toHaveBeenCalled();
    },
  );

  it('refuses a web corpus on project-only retrieval', async () => {
    vi.mocked(searchKnowledgeForOrg).mockClear();
    const { app } = mount();
    const res = await app.request(
      'http://localhost/projects/p-1/knowledge/search',
      json('POST', { query: 'refunds', corpus: 'web' }),
    );
    expect(res.status).toBe(400);
    expect(searchKnowledgeForOrg).not.toHaveBeenCalled();
  });
});

describe('a hub document outside the active lifecycle', () => {
  it.each([
    ['POST', '/documents'],
    ['PATCH', '/documents/doc-1'],
  ])('rejects payload project scope on %s %s', async (method, route) => {
    const { app, queries } = mount();
    const res = await app.request(
      `http://localhost${route}`,
      json(method, { title: 'Project-only information', projectId: 'p-1' }),
    );
    expect(res.status).toBe(400);
    expect(
      queries.some((query) =>
        /^(INSERT|UPDATE) (INTO )?app\.documents\b/.test(query),
      ),
    ).toBe(false);
  });

  it('answers the opaque 404', async () => {
    const { app } = mount();
    const res = await app.request('http://localhost/documents/doc-expired');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: 'Document not found',
      code: 'DOCUMENT_NOT_FOUND',
    });
  });
});

describe('Hub upload attachment authority', () => {
  it.each([
    null,
    { uploadedBy: 'another-user' },
    { uploadedBy: null },
    { documentId: 'private-project-doc' },
    { documentId: 'existing-hub-doc' },
    { threadId: 'private-thread' },
    { conversationId: 'private-conversation' },
  ])(
    'does not publish an unavailable or already-bound file: %s',
    async (file) => {
      const { app, queries } = mount({ role: 'editor', file });
      const response = await app.request(
        'http://localhost/documents',
        json('POST', { title: 'Published copy', fileId: 'file-1' }),
      );
      expect(response.status).toBe(404);
      expect(
        queries.some((query) =>
          /^(INSERT|UPDATE) (INTO )?app\.(documents|file_metadata)\b/.test(
            query,
          ),
        ),
      ).toBe(false);
    },
  );

  it('allows the caller to publish their own unbound upload', async () => {
    const { app, queries } = mount({ role: 'editor' });
    const response = await app.request(
      'http://localhost/documents',
      json('POST', { title: 'My upload', fileId: 'file-1' }),
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id: 'hub-1' });
    expect(
      queries.some((query) => query.startsWith('UPDATE app.file_metadata')),
    ).toBe(true);
  });

  it('keeps content-only Hub creation available', async () => {
    const { app, queries } = mount({ role: 'editor' });
    const response = await app.request(
      'http://localhost/documents',
      json('POST', { title: 'A note', content: 'Visible Hub text' }),
    );
    expect(response.status).toBe(201);
    expect(queries.some((query) => query.includes('app.file_metadata'))).toBe(
      false,
    );
  });
});

describe('PUT /skills/{slug} with team ids', () => {
  it('refuses ids that are not teams of the organization, naming them', async () => {
    const { app, queries } = mount();
    const res = await app.request(
      'http://localhost/skills/reporting',
      json('PUT', {
        description: 'Reports',
        body: '# Reports',
        visibility: 'team',
        teams: ['t-nope'],
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'Unknown team ids: t-nope',
      code: 'SKILL_TEAM_UNKNOWN',
    });
    expect(queries.some((q) => q.includes('FROM "team"'))).toBe(true);
  });
});
