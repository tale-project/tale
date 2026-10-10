// @vitest-environment node

/**
 * Project visibility on the app door of /api/app/automations. A run bound to
 * a team-restricted project carries that project's input, output and trace;
 * a member outside the project must learn nothing of it here, exactly as the
 * REST and engine doors already answer. Every run read, run action and
 * binding list goes through the project read rule, and a hidden run answers
 * like a missing one.
 */

import { Hono, type Context } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrgEnv } from '../../auth/org.ts';

const HIDDEN = 'p-hidden';
const SHARED = 'p-shared';

const store = vi.hoisted(() => ({
  answerAsk: vi.fn(),
  bindingProjectIds: vi.fn(),
  setAutomationProjects: vi.fn(),
  beginRun: vi.fn(),
  cancelRun: vi.fn(),
  requestLegacyRunStopInTx: vi.fn(),
  getAskRunId: vi.fn(),
  getPendingAskForRun: vi.fn(),
  getRun: vi.fn(),
  listAutomationsForApp: vi.fn(),
  listRuns: vi.fn(),
  listTriggerRuns: vi.fn(),
  // The read model over the fake rows: identity and the input the hidden
  // run must never leak.
  toRunDetail: vi.fn((row: { id: string; input: string }) => ({
    id: row.id,
    input: row.input,
  })),
}));

/** The signed-in member's organization role; a test may raise it. */
const member = vi.hoisted(() => ({ role: 'member' }));

const visibility = vi.hoisted(() => ({
  readableProject: vi.fn(),
  readableProjectIds: vi.fn(),
  runControlAccess: vi.fn(),
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
        c.set('orgMember', { role: member.role } as never);
        await next();
      },
  };
});

import { createAutomationRoutes } from './routes.ts';

