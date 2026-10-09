// @vitest-environment node

import type { Context } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrgEnv } from '../../auth/org.ts';

const {
  caller,
  capacity,
  deploymentLimits,
  policy,
  listViews,
  pin,
  reconcileOrg,
  agentNodeOp,
  getRun,
  canReadRun,
  projectAuth,
  scheduleDestroy,
  destroyStates,
  deletions,
  waitingRuns,
} = vi.hoisted(() => ({
  caller: { role: 'admin' },
  capacity: vi.fn(),
  deploymentLimits: vi.fn(),
  policy: vi.fn(),
  listViews: vi.fn(),
  pin: vi.fn(),
  reconcileOrg: vi.fn(),
  agentNodeOp: vi.fn(),
  getRun: vi.fn(),
  // The real rule is covered by automations/routes.project-scope.test.ts;
  // here the fake only marks project 'p-hidden' unreadable so the route's
  // wiring (load run → check → fail closed) is what is under test.
  canReadRun: vi.fn(
    async (_sql: unknown, _auth: unknown, run: { projectId: string | null }) =>
      run.projectId === null || run.projectId !== 'p-hidden',
  ),
  projectAuth: vi.fn(async () => ({
    organizationId: 'member-org',
    userId: 'u1',
    role: 'member',
    teamIds: [],
  })),
  scheduleDestroy: vi.fn(),
  destroyStates: vi.fn(),
  deletions: vi.fn(),
  waitingRuns: vi.fn(),
}));

vi.mock('../../auth/session.ts', () => ({
  requireSession:
    () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
      c.set('sessionBundle', {
        user: { id: 'u1', email: 'u@example.test', name: 'User' },
        session: { id: 's1' },
      });
      await next();
    },
}));
vi.mock('../../auth/org.ts', () => ({
  requireOrgMember:
    () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
      c.set('orgId', 'member-org');
      c.set('orgMember', {
        id: 'm1',
        organizationId: 'member-org',
        userId: 'u1',
        role: caller.role,
      });
      await next();
    },
}));
vi.mock('../../core/node_only/sandbox/helpers/session_client.ts', () => ({
  sandboxCapacity: capacity,
  sandboxDeploymentLimits: deploymentLimits,
  sessionCancelExec: vi.fn(),
}));
vi.mock('../../lib/org-config.ts', () => ({
  readGovernancePolicyForOrg: policy,
}));
vi.mock('./service.ts', () => ({
  pinSession: pin,
}));
vi.mock('./destroy-schedule.ts', () => ({
  scheduleSessionDestroy: scheduleDestroy,
  sessionDestroyStates: destroyStates,
}));
vi.mock('./watchdogs.ts', () => ({
  reconcileOrgSessions: reconcileOrg,
}));
vi.mock('./workspace-cleanup.ts', () => ({
  unusedWorkspaceDeletions: deletions,
}));
vi.mock('./sessions.ts', () => ({
  countWaitingAgentRuns: waitingRuns,
  listSandboxViewsForOrg: listViews,
  listRunningOpsBySession: vi.fn(),
  getAgentNodeSandboxOp: agentNodeOp,
}));
vi.mock('../automations/store.ts', () => ({ getRun }));
vi.mock('../automations/project-visibility.ts', () => ({ canReadRun }));
vi.mock('../projects/service.ts', () => ({
  getProjectAuthContext: projectAuth,
}));

import { sessionCancelExec } from '../../core/node_only/sandbox/helpers/session_client.ts';
import { createSandboxRoutes } from './routes.ts';
import { listRunningOpsBySession } from './sessions.ts';

