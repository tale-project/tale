// @vitest-environment node

/**
 * Project visibility on the app door of /api/app/automations. A run bound to
 * a team-restricted project carries that project's input, output and trace;
 * a member outside the project must learn nothing of it here, exactly as the
 * REST and engine doors already answer. Every run read, run action and
 * binding list goes through the project read rule, and a hidden run answers
 * like a missing one.
 */

import type { Context } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrgEnv } from '../../auth/org.ts';

const HIDDEN = 'p-hidden';
const SHARED = 'p-shared';

const store = vi.hoisted(() => ({
  answerAsk: vi.fn(),
  bindingProjectIds: vi.fn(),
  beginRun: vi.fn(),
  cancelRun: vi.fn(),
  getAskRunId: vi.fn(),
  getPendingAskForRun: vi.fn(),
  getRun: vi.fn(),
  listAutomationsForApp: vi.fn(),
  listRuns: vi.fn(),
  // The read model over the fake rows: identity and the input the hidden
  // run must never leak.
  toRunDetail: vi.fn((row: { id: string; input: string }) => ({
    id: row.id,
    input: row.input,
  })),
}));

const visibility = vi.hoisted(() => ({
  readableProject: vi.fn(),
  readableProjectIds: vi.fn(),
}));

vi.mock('./store.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./store.ts')>();
  return { ...actual, ...store };
});

vi.mock('./project-visibility.ts', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('./project-visibility.ts')>();
  return {
    ...actual,
    ...visibility,
    // The real rule over the mocked project lookup: org runs are visible,
    // project runs only when their project is readable.
    canReadRun: async (
      sql: unknown,
      auth: unknown,
      row: { projectId: string | null },
    ) =>
      row.projectId === null ||
      (await visibility.readableProject(sql, auth, row.projectId)) !== null,
  };
});

vi.mock('../projects/service.ts', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../projects/service.ts')>();
  return {
    ...actual,
    getProjectAuthContext: vi.fn(async () => ({
      organizationId: 'o1',
      userId: 'u1',
      role: 'member',
      teamIds: [],
    })),
  };
});

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

async function request(path: string, init?: RequestInit): Promise<Response> {
  return createAutomationRoutes({
    sql: {} as never,
    auth: {} as never,
  }).request(path, init);
}

