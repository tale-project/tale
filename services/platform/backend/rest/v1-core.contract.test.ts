// @vitest-environment node

import { Hono } from 'hono';
import type { Sql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';

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

function fakeSql(): { sql: Sql; queries: string[] } {
  const queries: string[] = [];
  const tag = (strings: TemplateStringsArray, ..._values: unknown[]) => {
    const text = strings.join('$?').replace(/\s+/g, ' ').trim();
    queries.push(text);
    if (text.includes('FROM app.contacts WHERE id')) {
      return Promise.resolve([trashed]);
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

function mount() {
  const fake = fakeSql();
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
    expect(await res.json()).toEqual({ error: 'Contact not found' });
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

describe('a hub document outside the active lifecycle', () => {
  it('answers the opaque 404', async () => {
    const { app } = mount();
    const res = await app.request('http://localhost/documents/doc-expired');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Document not found' });
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