const query = vi.fn(async () => [{ ownerType: 'project_agent', count: '2' }]);
const app = () =>
  createSandboxRoutes({ sql: query as never, auth: {} as never });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('SANDBOX_TOKEN', 'route-test-only');
  caller.role = 'admin';
  deploymentLimits.mockResolvedValue({ maxSessions: 16 });
  capacity.mockResolvedValue({
    status: 'available',
    observedAt: 1000,
    runtimeSessions: [
      { sessionId: 'private-project-session', state: 'running' },
    ],
    placements: [
      { sessionId: 'private-project-session', deviceId: 'private-device' },
    ],
  });
  policy.mockResolvedValue({
    maxSessionsPerOrg: 2,
    maxWorkflowSessionsPerOrg: 4,
    maxRenderSessionsPerOrg: 6,
  });
  listViews.mockResolvedValue([]);
  deletions.mockResolvedValue(new Map());
  destroyStates.mockResolvedValue(new Map());
});
afterEach(() => vi.unstubAllEnvs());

describe('sandbox settings read and write authority', () => {
  it.each(['owner', 'admin', 'developer'])(
    'allows %s to inspect the authenticated organization [SBX-R1] [SBX-R2] [SBX-R3]',
    async (role) => {
      caller.role = role;
      const response = await app().request(
        '/capacity?orgId=foreign&organizationId=foreign',
      );
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(capacity).toHaveBeenCalledWith('member-org');
      const limitsResponse = await app().request(
        '/limits?maxSessions=1000&orgId=foreign',
      );
      expect(limitsResponse.status).toBe(200);
      expect(deploymentLimits).toHaveBeenCalledWith('member-org');
      expect(limitsResponse.headers.get('cache-control')).toBe('no-store');
      expect(await limitsResponse.json()).toEqual({
        status: 'available',
        maxSessions: 16,
      });
      expect((await app().request('/quota-usage')).status).toBe(200);
      expect((await app().request('/sessions/view')).status).toBe(
        role === 'developer' ? 403 : 200,
      );
      if (role === 'developer') {
        expect(listViews).not.toHaveBeenCalled();
        expect(await response.json()).toEqual({
          status: 'available',
          observedAt: 1000,
          runtimeSessions: [],
          placements: [],
        });
      } else {
        expect(listViews).toHaveBeenCalledWith(query, 'member-org');
        expect(await response.json()).toMatchObject({
          runtimeSessions: [{ sessionId: 'private-project-session' }],
          placements: [
            {
              sessionId: 'private-project-session',
              deviceId: 'private-device',
            },
          ],
        });
      }
      expect(policy).toHaveBeenCalledWith(query, 'member-org', 'sandbox_quota');
    },
  );

  it.each(['member', 'editor', 'viewer'])(
    'withholds infrastructure reads from %s [SBX-R1] [SBX-R2]',
    async (role) => {
      caller.role = role;
      for (const path of [
        '/capacity',
        '/limits',
        '/quota-usage',
        '/sessions/view',
      ]) {
        expect((await app().request(path)).status).toBe(403);
      }
      expect(capacity).not.toHaveBeenCalled();
      expect(deploymentLimits).not.toHaveBeenCalled();
      expect(query).not.toHaveBeenCalled();
    },
  );

  it('dates the deletion of each hibernated agent workspace [SBX-R12]', async () => {
    const view = (sessionId: string, extra: Record<string, unknown>) => ({
      sessionId,
      ownerType: 'project_agent',
      status: 'stopped',
      pinned: false,
      ...extra,
    });
    listViews.mockResolvedValue([
      view('pa-idle', {}),
      view('pa-pinned', { pinned: true }),
      view('pa-busy', { status: 'active' }),
      view('wf-run', { ownerType: 'workflow_run' }),
    ]);
    deletions.mockResolvedValue(new Map([['pa-idle', 1_000_000]]));
    const response = await app().request('/sessions/view');
    expect(response.status).toBe(200);
    // Only a stopped, unpinned agent workspace is asked about.
    expect(deletions).toHaveBeenCalledWith(query, 'member-org', ['pa-idle']);
    const body = (await response.json()) as {
      sessions: Array<{ sessionId: string; deletesAt: number | null }>;
    };
    expect(
      body.sessions.map(({ sessionId, deletesAt }) => [sessionId, deletesAt]),
    ).toEqual([
      ['pa-idle', 1_000_000],
      ['pa-pinned', null],
      ['pa-busy', null],
      ['wf-run', null],
    ]);
  });

  it('counts every run waiting for room beside the rows [SBX-R21]', async () => {
    listViews.mockResolvedValue([]);
    const counts = {
      total: 3,
      byReason: {
        org_limit: 2,
        host: 0,
        destroy_pending: 0,
        exec_limit: 0,
        unknown: 1,
      },
    };
    waitingRuns.mockResolvedValue(counts);
    const response = await app().request('/sessions/view');
    expect(response.status).toBe(200);
    expect(waitingRuns).toHaveBeenCalledWith(query, 'member-org');
    expect(await response.json()).toEqual({
      sessions: [],
      waitingRuns: counts,
    });
  });

  it('keeps developers read-only for every sandbox mutation [SBX-R2]', async () => {
    caller.role = 'developer';
    for (const path of [
      '/reconcile',
      '/sessions/s1/pin',
      '/sessions/s1/destroy',
      '/sessions/s1/stop-task',
    ]) {
      expect(
        (
          await app().request(path, {
            method: 'POST',
            body: '{"pinned":true}',
            headers: { 'content-type': 'application/json' },
          })
        ).status,
      ).toBe(403);
    }
    expect(query).not.toHaveBeenCalled();
    expect(pin).not.toHaveBeenCalled();
    expect(reconcileOrg).not.toHaveBeenCalled();
    expect(scheduleDestroy).not.toHaveBeenCalled();
  });

  it.each(['member', 'editor', 'viewer'])(
    'refuses %s every sandbox mutation [SBX-R2]',
    async (role) => {
      caller.role = role;
      for (const path of [
        '/reconcile',
        '/sessions/s1/pin',
        '/sessions/s1/destroy',
        '/sessions/s1/stop-task',
      ]) {
        expect(
          (
            await app().request(path, {
              method: 'POST',
              body: '{"pinned":true}',
              headers: { 'content-type': 'application/json' },
            })
          ).status,
        ).toBe(403);
      }
      expect(query).not.toHaveBeenCalled();
      expect(pin).not.toHaveBeenCalled();
      expect(reconcileOrg).not.toHaveBeenCalled();
      expect(scheduleDestroy).not.toHaveBeenCalled();
      expect(sessionCancelExec).not.toHaveBeenCalled();
    },
  );

  it.each(['owner', 'admin'])(
    'lets %s pin a workspace of the caller organization [SBX-R2]',
    async (role) => {
      caller.role = role;
      pin.mockResolvedValueOnce(true);
      const response = await app().request('/sessions/pa-1/pin?orgId=x', {
        method: 'POST',
        body: '{"pinned":true}',
        headers: { 'content-type': 'application/json' },
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ pinned: true });
      expect(pin).toHaveBeenCalledExactlyOnceWith(query, {
        organizationId: 'member-org',
        sessionId: 'pa-1',
        pinned: true,
      });
    },
  );

  it('stops every running operation of a workspace the caller organization holds [SBX-R2]', async () => {
    query.mockResolvedValueOnce([{ id: 'row-1' }] as never);
    vi.mocked(listRunningOpsBySession).mockResolvedValueOnce([
      { execId: 'exec-1' },
      { execId: 'exec-2' },
    ] as never);
    const response = await app().request('/sessions/pa-1/stop-task?orgId=x', {
      method: 'POST',
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ cancelled: 2 });
    // The workspace is looked up in the caller's organization first.
    expect(query.mock.calls[0]?.slice(1)).toEqual(['pa-1', 'member-org']);
    expect(vi.mocked(sessionCancelExec).mock.calls).toEqual([
      ['pa-1', 'exec-1'],
      ['pa-1', 'exec-2'],
    ]);
  });

  it('stops nothing in a workspace the caller organization does not hold [SBX-R3]', async () => {
    query.mockResolvedValueOnce([] as never);
    const response = await app().request('/sessions/theirs/stop-task', {
      method: 'POST',
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'SESSION_NOT_FOUND' });
    expect(listRunningOpsBySession).not.toHaveBeenCalled();
    expect(sessionCancelExec).not.toHaveBeenCalled();
  });

  it('queues a Destroy for the caller organization and answers before it runs [SBX-R2] [SBX-R3] [SBX-R11]', async () => {
    // The teardown waits for the session's lifecycle lock and the spawner's
    // delete; the request only queues it, so nobody watches a dialog spin.
    scheduleDestroy.mockResolvedValue(true);
    const response = await app().request('/sessions/pa-1/destroy?orgId=x', {
      method: 'POST',
    });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ scheduled: true });
    expect(scheduleDestroy).toHaveBeenCalledWith(query, {
      organizationId: 'member-org',
      sessionId: 'pa-1',
    });
  });

  it('answers 404 for a session the organization holds no live row of [SBX-R3]', async () => {
    scheduleDestroy.mockResolvedValue(false);
    const response = await app().request('/sessions/gone/destroy', {
      method: 'POST',
    });
    expect(response.status).toBe(404);
  });

  it('says on each row whether a Destroy is under way or failed [SBX-R11]', async () => {
    const rows = [
      { sessionId: 'a', ownerType: 'workflow_run', status: 'active' },
      { sessionId: 'b', ownerType: 'workflow_run', status: 'active' },
      { sessionId: 'c', ownerType: 'workflow_run', status: 'active' },
    ];
    listViews.mockResolvedValue(rows);
    destroyStates.mockResolvedValue(
      new Map([
        ['a', 'pending'],
        ['b', 'failed'],
      ]),
    );
    const response = await app().request('/sessions/view');
    expect(destroyStates).toHaveBeenCalledWith(query, 'member-org', [
      'a',
      'b',
      'c',
    ]);
    const body = (await response.json()) as {
      sessions: Array<{ sessionId: string; destroyState: string | null }>;
    };
    expect(
      body.sessions.map(({ sessionId, destroyState }) => [
        sessionId,
        destroyState,
      ]),
    ).toEqual([
      ['a', 'pending'],
      ['b', 'failed'],
      ['c', null],
    ]);
  });

  it('runs the mount-time reconcile as the org-scoped sweep pass, never its own walk over every live row', async () => {
    // The regression: the route used to list EVERY live session (hibernated
    // `stopped` rows included) and settle each spawner 404 as destroyed, so
    // opening the page emptied it of idle project workspaces. It now
    // delegates to the sweep's compute-holding-only pass.
    reconcileOrg.mockResolvedValue({ healed: 1 });
    const response = await app().request('/reconcile', { method: 'POST' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ healed: 1 });
    expect(reconcileOrg).toHaveBeenCalledTimes(1);
    expect(reconcileOrg).toHaveBeenCalledWith(query, 'member-org');
  });

  it('returns authoritative policy limits alongside occupied quota slots [SBX-R8]', async () => {
    const response = await app().request('/quota-usage');
    expect(await response.json()).toEqual({
      usage: [
        { budget: 'project', used: 2, cap: 2, atLimit: true, nearLimit: true },
        {
          budget: 'workflow',
          used: 0,
          cap: 4,
          atLimit: false,
          nearLimit: false,
        },
        { budget: 'render', used: 0, cap: 6, atLimit: false, nearLimit: false },
      ],
    });
  });

  it('reports unavailable observations explicitly and avoids contacting an unconfigured spawner', async () => {
    vi.stubEnv('SANDBOX_TOKEN', '');
    expect(await (await app().request('/capacity')).json()).toEqual({
      status: 'unavailable',
      reason: 'not_configured',
    });
    expect(capacity).not.toHaveBeenCalled();
    vi.stubEnv('SANDBOX_TOKEN', 'test-only');
    capacity.mockRejectedValue(new Error('observation failed'));
    expect(await (await app().request('/capacity')).json()).toEqual({
      status: 'unavailable',
      reason: 'unreachable',
    });
  });

  it('reads the configured ceiling even when runtime observations fail', async () => {
    capacity.mockRejectedValue(new Error('metrics unavailable'));
    expect(await (await app().request('/limits')).json()).toEqual({
      status: 'available',
      maxSessions: 16,
    });
    expect(capacity).not.toHaveBeenCalled();
    expect(await (await app().request('/capacity')).json()).toEqual({
      status: 'unavailable',
      reason: 'unreachable',
    });
    expect(await (await app().request('/limits')).json()).toEqual({
      status: 'available',
      maxSessions: 16,
    });
    expect(deploymentLimits).toHaveBeenCalledTimes(2);
  });

  it('distinguishes unconfigured and unreachable deployment limits without guessing a cap', async () => {
    vi.stubEnv('SANDBOX_TOKEN', '  ');
    const unconfigured = await app().request('/limits');
    expect(unconfigured.headers.get('cache-control')).toBe('no-store');
    expect(await unconfigured.json()).toEqual({
      status: 'unavailable',
      reason: 'not_configured',
    });
    expect(deploymentLimits).not.toHaveBeenCalled();
    vi.stubEnv('SANDBOX_TOKEN', 'test-only');
    deploymentLimits.mockRejectedValue(new Error('spawner unreachable'));
    const unreachable = await app().request('/limits');
    expect(unreachable.headers.get('cache-control')).toBe('no-store');
    expect(await unreachable.json()).toEqual({
      status: 'unavailable',
      reason: 'unreachable',
    });
  });
});