async function request(path: string, init?: RequestInit): Promise<Response> {
  return createAutomationRoutes({
    sql: {
      begin: async (action: (tx: unknown) => unknown) => action({}),
    } as never,
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
  member.role = 'member';
  visibility.readableProject.mockImplementation(
    async (_sql: unknown, _auth: unknown, projectId: string) =>
      projectId === HIDDEN ? null : { id: projectId },
  );
  visibility.readableProjectIds.mockResolvedValue([SHARED]);
  // The real read-vs-control rule over the mocked project lookup: an org run
  // is controllable by any member; a hidden project run is 'hidden'; a readable
  // project run is controllable ('ok') unless a case marks it read-only.
  visibility.runControlAccess.mockImplementation(
    async (_sql: unknown, _auth: unknown, row: { projectId: string | null }) =>
      row.projectId === null
        ? 'ok'
        : row.projectId === HIDDEN
          ? 'hidden'
          : 'ok',
  );
  store.getRun.mockImplementation(
    async (_sql: unknown, _org: string, runId: string) =>
      runId === 'r-hidden'
        ? run('r-hidden', HIDDEN)
        : runId === 'r-org'
          ? run('r-org', null)
          : runId === 'r-proj'
            ? run('r-proj', SHARED)
            : null,
  );
  store.listRuns.mockResolvedValue([]);
  store.getPendingAskForRun.mockResolvedValue({ id: 'ask-1' });
  store.cancelRun.mockResolvedValue({ cancelled: true, status: 'cancelled' });
  store.answerAsk.mockResolvedValue({ runId: 'r-org', taskId: null });
});

describe('app automation door — runs follow the project read rule', () => {
  it('reads a visible organization run and hides a run of a hidden project [AUTO-R2]', async () => {
    const visible = await request('/runs/r-org');
    expect(visible.status).toBe(200);
    expect(await visible.json()).toMatchObject({ run: { id: 'r-org' } });

    const hidden = await request('/runs/r-hidden');
    expect(hidden.status).toBe(404);
    expect(await hidden.text()).not.toContain('hidden project input');
  });

  it('lists only organization runs and runs of readable projects [AUTO-R2]', async () => {
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

  it('lists the runs the trigger started, of organization and readable projects only [AUTO-R2]', async () => {
    store.listTriggerRuns.mockResolvedValue([
      {
        runId: 'r-org',
        startedAt: 2,
        status: 'success',
        deliverySource: 'header',
        header: 'x-github-delivery',
      },
    ]);
    // Mounted where the app serves it: the name rides after the prefix.
    const app = new Hono().route(
      '/api/app/automations',
      createAutomationRoutes({ sql: {} as never, auth: {} as never }),
    );
    const res = await app.request(
      '/api/app/automations/ops/sync/trigger/runs?limit=5',
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      runs: [
        {
          runId: 'r-org',
          startedAt: 2,
          status: 'success',
          deliverySource: 'header',
          header: 'x-github-delivery',
        },
      ],
    });
    expect(store.listTriggerRuns).toHaveBeenCalledWith(
      expect.anything(),
      'o1',
      {
        name: 'ops/sync',
        limit: 5,
        visibleProjectIds: [SHARED],
      },
    );
  });

  it('answers an empty list for a hidden project instead of its runs [AUTO-R2]', async () => {
    const response = await request(`/runs?projectId=${HIDDEN}`);
    expect(await response.json()).toEqual({ runs: [] });
    expect(store.listRuns).not.toHaveBeenCalled();
  });

  it('does not reveal the question a hidden run is waiting on [AUTO-R2]', async () => {
    const hidden = await request('/runs/r-hidden/ask');
    expect(await hidden.json()).toEqual({ ask: null });
    expect(store.getPendingAskForRun).not.toHaveBeenCalled();

    const visible = await request('/runs/r-org/ask');
    expect(await visible.json()).toEqual({ ask: { id: 'ask-1' } });
  });

  it('cannot cancel a run of a hidden project [AUTO-R2]', async () => {
    const hidden = await post('/runs/r-hidden/cancel', {});
    expect(await hidden.json()).toEqual({ cancelled: false });
    expect(store.cancelRun).not.toHaveBeenCalled();

    const visible = await post('/runs/r-org/cancel', {});
    expect(await visible.json()).toEqual({
      cancelled: true,
      status: 'cancelled',
    });
  });

  it('cannot answer the question of a hidden run, and pins a visible answer to its run [AUTO-R2]', async () => {
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

  it('refuses to start a run in a hidden project [AUTO-R2]', async () => {
    const response = await post('/ops/sync/start', {
      mode: 'mock',
      projectId: HIDDEN,
    });
    expect(response.status).toBe(404);
    // The same coded sentence the store's own refusal carries, so the
    // app's toast reads a message rather than a bare code.
    expect(await response.json()).toEqual({
      error: 'PROJECT_NOT_FOUND',
      message: 'Project not found.',
    });
    expect(store.beginRun).not.toHaveBeenCalled();
  });

  it('refuses a read-only member cancelling a readable project run (write gate)', async () => {
    visibility.runControlAccess.mockResolvedValue('forbidden');
    const response = await post('/runs/r-proj/cancel', {});
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: 'RBAC_FORBIDDEN' });
    expect(store.cancelRun).not.toHaveBeenCalled();
  });

  it('refuses a read-only member answering a readable project run (write gate)', async () => {
    visibility.runControlAccess.mockResolvedValue('forbidden');
    store.getAskRunId.mockResolvedValueOnce('r-proj');
    const response = await post('/asks/ask-proj/answer', { answer: 'yes' });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: 'RBAC_FORBIDDEN' });
    expect(store.answerAsk).not.toHaveBeenCalled();
  });

  it('lets a project writer cancel and answer a readable project run', async () => {
    // runControlAccess resolves 'ok' for a writer of the readable project.
    const cancelled = await post('/runs/r-proj/cancel', {});
    expect(cancelled.status).toBe(200);
    expect(await cancelled.json()).toEqual({
      cancelled: true,
      status: 'cancelled',
    });
    expect(store.cancelRun).toHaveBeenCalled();

    store.getAskRunId.mockResolvedValueOnce('r-proj');
    store.answerAsk.mockResolvedValueOnce({ runId: 'r-proj', taskId: null });
    const answered = await post('/asks/ask-proj/answer', { answer: 'yes' });
    expect(answered.status).toBe(200);
    expect(store.answerAsk).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ askId: 'ask-proj', runId: 'r-proj' }),
    );
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
  it('drops hidden projects from the listing and refuses a hidden project scope [AUTO-R2]', async () => {
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

  it('leaves out an automation bound only to hidden projects', async () => {
    store.listAutomationsForApp.mockResolvedValue([
      { name: 'ops/hidden-only', projectIds: [HIDDEN] },
      { name: 'ops/org', projectIds: [] },
    ]);
    const listing = await request('/listing?includeProjectBound=true');
    // Listed with no bindings it would read as an organization automation,
    // which the member could not start.
    expect(await listing.json()).toEqual({
      automations: [{ name: 'ops/org', projectIds: [] }],
    });
  });

  it('saves bindings within the author view so hidden bindings survive', async () => {
    member.role = 'developer';
    const response = await post('/ops/sync/projects', { projectIds: [] });
    expect(response.status).toBe(200);
    expect(store.setAutomationProjects).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        projectIds: [],
        visibleProjectIds: [SHARED],
      }),
    );
  });

  it('drops hidden projects from an automation binding list [AUTO-R2]', async () => {
    store.bindingProjectIds.mockResolvedValue([HIDDEN, SHARED]);
    const response = await request('/ops/sync/projects');
    expect(await response.json()).toEqual({ projectIds: [SHARED] });
  });
});

