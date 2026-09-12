// @vitest-environment node

import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  MAX_SKILL_BODY_BYTES,
  MAX_SKILL_SLUG_LENGTH,
} from '@tale/shared/schemas/skills';
import { Hono } from 'hono';
import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

  it('names the missing product name as required, not as a type mismatch', async () => {
    const { issues } = await refused('/products', {
      category: 'TALE-EVAL-20260910',
    });
    expect(issues).toEqual([{ path: 'name', message: 'is required' }]);
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
        diagnostics: {
          bm25: true,
          reranked: false,
          cached: false,
          admitted: 0,
          legs: {},
        },
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

/**
 * The skills door over a real temporary config tree — the contract the
 * API reference and the OpenAPI document publish for `PUT /skills/{slug}`.
 * The regressions under test (2026-09-11 external evaluation, G-01/02/03/
 * 14/15/25): the body cap was published at 1,000,000 characters and
 * enforced at 512 KiB of composed document; "create or replace" merged
 * with no way to clear `icon`; `If-None-Match: *` was ignored, so one
 * colliding slug overwrote a shipped bundle; the enum refusal advertised
 * the retired `private`; an over-long slug was refused with the charset
 * sentence and echoed whole; unknown keys were dropped.
 */
describe('the skills door over the file layer', () => {
  let configRoot: string;
  let savedConfigDir: string | undefined;

  beforeEach(async () => {
    savedConfigDir = process.env.TALE_CONFIG_DIR;
    configRoot = await mkdtemp(path.join(tmpdir(), 'tale-rest-skills-'));
    process.env.TALE_CONFIG_DIR = configRoot;
  });

  afterEach(async () => {
    if (savedConfigDir === undefined) {
      delete process.env.TALE_CONFIG_DIR;
    } else {
      process.env.TALE_CONFIG_DIR = savedConfigDir;
    }
    await rm(configRoot, { recursive: true, force: true });
  });

  const put = (
    app: Hono<RestEnv>,
    slug: string,
    body: unknown,
    headers: Record<string, string> = {},
  ) =>
    app.request(`http://localhost/skills/${slug}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });

  it('creates, then refuses a create-only save over the slug with 412 and writes nothing', async () => {
    const { app } = mount();
    const created = await put(app, 'probe', {
      description: 'First',
      body: '# First',
    });
    expect(created.status).toBe(200);
    expect(await created.json()).toMatchObject({
      slug: 'probe',
      description: 'First',
      // The file layer terminates the document with a newline (G-27c).
      body: '# First\n',
      visibility: 'org',
      canEdit: true,
      files: [{ path: 'SKILL.md', size: expect.any(Number) }],
    });

    const refused = await put(
      app,
      'probe',
      { description: 'Overwritten', body: 'probe' },
      { 'if-none-match': '*' },
    );
    expect(refused.status).toBe(412);
    expect(await refused.json()).toEqual({
      error: 'The skill "probe" already exists.',
      code: 'SKILL_EXISTS',
      data: { etag: expect.stringMatching(/^"[0-9a-f]{64}"$/) },
    });
    const read = await app.request('http://localhost/skills/probe');
    expect(await read.json()).toMatchObject({
      description: 'First',
      body: '# First\n',
    });

    // Without the header the same body updates in place.
    const updated = await put(app, 'probe', {
      description: 'Overwritten',
      body: 'probe',
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({ description: 'Overwritten' });
  });

  it('keeps omitted icon and labels (an update, not a replace) and clears them on null', async () => {
    const { app } = mount();
    await put(app, 'probe', {
      description: 'a',
      body: 'x',
      icon: 'lucide:flask-conical',
      labels: ['probe', 'inert'],
    });
    const merged = await put(app, 'probe', { description: 'b', body: 'y' });
    expect(await merged.json()).toMatchObject({
      icon: 'lucide:flask-conical',
      labels: ['probe', 'inert'],
    });

    const cleared = await put(app, 'probe', {
      description: 'c',
      body: 'z',
      icon: null,
      labels: null,
    });
    expect(cleared.status).toBe(200);
    const view: Record<string, unknown> = await cleared.json();
    expect(view).not.toHaveProperty('icon');
    expect(view).not.toHaveProperty('labels');
  });

  it('refuses a body over the published byte budget at the documented cap, in bytes', async () => {
    const { app } = mount();
    // Two bytes per character: a character count under the cap is still
    // over it in bytes, which is what the contract counts.
    const over = 'é'.repeat(MAX_SKILL_BODY_BYTES / 2 + 1);
    const refused = await put(app, 'probe', { description: 'a', body: over });
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({
      code: 'INVALID_BODY',
      error: `invalid body: "body" must be at most ${MAX_SKILL_BODY_BYTES} bytes of UTF-8`,
    });

    const atCap = await put(app, 'probe', {
      description: 'a',
      body: 'b'.repeat(MAX_SKILL_BODY_BYTES),
    });
    expect(atCap.status).toBe(200);
  });

  it('refuses an unknown key and never advertises the retired visibility', async () => {
    const { app } = mount();
    const unknown = await put(app, 'probe', {
      description: 'a',
      body: 'x',
      slug: 'other',
    });
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toMatchObject({
      code: 'INVALID_BODY',
      error: 'invalid body: "slug" is not a field this body takes',
    });

    const retired = await put(app, 'probe', {
      description: 'a',
      body: 'x',
      visibility: 'private',
    });
    expect(retired.status).toBe(400);
    const refusal: { error: string; code: string } = await retired.json();
    expect(refusal.code).toBe('INVALID_BODY');
    expect(refusal.error).toContain('"visibility"');
    expect(refusal.error).not.toContain('private');
    expect(refusal.error).toContain('must be one of "team", "org"');
  });

  it('reads a malformed slug as absent, and refuses to create one naming the rule it breaks', async () => {
    const { app } = mount();
    const long = 'a'.repeat(100);
    const read = await app.request(`http://localhost/skills/${long}`);
    expect(read.status).toBe(404);
    expect(await read.json()).toEqual({
      error: 'Skill not found',
      code: 'SKILL_NOT_FOUND',
    });
    const deleted = await app.request(`http://localhost/skills/${long}`, {
      method: 'DELETE',
    });
    expect(deleted.status).toBe(404);
    expect(await deleted.json()).toMatchObject({ code: 'SKILL_NOT_FOUND' });

    const created = await put(app, long, { description: 'a', body: 'x' });
    expect(created.status).toBe(400);
    const refusal: { error: string; code: string } = await created.json();
    expect(refusal.code).toBe('INVALID_SKILL_SLUG');
    expect(refusal.error).toContain(`at most ${MAX_SKILL_SLUG_LENGTH}`);
    expect(refusal.error).not.toContain(long);
    expect(refusal.error).not.toContain('lowercase');

    const reserved = await put(app, 'claude', { description: 'a', body: 'x' });
    expect(reserved.status).toBe(400);
    expect(await reserved.json()).toMatchObject({
      code: 'INVALID_SKILL_SLUG',
      error: expect.stringContaining('reserved'),
    });
  });
});

/**
 * Optimistic concurrency on the skills door (2026-09-12 external evaluation,
 * G-01/G-02/G-07b): every skill view names its version — `etag`, the quoted
 * SHA-256 of SKILL.md, and `updatedAt` — the GET carries the tag as `ETag`
 * and answers 304 to a validator the caller holds, and PUT/DELETE honour
 * `If-Match` under RFC 9110 strong comparison with 412 `SKILL_STALE` and
 * nothing written. Two simultaneous saves used to both answer 200 "the
 * saved skill" while only one was stored; `If-Match` was read by nothing.
 */
describe('the skills door — entity tags and conditional writes', () => {
  let configRoot: string;
  let savedConfigDir: string | undefined;

  beforeEach(async () => {
    savedConfigDir = process.env.TALE_CONFIG_DIR;
    configRoot = await mkdtemp(path.join(tmpdir(), 'tale-rest-skills-etag-'));
    process.env.TALE_CONFIG_DIR = configRoot;
  });

  afterEach(async () => {
    if (savedConfigDir === undefined) {
      delete process.env.TALE_CONFIG_DIR;
    } else {
      process.env.TALE_CONFIG_DIR = savedConfigDir;
    }
    await rm(configRoot, { recursive: true, force: true });
  });

  const request = (
    app: Hono<RestEnv>,
    method: 'GET' | 'HEAD' | 'PUT' | 'DELETE',
    slug: string,
    options: { body?: unknown; headers?: Record<string, string> } = {},
  ) =>
    app.request(`http://localhost/skills/${slug}`, {
      method,
      headers: {
        ...(options.body === undefined
          ? {}
          : { 'content-type': 'application/json' }),
        ...options.headers,
      },
      ...(options.body === undefined
        ? {}
        : { body: JSON.stringify(options.body) }),
    });
  const skillMdOnDisk = (slug: string) =>
    readFile(
      path.join(configRoot, 'acme', 'skills', slug, 'SKILL.md'),
      'utf-8',
    );

  it('names the version on every view and carries it as ETag on the GET', async () => {
    const { app } = mount();
    const created = await request(app, 'PUT', 'probe', {
      body: { description: 'First', body: '# First' },
    });
    const saved: { etag: string; updatedAt: number } = await created.json();
    expect(saved.etag).toMatch(/^"[0-9a-f]{64}"$/);
    expect(saved.updatedAt).toBeGreaterThan(0);
    // The JSON carries it; the header is the GET's.
    expect(created.headers.get('etag')).toBeNull();

    const read = await request(app, 'GET', 'probe');
    expect(read.status).toBe(200);
    expect(read.headers.get('etag')).toBe(saved.etag);
    expect(await read.json()).toMatchObject({
      etag: saved.etag,
      updatedAt: saved.updatedAt,
    });
    const listed = await app.request('http://localhost/skills');
    expect(await listed.json()).toMatchObject({
      skills: [{ slug: 'probe', etag: saved.etag, updatedAt: saved.updatedAt }],
    });
  });

  it('answers 304 with the tag and no body to a validator the caller holds — weakly compared', async () => {
    const { app } = mount();
    const saved: { etag: string } = await (
      await request(app, 'PUT', 'probe', {
        body: { description: 'First', body: '# First' },
      })
    ).json();
    for (const header of [
      saved.etag,
      `W/${saved.etag}`,
      `"other", ${saved.etag}`,
      '*',
    ]) {
      const res = await request(app, 'GET', 'probe', {
        headers: { 'if-none-match': header },
      });
      expect(res.status, header).toBe(304);
      expect(res.headers.get('etag')).toBe(saved.etag);
      expect(await res.text()).toBe('');
    }
    // A tag it does not hold — or a malformed value — is the full answer.
    for (const header of ['"stale"', 'not-a-tag']) {
      const res = await request(app, 'GET', 'probe', {
        headers: { 'if-none-match': header },
      });
      expect(res.status, header).toBe(200);
    }
  });

  it('refuses a stale, weak or malformed If-Match with 412 SKILL_STALE naming the current tag, the file untouched', async () => {
    const { app } = mount();
    const saved: { etag: string } = await (
      await request(app, 'PUT', 'probe', {
        body: { description: 'First', body: '# First' },
      })
    ).json();
    const before = await skillMdOnDisk('probe');
    for (const header of ['"stale"', `W/${saved.etag}`, 'not-a-tag']) {
      const res = await request(app, 'PUT', 'probe', {
        body: { description: 'Second', body: '# Second' },
        headers: { 'if-match': header },
      });
      expect(res.status, header).toBe(412);
      expect(await res.json()).toEqual({
        error: expect.stringContaining('changed since you read it'),
        code: 'SKILL_STALE',
        data: { etag: saved.etag },
      });
      expect(await skillMdOnDisk('probe')).toBe(before);
    }
  });

  it('lets a matching If-Match through and answers the new tag; `*` on an absent slug is 412 with nothing stored', async () => {
    const { app } = mount();
    const first: { etag: string } = await (
      await request(app, 'PUT', 'probe', {
        body: { description: 'First', body: '# First' },
      })
    ).json();
    const updated = await request(app, 'PUT', 'probe', {
      body: { description: 'Second', body: '# Second' },
      headers: { 'if-match': `"other", ${first.etag}` },
    });
    expect(updated.status).toBe(200);
    const second: { etag: string; body: string } = await updated.json();
    expect(second.body).toBe('# Second\n');
    expect(second.etag).not.toBe(first.etag);
    expect((await request(app, 'GET', 'probe')).headers.get('etag')).toBe(
      second.etag,
    );

    const absent = await request(app, 'PUT', 'fresh', {
      body: { description: 'New', body: '# New' },
      headers: { 'if-match': '*' },
    });
    expect(absent.status).toBe(412);
    expect(await absent.json()).toEqual({
      error: expect.stringContaining('does not exist'),
      code: 'SKILL_STALE',
      data: { etag: null },
    });
    expect((await request(app, 'GET', 'fresh')).status).toBe(404);
  });

  it('guards the delete the same way, and an absent slug stays a 404', async () => {
    const { app } = mount();
    const saved: { etag: string } = await (
      await request(app, 'PUT', 'probe', {
        body: { description: 'First', body: '# First' },
      })
    ).json();
    const stale = await request(app, 'DELETE', 'probe', {
      headers: { 'if-match': '"stale"' },
    });
    expect(stale.status).toBe(412);
    expect(await stale.json()).toMatchObject({
      code: 'SKILL_STALE',
      data: { etag: saved.etag },
    });
    expect((await request(app, 'GET', 'probe')).status).toBe(200);

    const gone = await request(app, 'DELETE', 'probe', {
      headers: { 'if-match': saved.etag },
    });
    expect(gone.status).toBe(204);
    expect((await request(app, 'GET', 'probe')).status).toBe(404);
    // RFC 9110 §13.2.1: the 404 the request would answer anyway wins over
    // the precondition.
    const absent = await request(app, 'DELETE', 'never-made', {
      headers: { 'if-match': '*' },
    });
    expect(absent.status).toBe(404);
  });

  it('rewrites SKILL.md only, preserving the other files and the frontmatter keys the body does not carry', async () => {
    const { app } = mount();
    const dir = path.join(configRoot, 'acme', 'skills', 'bundle');
    await mkdir(path.join(dir, 'scripts'), { recursive: true });
    await writeFile(
      path.join(dir, 'SKILL.md'),
      '---\nname: bundle\ndescription: Seeded.\nvisibility: org\nlicense: MIT\nrecommended-packages:\n  python:\n    - pandas\ncommunity-key: kept\n---\n\nSeeded.\n',
      'utf-8',
    );
    await writeFile(path.join(dir, 'scripts', 'run.py'), 'print(1)\n', 'utf-8');

    const saved = await request(app, 'PUT', 'bundle', {
      body: { description: 'Edited.', body: 'Edited.' },
    });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({
      files: [
        { path: 'SKILL.md', size: expect.any(Number) },
        { path: 'scripts/run.py', size: 9 },
      ],
    });
    const onDisk = await skillMdOnDisk('bundle');
    expect(onDisk).toContain('license: MIT');
    expect(onDisk).toContain('pandas');
    expect(onDisk).toContain('community-key: kept');
    expect(await readFile(path.join(dir, 'scripts', 'run.py'), 'utf-8')).toBe(
      'print(1)\n',
    );
  });

  it('takes disableModelInvocation: omitted keeps it, false drops it', async () => {
    const { app } = mount();
    const set = await request(app, 'PUT', 'probe', {
      body: { description: 'a', body: 'x', disableModelInvocation: true },
    });
    expect(await set.json()).toMatchObject({ disableModelInvocation: true });
    const kept = await request(app, 'PUT', 'probe', {
      body: { description: 'b', body: 'y' },
    });
    expect(await kept.json()).toMatchObject({ disableModelInvocation: true });
    const dropped = await request(app, 'PUT', 'probe', {
      body: { description: 'c', body: 'z', disableModelInvocation: false },
    });
    expect(await dropped.json()).not.toHaveProperty('disableModelInvocation');
    expect(await skillMdOnDisk('probe')).not.toContain(
      'disable-model-invocation',
    );
  });
});

/**
 * The bundle files behind `files[]` are readable (G-04a): raw bytes,
 * named by an attachment disposition, private, never rendered on this
 * origin; the two absences are told apart; a planted symlink is the
 * bundle's own 422, not a 500 (M4).
 */
describe('GET /skills/{slug}/files/{path}', () => {
  let configRoot: string;
  let savedConfigDir: string | undefined;

  beforeEach(async () => {
    savedConfigDir = process.env.TALE_CONFIG_DIR;
    configRoot = await mkdtemp(path.join(tmpdir(), 'tale-rest-skill-files-'));
    process.env.TALE_CONFIG_DIR = configRoot;
    const dir = path.join(configRoot, 'acme', 'skills', 'pdf-notes');
    await mkdir(path.join(dir, 'scripts'), { recursive: true });
    await mkdir(path.join(dir, '.turbo'), { recursive: true });
    await writeFile(
      path.join(dir, 'SKILL.md'),
      '---\nname: pdf-notes\ndescription: Doc.\nvisibility: org\n---\n\nRead PDFs.\n',
      'utf-8',
    );
    await writeFile(
      path.join(dir, 'scripts', 'fill.py'),
      'print("ü")\n',
      'utf-8',
    );
    await writeFile(
      path.join(dir, 'font.bin'),
      Buffer.from([0x00, 0xff, 0x10, 0x80, 0x7f]),
    );
    await writeFile(path.join(dir, '.turbo', 'cache'), 'x', 'utf-8');
  });

  afterEach(async () => {
    if (savedConfigDir === undefined) {
      delete process.env.TALE_CONFIG_DIR;
    } else {
      process.env.TALE_CONFIG_DIR = savedConfigDir;
    }
    await rm(configRoot, { recursive: true, force: true });
  });

  const file = (
    app: Hono<RestEnv>,
    slug: string,
    rawPath: string,
    method = 'GET',
  ) =>
    app.request(`http://localhost/skills/${slug}/files/${rawPath}`, { method });

  it('serves text and binary files byte-exact, with the download headers', async () => {
    const { app } = mount();
    const text = await file(app, 'pdf-notes', 'scripts/fill.py');
    expect(text.status).toBe(200);
    expect(text.headers.get('content-type')).toBe('application/octet-stream');
    expect(text.headers.get('content-length')).toBe(
      String(Buffer.byteLength('print("ü")\n')),
    );
    expect(text.headers.get('content-disposition')).toBe(
      `attachment; filename="fill.py"; filename*=UTF-8''fill.py`,
    );
    expect(text.headers.get('cache-control')).toBe('private, no-store');
    expect(text.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await text.text()).toBe('print("ü")\n');

    const binary = await file(app, 'pdf-notes', 'font.bin');
    expect(binary.status).toBe(200);
    expect([...new Uint8Array(await binary.arrayBuffer())]).toEqual([
      0x00, 0xff, 0x10, 0x80, 0x7f,
    ]);

    const encoded = await file(app, 'pdf-notes', 'scripts%2Ffill.py');
    expect(encoded.status).toBe(200);
    expect(await encoded.text()).toBe('print("ü")\n');

    const document = await file(app, 'pdf-notes', 'SKILL.md');
    expect(document.status).toBe(200);
    expect(await document.text()).toContain('Read PDFs.');
  });

  it('answers HEAD with the headers alone', async () => {
    const { app } = mount();
    const head = await file(app, 'pdf-notes', 'font.bin', 'HEAD');
    expect(head.status).toBe(200);
    expect(head.headers.get('content-length')).toBe('5');
    expect(await head.text()).toBe('');
  });

  it('tells a missing file from a missing skill, and refuses paths the walk never produces', async () => {
    const { app } = mount();
    for (const rawPath of [
      'missing.md',
      '.turbo/cache',
      '%2e%2e/SKILL.md',
      '..%2FSKILL.md',
      'node_modules/x.js',
    ]) {
      const res = await file(app, 'pdf-notes', rawPath);
      expect(res.status, rawPath).toBe(404);
      // A dot-segment the URL parser resolves away leaves the route
      // entirely (the door's catch-all 404); the rest reach the reader.
      if (res.headers.get('content-type')?.includes('application/json')) {
        expect(await res.json()).toEqual({
          error: 'Skill file not found',
          code: 'SKILL_FILE_NOT_FOUND',
        });
      }
    }
    const noSkill = await file(app, 'no-such-skill', 'SKILL.md');
    expect(noSkill.status).toBe(404);
    expect(await noSkill.json()).toEqual({
      error: 'Skill not found',
      code: 'SKILL_NOT_FOUND',
    });
    const malformedSlug = await file(app, 'Not-A-Slug', 'SKILL.md');
    expect(malformedSlug.status).toBe(404);
    expect(await malformedSlug.json()).toMatchObject({
      code: 'SKILL_NOT_FOUND',
    });
  });

  it('answers a planted symlink as 422 SKILL_MALFORMED naming the entry, never a 500', async () => {
    const { app } = mount();
    await symlink(
      '/etc/hostname',
      path.join(configRoot, 'acme', 'skills', 'pdf-notes', 'link.md'),
    );
    const res = await file(app, 'pdf-notes', 'link.md');
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error:
        'skills/pdf-notes/link.md could not be read: the skill bundle contains a symlink',
      code: 'SKILL_MALFORMED',
    });
    // The document read walks the bundle and meets the link too.
    const document = await app.request('http://localhost/skills/pdf-notes');
    expect(document.status).toBe(422);
    expect(await document.json()).toMatchObject({ code: 'SKILL_MALFORMED' });
  });
});
