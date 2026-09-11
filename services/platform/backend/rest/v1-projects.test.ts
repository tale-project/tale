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
  getFileUrl,
  registerUpload,
  statOrgBlob,
} from '../domains/files/service.ts';
import { createProject } from '../domains/projects/service.ts';
import { clearOrgConfigCaches } from '../lib/org-config.ts';
import type { RestEnv } from './shared.ts';
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
  getFileUrl: vi.fn(() => Promise.resolve('https://blobs.example.com/signed')),
  createRestUploadHandoff: vi.fn(() =>
    Promise.resolve({
      storageRef: 's3:acme/blob-new',
      uploadUrl: 'https://blobs.example.com/put',
    }),
  ),
}));
vi.mock('../domains/documents/service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../domains/documents/service.ts')>()),
  createDocumentFromUpload: vi.fn(() => Promise.resolve('d-1')),
}));
// The create core runs for real elsewhere; here only what the door hands
// it — and how it answers the core's refusals — is under test.
vi.mock('../domains/projects/service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../domains/projects/service.ts')>()),
  createProject: vi.fn(() => Promise.resolve('p-1')),
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
  createdBy: 'user-1',
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  archivedAt: null,
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
  const begin = (fn: (tx: unknown) => Promise<unknown>) => fn(sql);
  const sql = Object.assign(tag, { unsafe, begin });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { sql: sql as unknown as Sql, queries };
}

function mount(sql: Sql) {
  const app = new Hono<RestEnv>();
  app.use(async (c, next) => {
    c.set('userId', 'user-1');
    c.set('userEmail', 'user@example.com');
    c.set('organizationId', 'org-1');
    c.set('orgSlug', 'acme');
    c.set('role', 'admin');
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

  it('names a missing externalItemId on the lookup door with a code', async () => {
    const { sql } = fakeSql();
    const res = await mount(sql).request('http://localhost/projects');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      code: 'INVALID_QUERY',
      data: { issues: [{ path: 'externalItemId', message: 'is required' }] },
    });
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
    'does not presign a file outside this live resource: %s',
    async (overrides) => {
      vi.mocked(getFileUrl).mockClear();
      const res = await mount(fakeSql({ document: overrides }).sql).request(
        'http://localhost/projects/p-1/files/d-1/content',
      );
      expect(res.status).toBe(404);
      expect(getFileUrl).not.toHaveBeenCalled();
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
});

/**
 * GET …/files/{documentId}/content presigns WITH the document's title. The
 * regression under test: the route called `getFileUrl` without a filename,
 * and object keys are nameless (`<org>/<uuid>`), so the presigned GET set a
 * bare `attachment` disposition — a `curl -OJ` landed as a UUID while the
 * API reference promised "Content-Disposition carries the filename".
 */
describe('GET /projects/{id}/files/{documentId}/content', () => {
  it('presigns with the document title as the download filename', async () => {
    vi.mocked(getFileUrl).mockClear();
    const { sql } = fakeSql();
    const res = await mount(sql).request(
      'http://localhost/projects/p-1/files/d-1/content',
    );
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(
      'https://blobs.example.com/signed',
    );
    expect(vi.mocked(getFileUrl)).toHaveBeenCalledWith(
      expect.anything(),
      { organizationId: 'org-1' },
      'acme/blob-1',
      { filename: 'ledger-2026-q1.pdf' },
    );
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
