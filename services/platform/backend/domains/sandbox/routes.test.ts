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
  listSessions,
  pin,
  reconcileOrg,
  teardown,
} = vi.hoisted(() => ({
  caller: { role: 'admin' },
  capacity: vi.fn(),
  deploymentLimits: vi.fn(),
  policy: vi.fn(),
  listViews: vi.fn(),
  listSessions: vi.fn(),
  pin: vi.fn(),
  reconcileOrg: vi.fn(),
  teardown: vi.fn(),
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
  teardownSession: teardown,
}));
vi.mock('./watchdogs.ts', () => ({
  reconcileOrgSessions: reconcileOrg,
}));
vi.mock('./sessions.ts', () => ({
  listSandboxViewsForOrg: listViews,
  listSessionsForOrg: listSessions,
  listRunningOpsBySession: vi.fn(),
  getAgentNodeSandboxOp: vi.fn(),
}));

import { createSandboxRoutes } from './routes.ts';

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
  });
  policy.mockResolvedValue({
    maxSessionsPerOrg: 2,
    maxWorkflowSessionsPerOrg: 4,
    maxRenderSessionsPerOrg: 6,
  });
  listViews.mockResolvedValue([]);
  listSessions.mockResolvedValue([]);
});
afterEach(() => vi.unstubAllEnvs());

describe('sandbox settings read and write authority', () => {
  it.each(['owner', 'admin', 'developer'])(
    'allows %s to inspect the authenticated organization',
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
      for (const path of ['/sessions', '/sessions/view']) {
        expect((await app().request(path)).status).toBe(
          role === 'developer' ? 403 : 200,
        );
      }
      if (role === 'developer') {
        expect(listViews).not.toHaveBeenCalled();
        expect(listSessions).not.toHaveBeenCalled();
        expect(await response.json()).toEqual({
          status: 'available',
          observedAt: 1000,
          runtimeSessions: [],
        });
      } else {
        expect(listViews).toHaveBeenCalledWith(query, 'member-org');
        expect(await response.json()).toMatchObject({
          runtimeSessions: [{ sessionId: 'private-project-session' }],
        });
      }
      expect(policy).toHaveBeenCalledWith(query, 'member-org', 'sandbox_quota');
    },
  );

  it.each(['editor', 'viewer'])(
    'withholds infrastructure reads from %s',
    async (role) => {
      caller.role = role;
      for (const path of [
        '/capacity',
        '/limits',
        '/quota-usage',
        '/sessions',
        '/sessions/view',
      ]) {
        expect((await app().request(path)).status).toBe(403);
      }
      expect(capacity).not.toHaveBeenCalled();
      expect(deploymentLimits).not.toHaveBeenCalled();
      expect(query).not.toHaveBeenCalled();
    },
  );

  it('keeps developers read-only for every sandbox mutation', async () => {
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
    expect(teardown).not.toHaveBeenCalled();
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
    expect(listSessions).not.toHaveBeenCalled();
  });

  it('returns authoritative policy limits alongside occupied quota slots', async () => {
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
