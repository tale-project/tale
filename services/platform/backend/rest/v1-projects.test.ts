// @vitest-environment node

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Hono } from 'hono';
import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDocumentFromUpload } from '../domains/documents/service.ts';
import {
  createRestUploadHandoff,
  FileError,
  openFileContent,
  registerUpload,
  statOrgBlob,
} from '../domains/files/service.ts';
import {
  archiveProject,
  createProject,
  deleteProject,
  getProjectByExternalItemId,
  listProjectsPage,
  ProjectError,
  restoreProject,
} from '../domains/projects/service.ts';
import { PurgeIncompleteError } from '../domains/retention/service.ts';
import { clearOrgConfigCaches } from '../lib/org-config.ts';
import { formatKeysetCursor, mintCursorFor, type RestEnv } from './shared.ts';
import { createProjectRestRoutes } from './v1-projects.ts';

// The blob store is out of reach here: `statOrgBlob` stands in for the HEAD
// (its size is what the policy gate must see), `registerUpload` for the row
// write a refusal must never reach, and the document create for the step
// after it. The policy gate itself (`validateDocumentUploadForOrg`) runs for
// real against a seeded config tree.
vi.mock('../domains/files/service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../domains/files/service.ts')>()),
  statOrgBlob: vi.fn(() => Promise.resolve({ size: 1234 })),
  registerUpload: vi.fn(() => Promise.resolve({ fileId: 'f-1', size: 1234 })),
  openFileContent: vi.fn(() =>
    Promise.resolve({
      status: 200,
      headers: new Headers({
        'content-type': 'application/pdf',
        'content-length': '11',
        etag: '"abc"',
      }),
      body: new Blob(['hello world']).stream(),
    }),
  ),
  createRestUploadHandoff: vi.fn(() =>
    Promise.resolve({
      storageRef: 's3:acme/blob-new',
      uploadUrl: 'https://blobs.example.com/put',
    }),
  ),
}));
vi.mock('../domains/documents/service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../domains/documents/service.ts')>()),
  deleteDocumentHard: vi.fn(() => Promise.resolve()),
  deleteFolderCascade: vi.fn(() => Promise.resolve()),
  createDocumentFromUpload: vi.fn(() => Promise.resolve('d-1')),
}));
// The lifecycle cores run for real elsewhere; here only what the door hands
// them — and how it answers the cores' refusals — is under test.
vi.mock('../domains/projects/service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../domains/projects/service.ts')>()),
  createProject: vi.fn(() => Promise.resolve('p-1')),
  getProjectByExternalItemId: vi.fn(() => Promise.resolve(null)),
  listProjectsPage: vi.fn(() =>
    Promise.resolve({ projects: [], hasMore: false }),
  ),
  archiveProject: vi.fn(() => Promise.resolve()),
  restoreProject: vi.fn(() => Promise.resolve()),
  deleteProject: vi.fn(() =>
    Promise.resolve({
      detachedDocCount: 0,
      detachedThreadCount: 0,
      cascadedDocCount: 0,
      cascadedThreadCount: 0,
    }),
  ),
}));

interface Captured {
  text: string;
  values: unknown[];
}

const project = {
  id: 'p-1',
  organizationId: 'org-1',
  name: 'Ledger',
  description: null,
  icon: null,
  color: null,
  key: null,
  externalItemId: null,
  taskCounter: 0,
  openTaskCount: 0,
  doneTaskCount: 0,
  projectAgentCount: 0,
  teamId: null,
  sharedWithTeamIds: [],
  instructions: null,
  knowledgeMode: null,
  agentMode: null,
  recommendedAgentSlugs: [],
  allowedAgentSlugs: [],
  modelMode: null,
  recommendedModels: [],
  allowedModels: [],
  connectorsMode: null,
  allowedConnectorSlugs: [],
  createdBy: 'user-1',
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  archivedAt: null,
  pinnedAt: null,
};

const document = {
  id: 'd-1',
  organizationId: 'org-1',
  title: 'ledger-2026-q1.pdf',
  fileRef: 'acme/blob-1',
  mimeType: 'application/pdf',
  extension: 'pdf',
  sourceProvider: null,
  externalItemId: null,
  contentHash: null,
  historyFiles: [],
  teamId: null,
  teamTags: [],
  projectId: 'p-1',
  createdBy: 'user-1',
  folderId: 'fold-1',
  metadata: null,
  lifecycleStatus: 'active',
  record: null,
  scannedPagesDetected: null,
  ocrApplied: null,
  sourceCreatedAt: null,
  sourceModifiedAt: null,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
};

/** Tagged-template Sql double for the bind lane: the visible project, a
 * consumable intent, the org slug for the config tree, the rate limiter's
 * UPSERT (spent or not), and the policy's volume read (`usedBytes` answers
 * the sum at the moment it is read). `begin` runs the callback on the same
 * tag. */