/**
 * Changing an automation and running it live are owner, admin and developer
 * acts: every authoring route and the live start refuse any other member
 * before a store function is reached (the store here is the real one over an
 * empty `sql`, so a route that let the request through could not answer 403).
 */
describe('app automation door — changing an automation or running it live needs the owner, admin or developer role [AUTO-R1]', () => {
  const REFUSAL = { error: 'admin or developer role required' };

  it.each(['member', 'editor'])(
    'refuses a %s on every route that changes an automation',
    async (role) => {
      member.role = role;
      const refused = [
        await post('/ops/sync/save', { document: { name: 'ops/sync' } }),
        await post('/ops/sync/deploy', { version: 1 }),
        await post('/ops/sync/trigger', {
          kind: 'schedule',
          cron: '0 9 * * 1',
        }),
        await request('/ops/sync/trigger', { method: 'DELETE' }),
        await post('/ops/sync/projects', { projectIds: [SHARED] }),
        await post('/upload', { files: [] }),
        await request('/ops/sync', { method: 'DELETE' }),
      ];
      for (const response of refused) {
        expect(response.status).toBe(403);
        expect(await response.json()).toEqual(REFUSAL);
      }
      expect(store.setAutomationProjects).not.toHaveBeenCalled();
    },
  );

  it.each(['member', 'editor'])(
    'refuses a live run started by a %s, starting nothing',
    async (role) => {
      member.role = role;
      const response = await post('/ops/sync/start', { mode: 'live' });
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual(REFUSAL);
      expect(store.beginRun).not.toHaveBeenCalled();
    },
  );

  it.each(['owner', 'admin', 'developer'])(
    'lets a %s start a live run',
    async (role) => {
      member.role = role;
      store.beginRun.mockResolvedValue({ runId: 'r-live', version: 1 });
      const response = await post('/ops/sync/start', { mode: 'live' });
      expect(response.status).toBe(201);
      expect(store.beginRun).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ mode: 'live', startedBy: 'user:u1' }),
      );
    },
  );
});

describe('legacy quarantine stop requests retain run control and exact identity', () => {
  const stopRequest = {
    expectedClaimEpoch: 3,
    expectedObservedAt: 100,
    action: 'stop',
    acknowledgeUnknownExternalEffects: true,
  };
  it('refuses hidden/read-only runs before the transactional stop request', async () => {
    expect(
      (await post('/runs/r-hidden/legacy-quarantine', stopRequest)).status,
    ).toBe(404);
    visibility.runControlAccess.mockResolvedValue('forbidden');
    expect(
      (await post('/runs/r-proj/legacy-quarantine', stopRequest)).status,
    ).toBe(403);
    expect(store.requestLegacyRunStopInTx).not.toHaveBeenCalled();
  });
  it('rejects absent acknowledgment and caller-supplied actor fields', async () => {
    expect(
      (
        await post('/runs/r-org/legacy-quarantine', {
          ...stopRequest,
          acknowledgeUnknownExternalEffects: false,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await post('/runs/r-org/legacy-quarantine', {
          ...stopRequest,
          actor: 'spoof',
        })
      ).status,
    ).toBe(400);
    expect(store.requestLegacyRunStopInTx).not.toHaveBeenCalled();
  });
  it('uses the authenticated actor and unchanged dialog identity', async () => {
    store.requestLegacyRunStopInTx.mockResolvedValue({
      requested: true,
      status: 'quarantined',
    });
    expect(
      (await post('/runs/r-org/legacy-quarantine', stopRequest)).status,
    ).toBe(200);
    expect(store.requestLegacyRunStopInTx).toHaveBeenCalledWith(
      expect.anything(),
      {
        organizationId: 'o1',
        runId: 'r-org',
        actor: 'u1',
        request: stopRequest,
      },
    );
  });
  it('rejects malformed JSON before reading or mutating a held run', async () => {
    const response = await request('/runs/r-org/legacy-quarantine', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    });
    expect(response.status).toBe(400);
    expect(store.getRun).not.toHaveBeenCalled();
    expect(store.requestLegacyRunStopInTx).not.toHaveBeenCalled();
  });
});
