// @vitest-environment node

/**
 * The app's doors onto running a run again. Both read the run as the run is
 * read — a hidden run answers like a missing one; a live replay needs an
 * author, as a live start does; a malformed request is the shared 400; the
 * plan's refusals keep their codes and their steps.
 */

import type { Context } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrgEnv } from '../../auth/org.ts';

const { getRun, readReplayPlan, replayRunInTx, access } = vi.hoisted(() => ({
  getRun: vi.fn(),
  readReplayPlan: vi.fn(),
  replayRunInTx: vi.fn(),
  access: { hidden: new Set<string>(), role: 'member' },
}));

vi.mock('./store.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./store.ts')>()),
  getRun,
}));

vi.mock('./replay.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./replay.ts')>()),
  readReplayPlan,
  replayRunInTx,
}));

vi.mock('./project-visibility.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./project-visibility.ts')>()),
  canReadRun: vi.fn(
    async (_sql: unknown, _auth: unknown, run: { id: string }) =>
      !access.hidden.has(run.id),
  ),
  readableProjectIds: vi.fn(async () => ['p-1']),
}));

vi.mock('../projects/service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../projects/service.ts')>()),
  getProjectAuthContext: vi.fn(async () => ({
    organizationId: 'o1',
    userId: 'u1',
    role: access.role,
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
        c.set('orgMember', { role: access.role } as never);
        await next();
      },
  };
});

import { createAutomationRoutes } from './routes.ts';
import { AutomationError } from './store.ts';

const tx = { tx: true };

async function call(path: string, body?: unknown): Promise<Response> {
  const sql = { begin: async (fn: (t: unknown) => unknown) => fn(tx) };
  return await createAutomationRoutes({
    sql: sql as never,
    auth: {} as never,
  }).request(`${path}${path.includes('?') ? '&' : '?'}orgId=o1`, {
    method: body === undefined ? 'GET' : 'POST',
    ...(body !== undefined && {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  access.hidden.clear();
  access.role = 'member';
  getRun.mockImplementation(async (_sql: unknown, _org: string, id: string) =>
    id.startsWith('run_')
      ? { id, projectId: null, mode: id === 'run_live' ? 'live' : 'mock' }
      : null,
  );
  readReplayPlan.mockResolvedValue({ kind: 'again', reuse: [], rerun: [] });
  replayRunInTx.mockResolvedValue({
    runId: 'run_new',
    version: 1,
    mode: 'mock',
    kind: 'again',
    reused: 0,
  });
});

describe('GET /runs/:runId/replay', () => {
  it('answers the plan for the request in the query', async () => {
    const res = await call('/runs/run_1/replay?kind=from&from=send&version=3');
    expect(res.status).toBe(200);
    expect(readReplayPlan).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'o1',
      sourceRunId: 'run_1',
      request: { kind: 'from', from: 'send', version: 3 },
      canStartLive: false,
    });
  });

  it('answers a hidden run like a missing one [AUTO-R41]', async () => {
    access.hidden.add('run_1');
    const res = await call('/runs/run_1/replay?kind=again');
    expect(res.status).toBe(404);
    expect(readReplayPlan).not.toHaveBeenCalled();
  });

  it('refuses a request that is not one', async () => {
    expect((await call('/runs/run_1/replay?kind=twice')).status).toBe(400);
    expect((await call('/runs/run_1/replay?kind=again&version=0')).status).toBe(
      400,
    );
  });
});

describe('POST /runs/:runId/replay', () => {
  it('starts the replay as the person, in their visible scope', async () => {
    const res = await call('/runs/run_1/replay', {
      kind: 'again',
      requestId: 'click-1',
    });
    expect(res.status).toBe(201);
    expect(replayRunInTx).toHaveBeenCalledWith(tx, {
      organizationId: 'o1',
      sourceRunId: 'run_1',
      request: { kind: 'again' },
      startedBy: 'user:u1',
      canStartLive: false,
      visibleProjectIds: ['p-1'],
      idempotencyKey: 'click-1',
    });
  });

  it('needs an author for a live replay, a live run’s own mode included [AUTO-R41]', async () => {
    expect(
      (await call('/runs/run_1/replay', { kind: 'again', mode: 'live' }))
        .status,
    ).toBe(403);
    expect(
      (await call('/runs/run_live/replay', { kind: 'again' })).status,
    ).toBe(403);
    expect(replayRunInTx).not.toHaveBeenCalled();
    access.role = 'developer';
    expect(
      (await call('/runs/run_live/replay', { kind: 'again' })).status,
    ).toBe(201);
  });

  it('answers a repeat of the same click with the replay it started', async () => {
    replayRunInTx.mockResolvedValue({
      runId: 'run_new',
      version: 1,
      mode: 'mock',
      kind: 'again',
      reused: 0,
      duplicate: true,
    });
    expect(
      (await call('/runs/run_1/replay', { kind: 'again', requestId: 'x' }))
        .status,
    ).toBe(200);
  });

  it('refuses a fork without its step, and keeps the plan’s refusal and steps', async () => {
    expect((await call('/runs/run_1/replay', { kind: 'from' })).status).toBe(
      400,
    );
    replayRunInTx.mockRejectedValue(
      new AutomationError('REPLAY_GRAPH_CHANGED', 'changed', 409, {
        nodes: ['fetch'],
      }),
    );
    const res = await call('/runs/run_1/replay', {
      kind: 'from',
      from: 'send',
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: 'REPLAY_GRAPH_CHANGED',
      data: { nodes: ['fetch'] },
    });
  });
});