function fakeSql(
  opts: {
    spent?: boolean;
    usedBytes?: () => number;
    projectError?: Error;
    documentError?: Error;
    document?: Record<string, unknown>;
    /** The folder the folder service's load finds; absent for none. */
    folder?: Record<string, unknown>;
    project?: () => Record<string, unknown>;
    /** The upload intent the bind finds; null for none. */
    intent?: Record<string, unknown> | null;
  } = {},
): {
  sql: Sql;
  queries: Captured[];
} {
  const queries: Captured[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('$?').replace(/\s+/g, ' ').trim();
    queries.push({ text, values });
    if (text.includes('FROM "teamMember"')) return Promise.resolve([]);
    if (text.includes('FROM app.projects WHERE id')) {
      if (opts.projectError) return Promise.reject(opts.projectError);
      return Promise.resolve([{ ...project, ...opts.project?.() }]);
    }
    if (text.includes('FROM app.documents WHERE id')) {
      if (opts.documentError) return Promise.reject(opts.documentError);
      return Promise.resolve([{ ...document, ...opts.document }]);
    }
    // The folder service's own load (columns unsafe-spliced); the files
    // listing's `SELECT id FROM app.folders …` keeps falling through.
    if (text.startsWith('SELECT $? FROM app.folders WHERE id')) {
      return Promise.resolve(
        opts.folder === undefined
          ? []
          : [
              {
                id: 'fold-1',
                organizationId: 'org-1',
                projectId: 'p-1',
                parentId: null,
                name: '2026-Q1',
                teamId: null,
                teamTags: [],
                ...opts.folder,
              },
            ],
      );
    }
    if (text.includes('FROM app.rest_upload_intents')) {
      if (opts.intent === null) return Promise.resolve([]);
      return Promise.resolve([
        {
          id: 'u-1',
          s3Ref: 's3:acme/blob-1',
          consumedAt: null,
          expiresAt: Date.now() + 60_000,
          ...opts.intent,
        },
      ]);
    }
    if (text.startsWith('UPDATE app.rest_upload_intents')) {
      return Promise.resolve([{ id: 'u-1' }]);
    }
    if (text.includes('FROM "organization" WHERE "id"')) {
      return Promise.resolve([{ slug: 'acme' }]);
    }
    if (text.includes('INSERT INTO app.rate_limits')) {
      return Promise.resolve(opts.spent ? [] : [{ value: '1' }]);
    }
    if (text.includes('FROM app.rate_limits')) {
      return Promise.resolve([{ value: '0', ts: String(Date.now()) }]);
    }
    if (text.includes('sum(size)')) {
      return Promise.resolve([{ total: String(opts.usedBytes?.() ?? 0) }]);
    }
    return Promise.resolve([]);
  };
  const unsafe = (text: string) => ({ unsafe: text });
  // `begin(fn)` and `begin('isolation level serializable', fn)` alike.
  const begin = (
    optionsOrFn: string | ((tx: unknown) => Promise<unknown>),
    fn?: (tx: unknown) => Promise<unknown>,
  ) => {
    const run = typeof optionsOrFn === 'function' ? optionsOrFn : fn;
    if (run === undefined) throw new Error('Missing transaction callback');
    return run(sql);
  };
  const sql = Object.assign(tag, { unsafe, begin });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { sql: sql as unknown as Sql, queries };
}

function mount(sql: Sql, role = 'admin') {
  const app = new Hono<RestEnv>();
  app.use(async (c, next) => {
    c.set('userId', 'user-1');
    c.set('userEmail', 'user@example.com');
    c.set('organizationId', 'org-1');
    c.set('orgSlug', 'acme');
    c.set('role', role);
    c.set('orgExplicit', true);
    c.set('clientIp', '203.0.113.9');
    return next();
  });
  app.route('/', createProjectRestRoutes({ sql }));
  return app;
}

const bind = (sql: Sql, body: Record<string, unknown>) =>
  mount(sql).request('http://localhost/projects/p-1/files', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      uploadId: 'u-1',
      fileId: 's3:acme/blob-1',
      folderId: 'fold-1',
      fileName: 'ledger.csv',
      ...body,
    }),
  });

/**
 * A name-only create never fails on a key the caller did not choose. The
 * regression under test: the door never asked the create core for its
 * derive-on-collision mode, so a derived key that was taken (`Tale Eval
 * 2026` → `TE2`, already held by an unrelated project) answered 409 for
 * an `externalItemId` nobody had — and the documented lookup-else-create
 * worker looped forever on it. The race two concurrent creates can lose
 * (both pass the SELECT-then-INSERT checks, one hits the unique index) is
 * answered as the documented 409, or retried onto the next free suffix.
 */
