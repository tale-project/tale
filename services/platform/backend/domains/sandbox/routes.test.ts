// @vitest-environment node

import type { Context } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrgEnv } from '../../auth/org.ts';

const {
  caller,
  capacity,
  policy,
  listViews,
  listSessions,
  pin,
  reconcile,
  teardown,
} = vi.hoisted(() => ({
  caller: { role: 'admin' },
  capacity: vi.fn(),
  policy: vi.fn(),
  listViews: vi.fn(),
  listSessions: vi.fn(),
  pin: vi.fn(),
  reconcile: vi.fn(),
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
  sessionCancelExec: vi.fn(),
}));
vi.mock('../../lib/org-config.ts', () => ({
  readGovernancePolicyForOrg: policy,
}));
vi.mock('./service.ts', () => ({
  pinSession: pin,
  reconcileSession: reconcile,
  teardownSession: teardown,
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
        '/quota-usage',
        '/sessions',
        '/sessions/view',
      ]) {
        expect((await app().request(path)).status).toBe(403);
      }
      expect(capacity).not.toHaveBeenCalled();
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
    expect(reconcile).not.toHaveBeenCalled();
    expect(teardown).not.toHaveBeenCalled();
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
});
