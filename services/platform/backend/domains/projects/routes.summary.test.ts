// @vitest-environment node
import type { Context } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import type { OrgEnv } from '../../auth/org.ts';

const reads = vi.hoisted(() => ({
  getProjectAuthContext: vi.fn(),
  listProjects: vi.fn(),
  listProjectsOverview: vi.fn(),
  listSidebarProjects: vi.fn(),
  searchProjects: vi.fn(),
  getProject: vi.fn(),
}));
vi.mock('./service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./service.ts')>()),
  ...reads,
}));
vi.mock('../../auth/session.ts', () => ({
  requireSession:
    () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
      c.set('sessionBundle', {
        user: { id: 'u1', email: 'u@example.test' },
      } as never);
      await next();
    },
}));
vi.mock('../../auth/org.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../auth/org.ts')>()),
  requireOrgMember:
    () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
      c.set('orgId', 'o1');
      c.set('orgMember', { role: 'member' } as never);
      await next();
    },
}));

import { createProjectRoutes } from './routes.ts';

beforeEach(() => {
  vi.clearAllMocks();
  reads.getProjectAuthContext.mockResolvedValue({ organizationId: 'o1' });
  reads.listProjects.mockResolvedValue([]);
  reads.listProjectsOverview.mockResolvedValue({
    projects: [],
    overdueTruncated: false,
    hasMore: false,
  });
  reads.listSidebarProjects.mockResolvedValue({ projects: [], hasMore: false });
  reads.searchProjects.mockResolvedValue([]);
  reads.getProject.mockResolvedValue({ id: 'p1', instructions: 'Full body' });
});

describe('project summary read doors', () => {
  it.each([
    ['/', 'listProjects'],
    ['/overview', 'listProjectsOverview'],
    ['/sidebar', 'listSidebarProjects'],
    ['/search', 'searchProjects'],
  ] as const)(
    'makes %s summaries additive to the existing full read',
    async (path, name) => {
      const app = createProjectRoutes({ sql: {} as never, auth: {} as never });
      for (const flag of ['', 'false', 'unexpected', 'true']) {
        const response = await app.request(
          `${path}?summary=${flag}&includeArchived=true&q=Apollo&asOf=50`,
        );
        expect(response.status).toBe(200);
        const options = reads[name].mock.calls.at(-1)?.at(-1);
        expect(options).toEqual({
          ...(name === 'listProjects' || name === 'listProjectsOverview'
            ? { includeArchived: true }
            : {}),
          ...(name === 'listProjectsOverview'
            ? { asOf: 50, limit: 50, cursor: null }
            : {}),
          ...(flag === 'true' ? { summary: true } : {}),
        });
      }
    },
  );

  it('keeps the detail door full even if a caller supplies a summary flag', async () => {
    const response = await createProjectRoutes({
      sql: {} as never,
      auth: {} as never,
    }).request('/p1?summary=true');
    expect(response.status).toBe(200);
    expect(reads.getProject).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'p1',
    );
    await expect(response.json()).resolves.toMatchObject({
      project: { instructions: 'Full body' },
    });
  });
});

describe('the project list doors answer one page (#5156)', () => {
  const app = () =>
    createProjectRoutes({ sql: {} as never, auth: {} as never });
  const lastOptions = (read: typeof reads.listProjectsOverview) =>
    read.mock.calls.at(-1)?.at(-1);

  it('pages the projects list with the cursor of its last row', async () => {
    reads.listProjectsOverview.mockResolvedValueOnce({
      projects: [
        { id: 'p3', createdAt: 30 },
        { id: 'p2', createdAt: 20 },
      ],
      overdueTruncated: false,
      hasMore: true,
    });
    const first = await app().request('/overview?limit=2');
    expect(first.status).toBe(200);
    const page = z
      .object({ isDone: z.boolean(), continueCursor: z.string() })
      .parse(await first.json());
    expect(page).toEqual({ isDone: false, continueCursor: '20:p2' });
    expect(lastOptions(reads.listProjectsOverview)).toMatchObject({
      limit: 2,
      cursor: null,
    });

    reads.listProjectsOverview.mockResolvedValueOnce({
      projects: [{ id: 'p1', createdAt: 10 }],
      overdueTruncated: false,
      hasMore: false,
    });
    const next = await app().request(
      `/overview?limit=2&cursor=${encodeURIComponent(page.continueCursor)}`,
    );
    await expect(next.json()).resolves.toMatchObject({
      projects: [{ id: 'p1' }],
      isDone: true,
      continueCursor: '',
    });
    expect(lastOptions(reads.listProjectsOverview)).toMatchObject({
      cursor: { at: 20, id: 'p2' },
    });
  });

  it('refuses a cursor the list never answered, and reads nothing', async () => {
    const response = await app().request('/overview?cursor=not-a-cursor');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: 'INVALID_CURSOR',
    });
    expect(reads.listProjectsOverview).not.toHaveBeenCalled();
  });

  it.each([
    ['', 50],
    ['&limit=7', 7],
    ['&limit=0', 1],
    ['&limit=5000', 100],
    ['&limit=abc', 50],
  ])('reads a page size of %s as %i', async (query, limit) => {
    await app().request(`/overview?includeArchived=false${query}`);
    expect(lastOptions(reads.listProjectsOverview)).toMatchObject({ limit });
    await app().request(`/sidebar?summary=true${query}`);
    expect(reads.listSidebarProjects.mock.calls.at(-1)?.[2]).toBe(limit);
  });

  it('tells Home whether projects lie beyond its page', async () => {
    reads.listSidebarProjects.mockResolvedValueOnce({
      projects: [{ id: 'p1' }],
      hasMore: true,
    });
    const more = await app().request('/sidebar?limit=1');
    await expect(more.json()).resolves.toEqual({
      projects: [{ id: 'p1' }],
      isDone: false,
    });
    const all = await app().request('/sidebar?limit=1');
    await expect(all.json()).resolves.toEqual({ projects: [], isDone: true });
  });
});