describe('POST /projects', () => {
  const create = (sql: Sql, body: Record<string, unknown>) =>
    mount(sql).request('http://localhost/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  const unique = (constraint: string) =>
    Object.assign(new Error('duplicate key value'), {
      code: '23505',
      constraint_name: constraint,
    });

  beforeEach(() => {
    vi.mocked(createProject).mockReset();
    vi.mocked(createProject).mockResolvedValue('p-1');
  });

  it('asks the core to suffix a derived key that is taken', async () => {
    const { sql } = fakeSql();
    const res = await create(sql, {
      name: 'Tale Eval 2026',
      externalItemId: 'crm-4711',
    });
    expect(res.status).toBe(201);
    expect(vi.mocked(createProject).mock.calls[0]?.[2]).toEqual({
      name: 'Tale Eval 2026',
      externalItemId: 'crm-4711',
      deriveKeyOnCollision: true,
    });
  });

  it('retries a derived-key race onto the next free suffix', async () => {
    vi.mocked(createProject)
      .mockRejectedValueOnce(unique('projects_org_key'))
      .mockResolvedValueOnce('p-1');
    const { sql } = fakeSql();
    const res = await create(sql, { name: 'Tale Eval 2026' });
    expect(res.status).toBe(201);
    expect(vi.mocked(createProject)).toHaveBeenCalledTimes(2);
  });

  it('answers 409 PROJECT_KEY_TAKEN for an explicit key that loses the race', async () => {
    vi.mocked(createProject).mockRejectedValueOnce(unique('projects_org_key'));
    const { sql } = fakeSql();
    const res = await create(sql, { name: 'Tale Eval 2026', key: 'te2' });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      code: 'PROJECT_KEY_TAKEN',
      error: expect.stringContaining('TE2'),
    });
    expect(vi.mocked(createProject)).toHaveBeenCalledTimes(1);
  });

  it('answers 409 for an externalItemId that loses the race', async () => {
    vi.mocked(createProject).mockRejectedValueOnce(
      unique('projects_org_external_item'),
    );
    const { sql } = fakeSql();
    const res = await create(sql, {
      name: 'Tale Eval 2026',
      externalItemId: 'crm-4711',
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      code: 'PROJECT_DUPLICATE_EXTERNAL_ID',
    });
  });

  it('trims the name and canonicalizes the external key it hands to the core', async () => {
    const { sql } = fakeSql();
    const nfd = 'acme-café'.normalize('NFD');
    const res = await create(sql, {
      name: '  Tale Eval 2026  ',
      externalItemId: `  ${nfd} `,
    });
    expect(res.status).toBe(201);
    expect(vi.mocked(createProject).mock.calls[0]?.[2]).toMatchObject({
      name: 'Tale Eval 2026',
      externalItemId: 'acme-café',
    });
  });

  it.each([
    ['name', { name: '   ' }, undefined],
    [
      'externalItemId',
      { name: 'Ledger', externalItemId: ' \n ' },
      'must not be blank',
    ],
    ['key', { name: 'Ledger', key: 'TOOLONG' }, undefined],
  ])(
    'refuses %s at the door with 400 INVALID_BODY, before the core',
    async (field, body, message) => {
      const { sql } = fakeSql();
      const res = await create(sql, body);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        code: 'INVALID_BODY',
        data: {
          issues: [
            expect.objectContaining({
              path: field,
              ...(message === undefined ? {} : { message }),
            }),
          ],
        },
      });
      expect(vi.mocked(createProject)).not.toHaveBeenCalled();
    },
  );
});

/**
 * `GET /projects` is two doors: the lookup (the key canonical — NFC,
 * trimmed — before the domain compares it) and, without a key, the LIST
 * that used to be a 400 — keyset-paged like the files listing, archived
 * projects excluded unless asked for. The lifecycle verbs the workspace
 * never had: PATCH archives/restores, DELETE runs the app's own delete
 * (admin, the cascade budget, the door's own confirmation phrase, the
 * state refusals as 409s with their data).
 */
describe('GET /projects — lookup and list', () => {
  const listed = {
    ...project,
    id: 'p-2',
    createdAt: 1_700_000_000_500,
    updatedAt: 1_700_000_000_600,
  };

  beforeEach(() => {
    vi.mocked(getProjectByExternalItemId).mockReset();
    vi.mocked(getProjectByExternalItemId).mockResolvedValue(null);
    vi.mocked(listProjectsPage).mockReset();
    vi.mocked(listProjectsPage).mockResolvedValue({
      projects: [],
      hasMore: false,
    });
  });

  it('looks up by the canonical key and answers the row with its stamps', async () => {
    vi.mocked(getProjectByExternalItemId).mockResolvedValueOnce({
      ...project,
      externalItemId: 'acme-café',
    });
    const { sql } = fakeSql();
    const key = encodeURIComponent(`  ${'acme-café'.normalize('NFD')} `);
    const res = await mount(sql).request(
      `http://localhost/projects?externalItemId=${key}`,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      projects: [
        {
          id: 'p-1',
          name: 'Ledger',
          externalItemId: 'acme-café',
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
        },
      ],
    });
    expect(vi.mocked(getProjectByExternalItemId)).toHaveBeenCalledWith(
      expect.anything(),
      'org-1',
      'acme-café',
    );
    expect(vi.mocked(listProjectsPage)).not.toHaveBeenCalled();
  });

  it.each([
    ['?externalItemId=%20%20', 'externalItemId'],
    ['?externalItemId=crm-1&limit=5', 'limit'],
    ['?externalItemId=crm-1&archived=only', 'archived'],
    ['?archived=nope', 'archived'],
  ])('refuses %s with INVALID_QUERY naming %s', async (query, field) => {
    const { sql } = fakeSql();
    const res = await mount(sql).request(`http://localhost/projects${query}`);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      code: 'INVALID_QUERY',
      data: { issues: [expect.objectContaining({ path: field })] },
    });
    expect(vi.mocked(getProjectByExternalItemId)).not.toHaveBeenCalled();
    expect(vi.mocked(listProjectsPage)).not.toHaveBeenCalled();
  });

  it('lists the visible projects without a key, active ones by default', async () => {
    vi.mocked(listProjectsPage).mockResolvedValueOnce({
      projects: [listed],
      hasMore: false,
    });
    const { sql } = fakeSql();
    const res = await mount(sql).request('http://localhost/projects');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      projects: [
        {
          id: 'p-2',
          name: 'Ledger',
          createdAt: listed.createdAt,
          updatedAt: listed.updatedAt,
        },
      ],
      isDone: true,
    });
    expect(vi.mocked(listProjectsPage)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: 'org-1' }),
      { archived: 'exclude', limit: 25, cursor: null },
    );
  });

  it('pages with a signed keyset cursor and honours the archived filter', async () => {
    vi.mocked(listProjectsPage).mockResolvedValueOnce({
      projects: [listed],
      hasMore: true,
    });
    const { sql } = fakeSql();
    const first = await mount(sql).request(
      'http://localhost/projects?archived=only&limit=1',
    );
    expect(first.status).toBe(200);
    const cursor = mintCursorFor(
      'org-1',
      'projects',
      formatKeysetCursor(listed.createdAt, listed.id),
    );
    expect(await first.json()).toMatchObject({ isDone: false, cursor });
    expect(vi.mocked(listProjectsPage).mock.calls[0]?.[2]).toEqual({
      archived: 'only',
      limit: 1,
      cursor: null,
    });
    const next = await mount(sql).request(
      `http://localhost/projects?archived=only&limit=1&cursor=${encodeURIComponent(cursor)}`,
    );
    expect(next.status).toBe(200);
    expect(vi.mocked(listProjectsPage).mock.calls[1]?.[2]).toEqual({
      archived: 'only',
      limit: 1,
      cursor: { at: listed.createdAt, id: listed.id },
    });
    const forged = await mount(sql).request(
      'http://localhost/projects?cursor=1700000000500:p-2',
    );
    expect(forged.status).toBe(400);
    expect(await forged.json()).toMatchObject({ code: 'INVALID_CURSOR' });
  });
});

