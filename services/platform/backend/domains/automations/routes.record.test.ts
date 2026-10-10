// @vitest-environment node

/**
 * The app's doors onto a run's record. Each is read like the run itself: a
 * hidden run answers exactly like a missing one, two runs compare only when
 * both are readable, an unreadable query is the shared 400, and the read
 * model's refusals keep their codes.
 */

import type { Context } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrgEnv } from '../../auth/org.ts';

const {
  getRun,
  readRunRecord,
  readNodeDetail,
  readNodePage,
  readRunComparison,
  access,
} = vi.hoisted(() => ({
  getRun: vi.fn(),
  readRunRecord: vi.fn(),
  readNodeDetail: vi.fn(),
  readNodePage: vi.fn(),
  readRunComparison: vi.fn(),
  access: { hidden: new Set<string>() },
}));

vi.mock('./store.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./store.ts')>()),
  getRun,
}));

vi.mock('./run-record.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./run-record.ts')>()),
  readRunRecord,
  readNodeDetail,
  readNodePage,
  readRunComparison,
}));

vi.mock('./project-visibility.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./project-visibility.ts')>()),
  canReadRun: vi.fn(
    async (_sql: unknown, _auth: unknown, run: { id: string }) =>
      !access.hidden.has(run.id),
  ),
}));

vi.mock('../projects/service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../projects/service.ts')>()),
  getProjectAuthContext: vi.fn(async () => ({
    organizationId: 'o1',
    userId: 'u1',
    role: 'member',
    teamIds: [],
  })),
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

vi.mock('../../auth/org.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../auth/org.ts')>();
  return {
    ...actual,
    requireOrgMember:
      () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
        c.set('orgId', 'o1');
        c.set('orgMember', { role: 'member' } as never);
        await next();
      },
  };
});

import { createAutomationRoutes } from './routes.ts';
import { AutomationError } from './store.ts';

async function get(path: string): Promise<Response> {
  return await createAutomationRoutes({
    sql: {} as never,
    auth: {} as never,
  }).request(`${path}${path.includes('?') ? '&' : '?'}orgId=o1`);
}

beforeEach(() => {
  vi.clearAllMocks();
  access.hidden.clear();
  getRun.mockImplementation(async (_sql: unknown, _org: string, id: string) =>
    id.startsWith('run_') ? { id, projectId: null } : null,
  );
  readRunRecord.mockResolvedValue({ format: 1, runId: 'run_1', nodes: [] });
  readNodeDetail.mockResolvedValue({ path: 'fetch', item: -1, pass: -1 });
  readNodePage.mockResolvedValue({ path: 'fetch', units: [], next: null });
  readRunComparison.mockResolvedValue({ nodes: [] });
});

describe('GET /runs/:runId/record', () => {
  it('answers the record, with travels and a delta when asked', async () => {
    const res = await get(
      '/runs/run_1/record?since=1790000000000&include=travels',
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      record: { format: 1, runId: 'run_1', nodes: [] },
    });
    expect(readRunRecord).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'o1',
      runId: 'run_1',
      since: 1_790_000_000_000,
      travels: true,
    });
  });

  it('answers a hidden run exactly like a missing one [AUTO-R40]', async () => {
    access.hidden.add('run_1');
    const hidden = await get('/runs/run_1/record');
    const missing = await get('/runs/nope/record');
    expect(hidden.status).toBe(404);
    expect(await hidden.json()).toEqual(await missing.json());
    expect(readRunRecord).not.toHaveBeenCalled();
  });

  it('refuses a `since` that is not a time', async () => {
    const res = await get('/runs/run_1/record?since=yesterday');
    expect(res.status).toBe(400);
    expect(readRunRecord).not.toHaveBeenCalled();
  });
});

describe('GET /runs/:runId/record/node', () => {
  it('reads one unit by its path, item and pass', async () => {
    const res = await get(
      `/runs/run_1/record/node?node=${encodeURIComponent('batch[0:-1]/inner')}&item=2&pass=-1`,
    );
    expect(res.status).toBe(200);
    expect(readNodeDetail).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'o1',
      runId: 'run_1',
      path: 'batch[0:-1]/inner',
      item: 2,
      pass: -1,
    });
  });

  it('names a unit the record does not hold', async () => {
    readNodeDetail.mockResolvedValue(null);
    const res = await get('/runs/run_1/record/node?node=ghost');
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'NODE_RUN_NOT_FOUND' });
  });

  it('refuses a missing step or an item below -1', async () => {
    expect((await get('/runs/run_1/record/node')).status).toBe(400);
    expect((await get('/runs/run_1/record/node?node=a&item=-2')).status).toBe(
      400,
    );
  });
});

describe('GET /runs/:runId/record/items', () => {
  it('pages a step’s units, failed ones only when asked', async () => {
    const res = await get(
      '/runs/run_1/record/items?node=double&cursor=4:-1&limit=20&status=failed',
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      page: { path: 'fetch', units: [], next: null },
    });
    expect(readNodePage).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'o1',
      runId: 'run_1',
      path: 'double',
      cursor: '4:-1',
      limit: 20,
      status: 'failed',
    });
  });

  it('keeps the read model’s refusal of a cursor it cannot read', async () => {
    readNodePage.mockRejectedValue(
      new AutomationError('INVALID_CURSOR', 'no such place', 400),
    );
    const res = await get('/runs/run_1/record/items?node=double&cursor=x');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'INVALID_CURSOR' });
  });

  it('refuses a page past 200 units', async () => {
    expect(
      (await get('/runs/run_1/record/items?node=double&limit=500')).status,
    ).toBe(400);
  });
});

describe('GET /runs/:runId/compare/:otherRunId', () => {
  it('compares two readable runs', async () => {
    const res = await get('/runs/run_1/compare/run_2');
    expect(res.status).toBe(200);
    expect(readRunComparison).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'o1',
      runId: 'run_1',
      otherRunId: 'run_2',
    });
  });

  it('answers not found when either run is hidden [AUTO-R40]', async () => {
    access.hidden.add('run_2');
    const res = await get('/runs/run_1/compare/run_2');
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'RUN_NOT_FOUND' });
    expect(readRunComparison).not.toHaveBeenCalled();
  });

  it('keeps the refusal of two different automations’ runs [AUTO-R40]', async () => {
    readRunComparison.mockRejectedValue(
      new AutomationError('RUN_COMPARE_MISMATCH', 'different automations', 400),
    );
    const res = await get('/runs/run_1/compare/run_2');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'RUN_COMPARE_MISMATCH' });
  });
});