describe('agent-node op honours the run project read rule [SBX-R4]', () => {
  const op = { execId: 'exec-1', status: 'running', progressText: 'working…' };
  beforeEach(() => {
    caller.role = 'member';
    agentNodeOp.mockResolvedValue(op);
    getRun.mockImplementation(
      async (_sql: unknown, _org: string, runId: string) =>
        runId === 'r-hidden'
          ? { id: 'r-hidden', projectId: 'p-hidden' }
          : runId === 'r-visible'
            ? { id: 'r-visible', projectId: 'p-visible' }
            : runId === 'r-org'
              ? { id: 'r-org', projectId: null }
              : null,
    );
  });

  it('answers the op for an organization run', async () => {
    const res = await app().request('/agent-node-op?runId=r-org');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ op });
    expect(agentNodeOp).toHaveBeenCalledWith(query, {
      organizationId: 'member-org',
      runId: 'r-org',
    });
  });

  it('answers the op for a project run the member can read', async () => {
    const res = await app().request(
      '/agent-node-op?runId=r-visible&nodeId=draft_report',
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ op });
    expect(agentNodeOp).toHaveBeenCalledTimes(1);
    expect(agentNodeOp).toHaveBeenCalledWith(query, {
      organizationId: 'member-org',
      runId: 'r-visible',
      nodeId: 'draft_report',
    });
  });

  it('hides the op of a run whose project the member cannot read', async () => {
    const res = await app().request(
      '/agent-node-op?runId=r-hidden&nodeId=draft_report',
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ op: null });
    // The transcript read never runs for a hidden run.
    expect(agentNodeOp).not.toHaveBeenCalled();
  });

  it('answers null for an unknown run without reading a project', async () => {
    const res = await app().request('/agent-node-op?runId=nope');
    expect(await res.json()).toEqual({ op: null });
    expect(canReadRun).not.toHaveBeenCalled();
    expect(agentNodeOp).not.toHaveBeenCalled();
  });
});