describe('PATCH /projects/{id}', () => {
  const patch = (sql: Sql, body: unknown, role?: string) =>
    mount(sql, role).request('http://localhost/projects/p-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  beforeEach(() => {
    vi.mocked(archiveProject).mockClear();
    vi.mocked(restoreProject).mockClear();
  });

  it('archives and restores through the app cores and answers the project', async () => {
    const { sql } = fakeSql();
    const archived = await patch(sql, { archived: true });
    expect(archived.status).toBe(200);
    expect(await archived.json()).toMatchObject({ project: { id: 'p-1' } });
    expect(vi.mocked(archiveProject)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: 'org-1' }),
      'p-1',
    );
    const restored = await patch(sql, { archived: false });
    expect(restored.status).toBe(200);
    expect(vi.mocked(restoreProject)).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'p-1',
    );
  });

  it('refuses an editor with 403 ROLE_FORBIDDEN and a body outside the schema with 400', async () => {
    const { sql } = fakeSql();
    const forbidden = await patch(sql, { archived: true }, 'editor');
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toMatchObject({ code: 'ROLE_FORBIDDEN' });
    expect((await patch(sql, { archived: 'yes' })).status).toBe(400);
    expect((await patch(sql, { name: 'x' })).status).toBe(400);
    expect(vi.mocked(archiveProject)).not.toHaveBeenCalled();
  });

  it('answers the opaque 404 for a project of another organization', async () => {
    const { sql } = fakeSql({ project: () => ({ organizationId: 'other' }) });
    const res = await patch(sql, { archived: true });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: 'PROJECT_NOT_FOUND' });
  });
});

describe('DELETE /projects/{id}', () => {
  const remove = (sql: Sql, body?: unknown, role?: string) =>
    mount(sql, role).request('http://localhost/projects/p-1', {
      method: 'DELETE',
      ...(body === undefined
        ? {}
        : {
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          }),
    });

  beforeEach(() => {
    vi.mocked(deleteProject).mockClear();
  });

  it('cascades by default, on the per-user cascade budget, with the project name as the phrase', async () => {
    const { sql, queries } = fakeSql();
    const res = await remove(sql);
    expect(res.status).toBe(204);
    expect(vi.mocked(deleteProject)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: 'org-1', userId: 'user-1' }),
      { projectId: 'p-1', mode: 'cascade', confirmPhrase: 'Ledger' },
    );
    const charge = queries.find((q) =>
      q.text.includes('INSERT INTO app.rate_limits'),
    );
    expect(charge?.values).toContain('project:delete-cascade');
    expect(charge?.values).toContain('user:user-1');
  });

  it('detaches on request without charging the cascade budget', async () => {
    const { sql, queries } = fakeSql();
    const res = await remove(sql, { mode: 'detach' });
    expect(res.status).toBe(204);
    expect(vi.mocked(deleteProject).mock.calls[0]?.[2]).toEqual({
      projectId: 'p-1',
      mode: 'detach',
    });
    expect(
      queries.some((q) => q.text.includes('INSERT INTO app.rate_limits')),
    ).toBe(false);
  });

  it('refuses an editor with 403 ROLE_FORBIDDEN before any budget or core', async () => {
    const { sql, queries } = fakeSql();
    const res = await remove(sql, undefined, 'editor');
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'ROLE_FORBIDDEN' });
    expect(vi.mocked(deleteProject)).not.toHaveBeenCalled();
    expect(
      queries.some((q) => q.text.includes('INSERT INTO app.rate_limits')),
    ).toBe(false);
  });

  it('answers the standard 429 when the cascade budget is spent', async () => {
    const { sql } = fakeSql({ spent: true });
    const res = await remove(sql);
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
    expect(vi.mocked(deleteProject)).not.toHaveBeenCalled();
  });

  it.each([
    ['PROJECT_HAS_BOUND_AUTOMATIONS', { automations: ['ops/door'] }],
    ['PROJECT_HAS_PROTECTED_RECORDS', { documents: ['SOP-7.pdf'] }],
    ['PROJECT_LEGAL_HOLD', undefined],
  ])('forwards the core’s %s as a 409 with its data', async (code, data) => {
    vi.mocked(deleteProject).mockRejectedValueOnce(
      new ProjectError(code, 'refused', 409, data),
    );
    const { sql } = fakeSql();
    const res = await remove(sql);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      code,
      ...(data === undefined ? {} : { data }),
    });
  });

  it('refuses an unknown mode and a query string never reaches the core', async () => {
    const { sql } = fakeSql();
    const res = await remove(sql, { mode: 'purge' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      code: 'INVALID_BODY',
      data: { issues: [expect.objectContaining({ path: 'mode' })] },
    });
    expect(vi.mocked(deleteProject)).not.toHaveBeenCalled();
  });
});

