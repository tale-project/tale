// @vitest-environment node

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Auth } from '../../auth/auth.ts';
import { createWebsiteRoutes } from './routes.ts';
import {
  deregisterAndDeleteWebsite,
  fetchWebsitePages,
  patchWebsite,
  registerWebsite,
  resumeScanning,
  scanWebsiteNow,
  syncWebsiteStatuses,
} from './service.ts';

/**
 * Who may change a website source. The regression under test: every door of
 * this router was open to any member of the organization. The page hides
 * its write actions from a role without `knowledgeWrite` and the guide asks
 * for Editor or higher, but the routes checked nothing, so a read-only
 * member could add, edit or delete a website by calling them directly.
 */

const caller = vi.hoisted(() => ({ role: 'member' }));

vi.mock('../../auth/session.ts', () => ({
  requireSession:
    () =>
    async (
      c: { set: (key: string, value: unknown) => void },
      next: () => Promise<void>,
    ) => {
      c.set('sessionBundle', { user: { id: 'user-1' } });
      await next();
    },
}));

// The ability check is the real one; only the membership lookup is stubbed.
vi.mock('../../auth/org.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../auth/org.ts')>()),
  requireOrgMember:
    () =>
    async (
      c: { set: (key: string, value: unknown) => void },
      next: () => Promise<void>,
    ) => {
      c.set('orgId', 'org-1');
      c.set('orgMember', { role: caller.role });
      await next();
    },
}));

vi.mock('./search-readiness.ts', () => ({
  websiteSearchReady: vi.fn(async () => true),
}));

vi.mock('./service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./service.ts')>()),
  countWebsites: vi.fn(async () => 1),
  deregisterAndDeleteWebsite: vi.fn(async () => undefined),
  getWebsite: vi.fn(async () => ({
    id: 'w-1',
    organizationId: 'org-1',
    domain: 'example.com',
    scanInterval: '6h',
    status: 'error',
    metadata: null,
  })),
  fetchWebsitePages: vi.fn(async () => ({
    pages: [],
    total: 0,
    offset: 0,
    hasMore: false,
    state: null,
    counts: { failed: 0, skipped: 0 },
  })),
  listWebsites: vi.fn(async () => ({ page: [], isDone: true })),
  needsStatusSync: vi.fn(() => false),
  patchWebsite: vi.fn(async () => ({ id: 'w-1' })),
  registerWebsite: vi.fn(async () => ({ id: 'w-1', merged: false })),
  resumeScanning: vi.fn(async () => undefined),
  scanWebsiteNow: vi.fn(async () => ({ queued: true })),
  syncScanIntervalToCorpus: vi.fn(async () => undefined),
  syncWebsiteStatuses: vi.fn(async () => undefined),
}));

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test doubles; auth and the service are mocked
const deps = { sql: {} as Sql, auth: {} as Auth };

const call = (
  method: string,
  route: string,
  body?: unknown,
): Promise<Response> =>
  Promise.resolve(
    createWebsiteRoutes(deps).request(route, {
      method,
      headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );

const WRITES = [
  ['POST', '/', { domain: 'example.com', scanInterval: '6h' }],
  ['PATCH', '/w-1', { title: 'Example' }],
  ['DELETE', '/w-1', undefined],
  ['POST', '/w-1/resume', {}],
  ['POST', '/w-1/scan', {}],
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  caller.role = 'member';
});

describe('website routes — who may manage a source', () => {
  it.each(WRITES)(
    'refuses a read-only member: %s %s [WEB-R1]',
    async (method, route, body) => {
      const response = await call(method, route, body);

      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: 'RBAC_FORBIDDEN' });
      for (const write of [
        registerWebsite,
        patchWebsite,
        deregisterAndDeleteWebsite,
        resumeScanning,
        scanWebsiteNow,
      ]) {
        expect(write).not.toHaveBeenCalled();
      }
    },
  );

  it.each(['editor', 'developer', 'admin', 'owner'])(
    'lets a role with knowledge write through every door: %s [WEB-R1]',
    async (role) => {
      caller.role = role;

      const statuses: number[] = [];
      for (const [method, route, body] of WRITES) {
        statuses.push((await call(method, route, body)).status);
      }

      expect(statuses).toEqual([201, 200, 200, 200, 200]);
      expect(scanWebsiteNow).toHaveBeenCalledTimes(1);
    },
  );

  it('keeps reading, the status sync and the search fact open to every member [WEB-R1]', async () => {
    const list = await call('GET', '/');
    const count = await call('GET', '/count');
    const one = await call('GET', '/w-1');
    const sync = await call('POST', '/sync-statuses', {});
    const readiness = await call('GET', '/search-readiness');

    expect([
      list.status,
      count.status,
      one.status,
      sync.status,
      readiness.status,
    ]).toEqual([200, 200, 200, 200, 200]);
    expect(syncWebsiteStatuses).toHaveBeenCalledTimes(1);
    expect(await readiness.json()).toEqual({ ready: true });
  });

  // The page list narrowed to one state: the filter reaches the corpus
  // read, and a state the list does not know is refused, not read as all.
  it('narrows the pages to one state and refuses one it does not know', async () => {
    const failed = await call('GET', '/w-1/pages?state=failed');
    expect(failed.status).toBe(200);
    expect(vi.mocked(fetchWebsitePages).mock.calls.at(-1)?.[2]).toEqual({
      offset: 0,
      limit: 100,
      state: 'failed',
    });
    const all = await call('GET', '/w-1/pages');
    expect(all.status).toBe(200);
    expect(vi.mocked(fetchWebsitePages).mock.calls.at(-1)?.[2]).toEqual({
      offset: 0,
      limit: 100,
    });
    const broken = await call('GET', '/w-1/pages?state=broken');
    expect(broken.status).toBe(400);
    expect(fetchWebsitePages).toHaveBeenCalledTimes(2);
  });

  it('answers what Scan now queued', async () => {
    caller.role = 'editor';

    const response = await call('POST', '/w-1/scan', {});

    expect(await response.json()).toEqual({ ok: true, queued: true });
  });
});
