// @vitest-environment node

/**
 * The board doors take the toolbar's search as `q`, beside the other board
 * filters, so the query narrows the board read itself (#3745) instead of a
 * capped search the page intersected afterwards.
 */

import type { Context } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrgEnv } from '../../auth/org.ts';

const {
  listTasksByProject,
  listTasksForAccessibleProjects,
  getProjectAuthContext,
} = vi.hoisted(() => ({
  listTasksByProject: vi.fn(),
  listTasksForAccessibleProjects: vi.fn(),
  getProjectAuthContext: vi.fn(),
}));

vi.mock('./service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./service.ts')>()),
  listTasksByProject,
  listTasksForAccessibleProjects,
}));
vi.mock('../projects/service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../projects/service.ts')>()),
  getProjectAuthContext,
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

import { createTaskRoutes } from './routes.ts';

async function get(route: string): Promise<Response> {
  return await createTaskRoutes({
    sql: {} as never,
    auth: {} as never,
  }).request(route);
}

const BOARD = { tasks: [], truncated: false, canEdit: true };

beforeEach(() => {
  vi.clearAllMocks();
  getProjectAuthContext.mockResolvedValue({ organizationId: 'o1' });
  listTasksByProject.mockResolvedValue(BOARD);
  listTasksForAccessibleProjects.mockResolvedValue(BOARD);
});

describe('the board doors read the search with the other filters', () => {
  it.each(['/by-project/p1', '/'])(
    'passes explicit thin and full compatibility options for %s',
    async (path) => {
      await get(`${path}?summary=true&q=needle`);
      const read =
        path === '/' ? listTasksForAccessibleProjects : listTasksByProject;
      const filters = read.mock.calls[0]?.at(-1);
      expect(filters).toEqual({
        includeArchived: false,
        summary: true,
        query: 'needle',
      });
      await get(`${path}?summary=false`);
      expect(read.mock.calls[1]?.at(-1)).toEqual({
        includeArchived: false,
        summary: false,
      });
    },
  );
  it('passes a project board its query', async () => {
    const res = await get(
      '/by-project/p1?includeArchived=true&statuses=todo,done&assigneeId=u2&q=Needle%20urgent',
    );

    expect(res.status).toBe(200);
    expect(listTasksByProject).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'p1',
      {
        includeArchived: true,
        statuses: ['todo', 'done'],
        assigneeId: 'u2',
        query: 'Needle urgent',
      },
    );
  });

  it('passes the all-projects board its query', async () => {
    await get('/?includeArchived=false&q=needle');

    expect(listTasksForAccessibleProjects).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { includeArchived: false, query: 'needle' },
    );
  });

  it('reads no query when the board is not searched', async () => {
    await get('/by-project/p1?includeArchived=false');

    expect(listTasksByProject).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'p1',
      { includeArchived: false },
    );
  });
});