/**
 * The upload handoff is one deadline: the signed PUT lives exactly as long
 * as the intent it is handed out with. The regression under test: the URL
 * was signed for the store's 15-minute default beside a 30-minute
 * `expiresAt`, so a PUT inside the advertised window answered 403 from
 * the bucket. A file name is checked at the mint too, so a bad one fails
 * before the bytes are uploaded.
 */
describe('POST /projects/{id}/uploads', () => {
  const mint = (sql: Sql, body?: Record<string, unknown>) =>
    mount(sql).request('http://localhost/projects/p-1/uploads', {
      method: 'POST',
      ...(body === undefined
        ? {}
        : {
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          }),
    });

  it('signs the PUT for the intent lifetime and answers the same deadline', async () => {
    vi.mocked(createRestUploadHandoff).mockClear();
    const { sql } = fakeSql();
    const before = Date.now();
    const res = await mint(sql, { contentType: 'text/csv' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { expiresAt: number; url: string };
    expect(body.expiresAt - before).toBeGreaterThanOrEqual(30 * 60_000 - 50);
    expect(body.expiresAt - before).toBeLessThanOrEqual(30 * 60_000 + 5000);
    expect(vi.mocked(createRestUploadHandoff)).toHaveBeenCalledWith(
      expect.anything(),
      { organizationId: 'org-1' },
      { contentType: 'text/csv', expiresInSec: 1800 },
    );
  });

  it.each(['../secret.csv', 'dir/ledger.csv', 'a b.csv', '..'])(
    'refuses the file name %j at the mint with INVALID_BODY',
    async (fileName) => {
      vi.mocked(createRestUploadHandoff).mockClear();
      const { sql } = fakeSql();
      const res = await mint(sql, { fileName });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        code: 'INVALID_BODY',
        data: { issues: [expect.objectContaining({ path: 'fileName' })] },
      });
      expect(vi.mocked(createRestUploadHandoff)).not.toHaveBeenCalled();
    },
  );
});

/**
 * The bind tells the caller which half of the handshake failed: an intent
 * that is unknown, consumed or expired needs a new handoff; a `fileId`
 * other than the one the intent was minted for is the caller's plumbing.
 * One UPDATE used to fold every case into one sentence.
 */
describe('POST /projects/{id}/files intent consume', () => {
  beforeEach(() => {
    vi.mocked(registerUpload).mockClear();
  });

  it.each([
    ['unknown', { intent: null }, 'Unknown uploadId'],
    ['consumed', { intent: { consumedAt: 1 } }, 'already used'],
    ['expired', { intent: { expiresAt: 1 } }, 'expired'],
  ])(
    'answers 409 UPLOAD_INTENT_INVALID for a %s intent',
    async (_case, opts, reason) => {
      const { sql } = fakeSql(opts);
      const res = await bind(sql, {});
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({
        code: 'UPLOAD_INTENT_INVALID',
        error: expect.stringContaining(reason),
      });
      expect(vi.mocked(registerUpload)).not.toHaveBeenCalled();
    },
  );

  it('answers 409 UPLOAD_FILE_MISMATCH when fileId is another blob', async () => {
    const { sql } = fakeSql();
    const res = await bind(sql, { fileId: 's3:acme/other' });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'UPLOAD_FILE_MISMATCH' });
    expect(vi.mocked(registerUpload)).not.toHaveBeenCalled();
  });

  it('refuses a path as the file name before consuming anything', async () => {
    const { sql, queries } = fakeSql();
    const res = await bind(sql, { fileName: '../../etc/passwd' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'INVALID_BODY' });
    expect(
      queries.some((q) => q.text.includes('app.rest_upload_intents')),
    ).toBe(false);
  });
});

describe('project REST resource boundaries', () => {
  it.each([
    ['/projects/p-1', { projectError: new Error('database unavailable') }],
    [
      '/projects/p-1/files/d-1/content',
      { documentError: new Error('database unavailable') },
    ],
  ])('preserves outages as 500 on %s', async (route, options) => {
    const res = await mount(fakeSql(options).sql).request(
      `http://localhost${route}`,
    );
    expect(res.status).toBe(500);
  });

  it.each([
    { projectId: 'other-project' },
    { organizationId: 'other-org' },
    { lifecycleStatus: 'expired' },
    { lifecycleStatus: 'trashed' },
  ])(
    'does not serve a file outside this live resource: %s',
    async (overrides) => {
      vi.mocked(openFileContent).mockClear();
      const res = await mount(fakeSql({ document: overrides }).sql).request(
        'http://localhost/projects/p-1/files/d-1/content',
      );
      expect(res.status).toBe(404);
      expect(openFileContent).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['/projects', { name: 'Ledger' }],
    ['/projects/p-1/folders', { name: 'Invoices' }],
    ['/projects/p-1/uploads', {}],
    [
      '/projects/p-1/files',
      {
        uploadId: 'u-1',
        fileId: 's3:acme/blob-1',
        folderId: 'fold-1',
        fileName: 'ledger.csv',
      },
    ],
  ])('refuses a payload projectId on %s', async (route, body) => {
    const { sql, queries } = fakeSql();
    const res = await mount(sql).request(`http://localhost${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, projectId: 'other-project' }),
    });
    expect(res.status).toBe(400);
    expect(
      queries.some((q) =>
        /^(INSERT|UPDATE) (INTO )?app\.(projects|folders|documents|rest_upload_intents)\b/.test(
          q.text,
        ),
      ),
    ).toBe(false);
  });

  it.each(['folders', 'uploads', 'files'])(
    'rechecks archival inside %s before writing',
    async (resource) => {
      let reads = 0;
      const { sql, queries } = fakeSql({
        project: () => ({ archivedAt: ++reads > 1 ? 123 : null }),
      });
      const res =
        resource === 'files'
          ? await bind(sql, {})
          : await mount(sql).request(
              `http://localhost/projects/p-1/${resource}`,
              {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(
                  resource === 'folders' ? { name: 'Invoices' } : {},
                ),
              },
            );
      expect(res.status).toBe(403);
      expect(
        queries.some((q) =>
          /^(INSERT|UPDATE) (INTO )?app\.(folders|documents|rest_upload_intents)\b/.test(
            q.text,
          ),
        ),
      ).toBe(false);
    },
  );
});