function post(path: string, body: unknown): Promise<Response> {
  return request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** A stored run row in the given scope — just the fields the doors read. */
function run(id: string, projectId: string | null) {
  return {
    id,
    name: 'ops/sync',
    version: 1,
    status: 'waiting',
    mode: 'live',
    projectId,
    startedBy: 'user:u2',
    startedAt: 1,
    input: '{"secret":"hidden project input"}',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  visibility.readableProject.mockImplementation(
    async (_sql: unknown, _auth: unknown, projectId: string) =>
      projectId === HIDDEN ? null : { id: projectId },
  );
  visibility.readableProjectIds.mockResolvedValue([SHARED]);
  store.getRun.mockImplementation(
    async (_sql: unknown, _org: string, runId: string) =>
      runId === 'r-hidden'
        ? run('r-hidden', HIDDEN)
        : runId === 'r-org'
          ? run('r-org', null)
          : null,
  );
  store.listRuns.mockResolvedValue([]);
  store.getPendingAskForRun.mockResolvedValue({ id: 'ask-1' });
  store.cancelRun.mockResolvedValue({ cancelled: true, status: 'cancelled' });
  store.answerAsk.mockResolvedValue({ runId: 'r-org', taskId: null });
});

describe('app automation door — runs follow the project read rule', () => {
  it('reads a visible organization run and hides a run of a hidden project', async () => {
    const visible = await request('/runs/r-org');
    expect(visible.status).toBe(200);
    expect(await visible.json()).toMatchObject({ run: { id: 'r-org' } });

    const hidden = await request('/runs/r-hidden');
    expect(hidden.status).toBe(404);
    expect(await hidden.text()).not.toContain('hidden project input');
  });

  it('lists only organization runs and runs of readable projects', async () => {
    await request('/runs?name=ops%2Fsync');
    expect(store.listRuns).toHaveBeenCalledWith(
      expect.anything(),
      'o1',
      expect.objectContaining({
        name: 'ops/sync',
        visibleProjectIds: [SHARED],
      }),
    );
  });

  it('answers an empty list for a hidden project instead of its runs', async () => {
    const response = await request(`/runs?projectId=${HIDDEN}`);
    expect(await response.json()).toEqual({ runs: [] });
    expect(store.listRuns).not.toHaveBeenCalled();
  });

  it('does not reveal the question a hidden run is waiting on', async () => {
    const hidden = await request('/runs/r-hidden/ask');
    expect(await hidden.json()).toEqual({ ask: null });
    expect(store.getPendingAskForRun).not.toHaveBeenCalled();

    const visible = await request('/runs/r-org/ask');
    expect(await visible.json()).toEqual({ ask: { id: 'ask-1' } });
  });

  it('cannot cancel a run of a hidden project', async () => {
    const hidden = await post('/runs/r-hidden/cancel', {});
    expect(await hidden.json()).toEqual({ cancelled: false });
    expect(store.cancelRun).not.toHaveBeenCalled();

    const visible = await post('/runs/r-org/cancel', {});
    expect(await visible.json()).toEqual({
      cancelled: true,
      status: 'cancelled',
    });
  });

  it('cannot answer the question of a hidden run, and pins a visible answer to its run', async () => {
    store.getAskRunId.mockResolvedValueOnce('r-hidden');
    const hidden = await post('/asks/ask-9/answer', { answer: 'yes' });
    expect(hidden.status).toBe(404);
    expect(store.answerAsk).not.toHaveBeenCalled();

    store.getAskRunId.mockResolvedValueOnce('r-org');
    const visible = await post('/asks/ask-1/answer', { answer: 'yes' });
    expect(visible.status).toBe(200);
    expect(store.answerAsk).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ askId: 'ask-1', runId: 'r-org' }),
    );
  });

  it('refuses to start a run in a hidden project', async () => {
    const response = await post('/ops/sync/start', {
      mode: 'mock',
      projectId: HIDDEN,
    });
    expect(response.status).toBe(404);
    expect(store.beginRun).not.toHaveBeenCalled();
  });

  it('refuses a missing question without opening an unscoped answer race', async () => {
    store.getAskRunId.mockResolvedValue(null);
    const response = await post('/asks/new-question/answer', { answer: 'yes' });
    expect(response.status).toBe(404);
    expect(store.answerAsk).not.toHaveBeenCalled();
  });

  it('carries readable projects into admission when the request omits its project', async () => {
    store.beginRun.mockResolvedValue({ runId: 'r-new', version: 1 });
    const response = await post('/ops/sync/start', { mode: 'mock' });
    expect(response.status).toBe(201);
    expect(store.beginRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ visibleProjectIds: [SHARED] }),
    );
  });
});

describe('app automation door — bindings name readable projects only', () => {
  it('drops hidden projects from the listing and refuses a hidden project scope', async () => {
    store.listAutomationsForApp.mockResolvedValue([
      { name: 'ops/sync', projectIds: [SHARED, HIDDEN] },
    ]);
    const listing = await request('/listing?includeProjectBound=true');
    expect(await listing.json()).toEqual({
      automations: [{ name: 'ops/sync', projectIds: [SHARED] }],
    });

    const scoped = await request(`/listing?projectId=${HIDDEN}`);
    expect(await scoped.json()).toEqual({ automations: [] });
  });

  it('drops hidden projects from an automation binding list', async () => {
    store.bindingProjectIds.mockResolvedValue([HIDDEN, SHARED]);
    const response = await request('/ops/sync/projects');
    expect(await response.json()).toEqual({ projectIds: [SHARED] });
  });
});
