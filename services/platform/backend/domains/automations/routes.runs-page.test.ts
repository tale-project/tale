// @vitest-environment node

/**
 * The Runs table's door: one page of an automation's runs, newest first,
 * narrowed to the statuses and mode the table asks for, continuing where
 * the previous page ended — summaries, never the run's trace — and only
 * runs the reader may see.
 */

import type { Context } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrgEnv } from '../../auth/org.ts';

const { listRunsPage, visibility } = vi.hoisted(() => ({
  listRunsPage: vi.fn(),
  visibility: { projects: ['p-1'] as string[], readable: true },
}));

vi.mock('./store.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./store.ts')>()),
  listRunsPage,
}));

vi.mock('./project-visibility.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./project-visibility.ts')>()),
  readableProjectIds: vi.fn(async () => visibility.projects),
  readableProject: vi.fn(async () =>
    visibility.readable ? { id: 'p-1' } : null,
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

async function get(path: string): Promise<Response> {
  return await createAutomationRoutes({
    sql: {} as never,
    auth: {} as never,
  }).request(`${path}${path.includes('?') ? '&' : '?'}orgId=o1`);
}

function row(id: string, startedAt: number) {
  return {
    id,
    name: 'triage',
    version: 2,
    projectId: null,
    status: 'failed',
    mode: 'mock',
    startedBy: 'user:u1',
    input: { secret: 'never listed' },
    detail: 'boom',
    failureCode: 'node_error',
    startedAt,
    finishedAt: startedAt + 10,
    askPending: false,
    resumeCount: 0,
    lastResumeReason: null,
    lastResumedAt: null,
    stalled: false,
    trace: [{ node: 'x' }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  visibility.projects = ['p-1'];
  visibility.readable = true;
  listRunsPage.mockResolvedValue({
    runs: [row('run-2', 2000), row('run-1', 1000)],
    isDone: false,
    next: { at: 1000, id: 'run-1' },
  });
});

describe('GET /runs/page', () => {
  it('answers a page of summaries and where the next one starts', async () => {
    const res = await get('/runs/page?name=triage&limit=2');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<Record<string, unknown>>;
      next: unknown;
    };
    expect(body.next).toEqual({ at: 1000, id: 'run-1' });
    expect(body.items.map((item) => item.id)).toEqual(['run-2', 'run-1']);
    expect(body.items[0]).toMatchObject({
      status: 'failed',
      failureCode: 'node_error',
    });
    // A summary: never the trace.
    expect(body.items[0]).not.toHaveProperty('trace');
    expect(listRunsPage).toHaveBeenCalledWith(expect.anything(), 'o1', {
      name: 'triage',
      visibleProjectIds: ['p-1'],
      limit: 2,
    });
  });

  it('narrows to statuses and a mode, and continues after a cursor', async () => {
    await get(
      '/runs/page?name=triage&status=failed,waiting,bogus&mode=live&cursor=1000|run-1',
    );
    expect(listRunsPage).toHaveBeenCalledWith(expect.anything(), 'o1', {
      name: 'triage',
      visibleProjectIds: ['p-1'],
      statuses: ['failed', 'waiting'],
      mode: 'live',
      before: { at: 1000, id: 'run-1' },
      limit: 50,
    });
  });

  it('answers nothing for a project the reader cannot read', async () => {
    visibility.readable = false;
    const res = await get('/runs/page?name=triage&projectId=p-9');
    expect(await res.json()).toEqual({ items: [], next: null });
    expect(listRunsPage).not.toHaveBeenCalled();
  });

  it('refuses a cursor or a mode it does not take', async () => {
    for (const query of ['cursor=yesterday', 'mode=dry', 'limit=0']) {
      const res = await get(`/runs/page?name=triage&${query}`);
      expect(res.status, query).toBe(400);
    }
    expect(listRunsPage).not.toHaveBeenCalled();
  });
});