/**
 * The REST bind runs the organization's upload policy. The regression under
 * test: `POST …/files` went intent → registerUpload → createDocument with
 * nothing but the global 512 MiB ceiling in between, while the spec and the
 * API reference told integrators the bind refuses on the org's MIME /
 * extension allowlist, size caps and per-user quota — any editor-role key
 * bypassed a configured policy silently. The gate now runs inside the bind
 * transaction with the HEAD-attested size and BEFORE the metadata row is
 * written (HEAD → policy → row, as the session bind lane goes), so a
 * refusal rolls the intent consume back, the per-user volume sum never
 * sees the file it is admitting, and the row is written with the type the
 * gate resolved.
 */
describe('POST /projects/{id}/files upload policy', () => {
  let configRoot: string;
  let savedConfigDir: string | undefined;

  beforeEach(async () => {
    vi.mocked(createDocumentFromUpload).mockClear();
    vi.mocked(registerUpload).mockClear();
    vi.mocked(statOrgBlob).mockClear();
    clearOrgConfigCaches();
    savedConfigDir = process.env.TALE_CONFIG_DIR;
    configRoot = await mkdtemp(path.join(tmpdir(), 'tale-rest-bind-'));
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

  async function seedUploadPolicy(yaml: string): Promise<void> {
    const dir = path.join(configRoot, 'acme', 'governance');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'upload-policy.yml'), yaml, 'utf-8');
  }

  it('refuses a MIME type outside the org allowlist with 400 and creates nothing', async () => {
    await seedUploadPolicy(
      'enabled: true\nallowedMimeTypes:\n  - application/pdf\n',
    );
    const { sql, queries } = fakeSql();
    const res = await bind(sql, { contentType: 'text/csv' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'UPLOAD_POLICY_REJECTED' });
    // The gate saw the landed size (the HEAD), not a caller-declared one —
    // and refused before any row existed.
    expect(vi.mocked(statOrgBlob)).toHaveBeenCalledWith(
      expect.anything(),
      'org-1',
      's3:acme/blob-1',
    );
    expect(vi.mocked(registerUpload)).not.toHaveBeenCalled();
    expect(vi.mocked(createDocumentFromUpload)).not.toHaveBeenCalled();
    expect(
      queries.some((q) => q.text.startsWith('UPDATE app.file_metadata')),
    ).toBe(false);
  });

  it('answers 404 BLOB_NOT_FOUND and registers nothing when the blob never landed', async () => {
    vi.mocked(statOrgBlob).mockResolvedValueOnce(null);
    const { sql } = fakeSql();
    const res = await bind(sql, {});
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: 'BLOB_NOT_FOUND' });
    expect(vi.mocked(registerUpload)).not.toHaveBeenCalled();
    expect(vi.mocked(createDocumentFromUpload)).not.toHaveBeenCalled();
  });

  it('refuses over the per-user volume quota', async () => {
    await seedUploadPolicy('enabled: true\nmaxTotalVolumeBytesPerUser: 1000\n');
    const { sql } = fakeSql();
    const res = await bind(sql, {});
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'UPLOAD_POLICY_REJECTED' });
    expect(vi.mocked(registerUpload)).not.toHaveBeenCalled();
    expect(vi.mocked(createDocumentFromUpload)).not.toHaveBeenCalled();
  });

  it('counts the file it is admitting once against the per-user volume quota', async () => {
    // The regression under test: the row was INSERTed (size = HEAD) before
    // the policy read `sum(size)` on the same transaction, so the sum
    // already held the file and the gate added it again — a user with
    // headroom for exactly this file (1234 <= 2000 - 0 < 2 * 1234) was
    // refused with `volume_exceeded`. The double mirrors the real row: once
    // `registerUpload` ran, the sum includes the landed bytes.
    await seedUploadPolicy('enabled: true\nmaxTotalVolumeBytesPerUser: 2000\n');
    let landedBytes = 0;
    vi.mocked(registerUpload).mockImplementationOnce(() => {
      landedBytes = 1234;
      return Promise.resolve({ fileId: 'f-1', size: 1234 });
    });
    const { sql, queries } = fakeSql({ usedBytes: () => landedBytes });
    const res = await bind(sql, {});
    expect(res.status).toBe(201);
    expect(vi.mocked(registerUpload)).toHaveBeenCalledTimes(1);
    // The volume read ran before the row write: the sum it saw was 0.
    const volumeRead = queries.find((q) => q.text.includes('sum(size)'));
    expect(volumeRead).toBeDefined();
    expect(landedBytes).toBe(1234);
  });

  it('binds an allowed file and writes the row with the type the gate resolved from the name', async () => {
    await seedUploadPolicy('enabled: true\nallowedMimeTypes:\n  - text/*\n');
    const { sql, queries } = fakeSql();
    const res = await bind(sql, { contentType: 'application/octet-stream' });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ file: { id: 'd-1' } });
    expect(vi.mocked(registerUpload)).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { organizationId: 'org-1', userId: 'user-1' },
      {
        storageRef: 's3:acme/blob-1',
        fileName: 'ledger.csv',
        contentType: 'text/csv',
        source: 'rest',
      },
      { kind: 'external' },
    );
    // No retype pass after the fact — the row is born with the resolved type.
    expect(
      queries.some((q) =>
        q.text.startsWith('UPDATE app.file_metadata SET content_type'),
      ),
    ).toBe(false);
    expect(vi.mocked(createDocumentFromUpload)).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ fileId: 'f-1', folderId: 'fold-1' }),
    );
  });

  it('answers the standard 429 with Retry-After when the org file:upload budget is spent', async () => {
    const { sql } = fakeSql({ spent: true });
    const res = await bind(sql, {});
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
    expect(await res.json()).toMatchObject({ error: 'RATE_LIMITED' });
    expect(vi.mocked(createDocumentFromUpload)).not.toHaveBeenCalled();
  });

  it('answers 400 in the JSON envelope for a malformed body', async () => {
    const { sql } = fakeSql();
    const res = await mount(sql).request(
      'http://localhost/projects/p-1/files',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{',
      },
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
    expect(vi.mocked(registerUpload)).not.toHaveBeenCalled();
  });

  /**
   * The mint runs the bind's TYPE rules on a declared file name, before
   * anything is presigned: a name the policy or the format allowlist would
   * refuse at the bind used to be minted, uploaded (300 KB of bytes), and
   * refused only then — the blob sat in the bucket until the sweep.
   */
  describe('the upload mint runs the type rules on a declared file name', () => {
    const mint = (sql: Sql, body: Record<string, unknown>) =>
      mount(sql).request('http://localhost/projects/p-1/uploads', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

    it('refuses an extension the org policy does not allow, presigning nothing', async () => {
      await seedUploadPolicy('enabled: true\nallowedExtensions:\n  - pdf\n');
      vi.mocked(createRestUploadHandoff).mockClear();
      const { sql, queries } = fakeSql();
      const res = await mint(sql, { fileName: 'ledger.csv' });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        code: 'UPLOAD_POLICY_REJECTED',
        data: { reasonCode: 'extension_not_allowed' },
      });
      expect(vi.mocked(createRestUploadHandoff)).not.toHaveBeenCalled();
      expect(
        queries.some((q) =>
          q.text.startsWith('INSERT INTO app.rest_upload_intents'),
        ),
      ).toBe(false);
      // The type gate charges no upload budget and reads no size.
      expect(queries.some((q) => q.text.includes('sum(size)'))).toBe(false);
    });

    it('refuses a format outside the platform allowlist, and mints an allowed name', async () => {
      vi.mocked(createRestUploadHandoff).mockClear();
      const { sql } = fakeSql();
      const refused = await mint(sql, { fileName: 'blob.bin' });
      expect(refused.status).toBe(400);
      expect(await refused.json()).toMatchObject({
        code: 'UNSUPPORTED_FILE_TYPE',
      });
      expect(vi.mocked(createRestUploadHandoff)).not.toHaveBeenCalled();
      const minted = await mint(sql, {
        fileName: 'ledger.pdf',
        contentType: 'application/pdf',
      });
      expect(minted.status).toBe(200);
      expect(vi.mocked(createRestUploadHandoff)).toHaveBeenCalledTimes(1);
    });
  });
});

