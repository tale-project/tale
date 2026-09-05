// @vitest-environment node

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Hono } from 'hono';
import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDocumentFromUpload } from '../domains/documents/service.ts';
import { getFileUrl, registerUpload } from '../domains/files/service.ts';
import { clearOrgConfigCaches } from '../lib/org-config.ts';
import type { RestEnv } from './shared.ts';
import { createProjectRestRoutes } from './v1-projects.ts';

// The blob store is out of reach here: `registerUpload` stands in for the
// HEAD-attested row (its size is what the policy gate must see), and the
// document create for the step a refusal must never reach. The policy gate
// itself (`validateDocumentUploadForOrg`) runs for real against a seeded
// config tree.
vi.mock('../domains/files/service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../domains/files/service.ts')>()),
  registerUpload: vi.fn(() => Promise.resolve({ fileId: 'f-1', size: 1234 })),
  getFileUrl: vi.fn(() => Promise.resolve('https://blobs.example.com/signed')),
}));
vi.mock('../domains/documents/service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../domains/documents/service.ts')>()),
  createDocumentFromUpload: vi.fn(() => Promise.resolve('d-1')),
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
 * UPSERT (spent or not), and the policy's volume read. `begin` runs the
 * callback on the same tag. */
function fakeSql(opts: { spent?: boolean } = {}): {
  sql: Sql;
  queries: Captured[];
} {
  const queries: Captured[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('$?').replace(/\s+/g, ' ').trim();
    queries.push({ text, values });
    if (text.includes('FROM "teamMember"')) return Promise.resolve([]);
    if (text.includes('FROM app.projects WHERE id')) {
      return Promise.resolve([project]);
    }
    if (text.includes('FROM app.documents WHERE id')) {
      return Promise.resolve([document]);
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
    if (text.includes('sum(size)')) return Promise.resolve([{ total: '0' }]);
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
 * The REST bind runs the organization's upload policy. The regression under
 * test: `POST …/files` went intent → registerUpload → createDocument with
 * nothing but the global 512 MiB ceiling in between, while the spec and the
 * API reference told integrators the bind refuses on the org's MIME /
 * extension allowlist, size caps and per-user quota — any editor-role key
 * bypassed a configured policy silently. The gate now runs inside the bind
 * transaction with the HEAD-attested size, so a refusal rolls the intent
 * consume back and the row keeps the type the gate resolved.
 */
describe('POST /projects/{id}/files upload policy', () => {
  let configRoot: string;
  let savedConfigDir: string | undefined;

  beforeEach(async () => {
    vi.mocked(createDocumentFromUpload).mockClear();
    vi.mocked(registerUpload).mockClear();
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
    // The gate saw the landed size, not a caller-declared one.
    expect(vi.mocked(registerUpload)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createDocumentFromUpload)).not.toHaveBeenCalled();
    expect(
      queries.some((q) => q.text.startsWith('UPDATE app.file_metadata')),
    ).toBe(false);
  });

  it('refuses over the per-user volume quota', async () => {
    await seedUploadPolicy('enabled: true\nmaxTotalVolumeBytesPerUser: 1000\n');
    const { sql } = fakeSql();
    const res = await bind(sql, {});
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'UPLOAD_POLICY_REJECTED' });
    expect(vi.mocked(createDocumentFromUpload)).not.toHaveBeenCalled();
  });

  it('binds an allowed file and stores the type the gate resolved from the name', async () => {
    await seedUploadPolicy('enabled: true\nallowedMimeTypes:\n  - text/*\n');
    const { sql, queries } = fakeSql();
    const res = await bind(sql, { contentType: 'application/octet-stream' });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ file: { id: 'd-1' } });
    const retyped = queries.find((q) =>
      q.text.startsWith('UPDATE app.file_metadata SET content_type'),
    );
    expect(retyped?.values).toEqual(['text/csv', 'f-1']);
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