describe('external-turn metrics', () => {
  it('reads every outcome the same way in the summary and the per-harness rows', async () => {
    const op = (
      outcome: string | null,
      status: string,
      harness: string | null,
    ) => ({
      outcome,
      status,
      harness,
      durationMs: 1000,
      spentCents: 1,
      recovered: false,
    });
    query.mockResolvedValueOnce([
      op('completed', 'completed', 'claude-code'),
      op('error', 'failed', 'claude-code'),
      op('max-turns', 'completed', 'claude-code'),
      op('timeout', 'failed', 'claude-code'),
      op('cancelled', 'cancelled', 'claude-code'),
      op('awaiting_human', 'completed', 'claude-code'),
      op(null, 'failed', null),
    ] as never);

    const response = await app().request('/external-turn-metrics?periodDays=7');
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      total: number;
      completed: number;
      failed: number;
      cancelled: number;
      timeout: number;
      successRate: number | null;
      timeoutRate: number | null;
      byHarness: Array<{
        harness: string;
        total: number;
        completed: number;
        failed: number;
        timeout: number;
        successRate: number | null;
      }>;
    };
    // The parked turn is in neither fold; error and max-turns are failures
    // in both; the harness-less op is named 'unknown', not dropped.
    expect(body).toMatchObject({
      total: 6,
      completed: 1,
      failed: 3,
      cancelled: 1,
      timeout: 1,
    });
    expect(body.successRate).toBeCloseTo(1 / 5);
    expect(body.timeoutRate).toBeCloseTo(1 / 5);
    const claude = body.byHarness.find((row) => row.harness === 'claude-code');
    const unknown = body.byHarness.find((row) => row.harness === 'unknown');
    expect(claude).toMatchObject({
      total: 5,
      completed: 1,
      failed: 2,
      timeout: 1,
    });
    expect(claude?.successRate).toBeCloseTo(1 / 4);
    expect(unknown).toMatchObject({ total: 1, completed: 0, failed: 1 });
    const rows = body.byHarness;
    expect(rows.reduce((sum, row) => sum + row.total, 0)).toBe(body.total);
    expect(rows.reduce((sum, row) => sum + row.completed, 0)).toBe(
      body.completed,
    );
    expect(rows.reduce((sum, row) => sum + row.failed, 0)).toBe(body.failed);
    expect(rows.reduce((sum, row) => sum + row.timeout, 0)).toBe(body.timeout);
  });

  // Each start of an automation step that waits for sandbox room settles
  // an op; hundreds an hour crowded every real turn out of a page of the
  // newest 5000, and the cap read off the folded total said nothing.
  it.each(['/external-turn-metrics?periodDays=7', '/harness-health'])(
    'leaves turns that are no outcome out in SQL, before any cap (%s)',
    async (path) => {
      query.mockResolvedValueOnce([] as never);

      const response = await app().request(path);

      expect(response.status).toBe(200);
      const [strings, ...values] = query.mock.calls[0] as unknown as [
        TemplateStringsArray,
        ...unknown[],
      ];
      const text = strings.join('?').replace(/\s+/g, ' ');
      expect(text).toContain(
        'AND (o.agent_result_status IS NULL OR o.agent_result_status <> ALL(?))',
      );
      expect(values).toContainEqual(['awaiting_human', 'awaiting_room']);
    },
  );

  it('reports the cap the read hit, whatever the fold skipped', async () => {
    query.mockResolvedValueOnce([
      ...Array.from({ length: 4999 }, () => ({
        outcome: 'completed',
        status: 'completed',
        harness: 'claude-code',
        durationMs: 1000,
        spentCents: 1,
        recovered: false,
      })),
      {
        outcome: 'awaiting_human',
        status: 'completed',
        harness: 'claude-code',
        durationMs: 1000,
        spentCents: 1,
        recovered: false,
      },
    ] as never);

    const response = await app().request('/external-turn-metrics?periodDays=7');

    expect(await response.json()).toMatchObject({
      capped: true,
      total: 4999,
    });
  });

  // A project agent's session is standing: created once, resumed for every
  // turn, across the agent's harness switches. Its `agent_kind` names the
  // harness it was created with, so a read keyed on it counted a pi turn as
  // claude-code and every turn of an unstamped session as `unknown`.
  it.each(['/external-turn-metrics?periodDays=7', '/harness-health'])(
    'names a turn by the harness its op records, ahead of the session stamp (%s)',
    async (path) => {
      query.mockResolvedValueOnce([] as never);

      const response = await app().request(path);

      expect(response.status).toBe(200);
      const [strings] = query.mock.calls[0] as unknown as [
        TemplateStringsArray,
      ];
      const text = strings.join('?').replace(/\s+/g, ' ');
      expect(text).toContain('coalesce(o.harness, s.agent_kind) AS harness');
      expect(text).not.toContain('s.agent_kind AS harness');
    },
  );
});
