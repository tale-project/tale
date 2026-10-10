// @vitest-environment node
import type { Context } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  });
  reads.listSidebarProjects.mockResolvedValue([]);
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
          ...(name === 'listProjectsOverview' ? { asOf: 50 } : {}),
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