/**
 * GET …/files/{documentId}/content serves the bytes ITSELF, named by the
 * document's title (RFC 6266). The regression under test: the route
 * answered a 302 to a presigned URL on the platform's own origin, so every
 * conforming client re-sent its bearer across the hop, the store refused
 * the two authentications, and the documented `curl -sSL -o` wrote that
 * refusal into the file with exit status 0.
 */
describe('GET /projects/{id}/files/{documentId}/content', () => {
  beforeEach(() => {
    vi.mocked(openFileContent).mockClear();
  });

  it('streams the bytes with the document title as the download name, never a redirect', async () => {
    const { sql } = fakeSql();
    const res = await mount(sql).request(
      'http://localhost/projects/p-1/files/d-1/content',
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-length')).toBe('11');
    expect(res.headers.get('etag')).toBe('"abc"');
    expect(res.headers.get('content-disposition')).toBe(
      `attachment; filename="ledger-2026-q1.pdf"; filename*=UTF-8''ledger-2026-q1.pdf`,
    );
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await res.text()).toBe('hello world');
    expect(vi.mocked(openFileContent)).toHaveBeenCalledWith(
      expect.anything(),
      { organizationId: 'org-1' },
      'acme/blob-1',
      expect.objectContaining({ head: false }),
    );
  });

  it('forwards a Range and answers the store’s partial content', async () => {
    vi.mocked(openFileContent).mockResolvedValueOnce({
      status: 206,
      headers: new Headers({
        'content-type': 'application/pdf',
        'content-range': 'bytes 0-4/11',
        'content-length': '5',
      }),
      body: new Blob(['hello']).stream(),
    });
    const { sql } = fakeSql();
    const res = await mount(sql).request(
      'http://localhost/projects/p-1/files/d-1/content',
      { headers: { range: 'bytes=0-4' } },
    );
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 0-4/11');
    expect(await res.text()).toBe('hello');
    expect(vi.mocked(openFileContent)).toHaveBeenCalledWith(
      expect.anything(),
      { organizationId: 'org-1' },
      'acme/blob-1',
      expect.objectContaining({ range: 'bytes=0-4' }),
    );
  });

  it('answers 404 for a blob the store no longer holds, and 503 with Retry-After for a store that fails', async () => {
    vi.mocked(openFileContent).mockResolvedValueOnce(null);
    const { sql } = fakeSql();
    const gone = await mount(sql).request(
      'http://localhost/projects/p-1/files/d-1/content',
    );
    expect(gone.status).toBe(404);
    expect(await gone.json()).toMatchObject({ code: 'FILE_NOT_FOUND' });

    vi.mocked(openFileContent).mockRejectedValueOnce(
      new FileError('OBJECT_STORE_UNAVAILABLE', 'the store answered 500', 503),
    );
    const failed = await mount(sql).request(
      'http://localhost/projects/p-1/files/d-1/content',
    );
    expect(failed.status).toBe(503);
    expect(failed.headers.get('retry-after')).toBe('5');
    expect(await failed.json()).toMatchObject({
      code: 'OBJECT_STORE_UNAVAILABLE',
    });
  });
});

/**
 * POST …/folders passes the per-organization `folder:mutate` budget its
 * in-app twin passes — the spec and the rate-limits page promised it while
 * the route charged only the general lane.
 */
describe('POST /projects/{id}/folders folder:mutate budget', () => {
  it('answers the standard 429 with Retry-After when the org budget is spent', async () => {
    const { sql, queries } = fakeSql({ spent: true });
    const res = await mount(sql).request(
      'http://localhost/projects/p-1/folders',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Invoices' }),
      },
    );
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
    expect(await res.json()).toMatchObject({ error: 'RATE_LIMITED' });
    const charge = queries.find((q) =>
      q.text.includes('INSERT INTO app.rate_limits'),
    );
    expect(charge?.values).toContain('folder:mutate');
    expect(charge?.values).toContain('org:org-1');
    expect(queries.some((q) => q.text.includes('app.folders'))).toBe(false);
  });
});

/**
 * The workspace is no longer create-only: a project file and a project
 * folder can be deleted through the same door that created them. The
 * regression under test: an integrator's mistakes accumulated permanently —
 * nothing this family created could be removed through the API.
 */
describe('DELETE /projects/{id}/files/{documentId}', () => {
  it('purges a file of this project and answers 204', async () => {
    const { deleteDocumentHard } =
      await import('../domains/documents/service.ts');
    vi.mocked(deleteDocumentHard).mockClear();
    const { sql } = fakeSql();
    const res = await mount(sql).request(
      'http://localhost/projects/p-1/files/d-1',
      { method: 'DELETE' },
    );
    expect(res.status).toBe(204);
    expect(deleteDocumentHard).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: 'org-1' }),
      'd-1',
    );
  });

  it.each([
    { projectId: 'other-project' },
    { organizationId: 'other-org' },
    { fileRef: null },
    { lifecycleStatus: 'trashed' },
  ])(
    'answers the opaque 404 for a document outside the live project file set: %j',
    async (shape) => {
      const { deleteDocumentHard } =
        await import('../domains/documents/service.ts');
      vi.mocked(deleteDocumentHard).mockClear();
      const { sql } = fakeSql({ document: shape });
      const res = await mount(sql).request(
        'http://localhost/projects/p-1/files/d-1',
        { method: 'DELETE' },
      );
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ code: 'FILE_NOT_FOUND' });
      expect(deleteDocumentHard).not.toHaveBeenCalled();
    },
  );

  it('answers the purge refusals in the shared envelope', async () => {
    const { deleteDocumentHard } =
      await import('../domains/documents/service.ts');
    vi.mocked(deleteDocumentHard).mockRejectedValueOnce(
      new PurgeIncompleteError('d-1', [
        { ref: 'acme/blob-1', stage: 'corpus', message: 'corpus down' },
      ]),
    );
    const { sql } = fakeSql();
    const res = await mount(sql).request(
      'http://localhost/projects/p-1/files/d-1',
      { method: 'DELETE' },
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: 'PURGE_INCOMPLETE' });
  });
});

describe('DELETE /projects/{id}/folders/{folderId}', () => {
  it('cascades over the folder on the folder:mutate budget and answers 204', async () => {
    const { deleteFolderCascade } =
      await import('../domains/documents/service.ts');
    vi.mocked(deleteFolderCascade).mockClear();
    const { sql, queries } = fakeSql({ folder: {} });
    const res = await mount(sql).request(
      'http://localhost/projects/p-1/folders/fold-1',
      { method: 'DELETE' },
    );
    expect(res.status).toBe(204);
    expect(deleteFolderCascade).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: 'org-1' }),
      'fold-1',
    );
    const charge = queries.find((q) =>
      q.text.includes('INSERT INTO app.rate_limits'),
    );
    expect(charge?.values).toContain('folder:mutate');
  });

  it.each([{ projectId: 'other-project' }, { organizationId: 'other-org' }])(
    'answers the opaque 404 for a folder of another project or organization: %j',
    async (shape) => {
      const { deleteFolderCascade } =
        await import('../domains/documents/service.ts');
      vi.mocked(deleteFolderCascade).mockClear();
      const { sql } = fakeSql({ folder: shape });
      const res = await mount(sql).request(
        'http://localhost/projects/p-1/folders/fold-1',
        { method: 'DELETE' },
      );
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ code: 'FOLDER_NOT_FOUND' });
      expect(deleteFolderCascade).not.toHaveBeenCalled();
    },
  );

  it('answers 404 for a folder nobody has', async () => {
    const { sql } = fakeSql();
    const res = await mount(sql).request(
      'http://localhost/projects/p-1/folders/fold-9',
      { method: 'DELETE' },
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: 'FOLDER_NOT_FOUND' });
  });
});
