// @vitest-environment node

import type { Context } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrgEnv } from '../../auth/org.ts';

const { caller, capacity, readLeases } = vi.hoisted(() => ({
  caller: { role: 'admin' },
  capacity: vi.fn(),
  readLeases: vi.fn(),
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
vi.mock(
  '../../core/node_only/sandbox/helpers/session_client.ts',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('../../core/node_only/sandbox/helpers/session_client.ts')
    >()),
    sandboxCapacity: capacity,
  }),
);
vi.mock('./heavy-leases.ts', () => ({ readActiveHeavyLeases: readLeases }));

import { createSandboxRoutes } from './routes.ts';

const app = () =>
  createSandboxRoutes({ sql: vi.fn() as never, auth: {} as never });

const READBACK = {
  status: 'available',
  observedAt: 1_000,
  leases: [
    {
      leaseId: 'lease-1',
      sessionId: 'pa-ada-1',
      label: 'npm ci',
      predictedGrowthBytes: 2 * 1024 ** 3,
      memoryBytes: 1024 ** 3,
      acquiredAt: 500,
      expiresAt: 1_800_500,
      run: {
        runId: 'run-1',
        taskId: 'task-1',
        agentId: 'agent-1',
        agentName: 'Builder',
        projectId: 'project-1',
      },
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('SANDBOX_TOKEN', 'route-test-only');
  caller.role = 'admin';
  readLeases.mockResolvedValue(READBACK);
  capacity.mockResolvedValue({
    status: 'available',
    observedAt: 1_000,
    backend: 'docker',
    scope: 'host',
    sessions: {
      running: 3,
      starting: 0,
      limit: 16,
      organizationRunning: 1,
      organizationStarting: 0,
      organizationLimit: 16,
    },
    resources: {
      cpu: { totalCores: 4, usedCores: 1 },
      memory: { totalBytes: 16, usedBytes: 8 },
    },
    runtimeSessions: [{ sessionId: 'pa-ada-1', state: 'running' }],
    leases: { active: 1, max: 2 },
  });
});

describe('the heavy-phase lease readback', () => {
  it.each(['owner', 'admin'])(
    'lists the leases of the signed-in organization to an %s [SBX-R33]',
    async (role) => {
      caller.role = role;
      const response = await app().request('/leases?orgId=other-org');
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      await expect(response.json()).resolves.toEqual(READBACK);
      // The organization is the session's, never the request's.
      expect(readLeases).toHaveBeenCalledWith(expect.anything(), 'member-org');
    },
  );

  it.each(['developer', 'editor', 'member'])(
    'refuses a %s, since it names runs and sandboxes [SBX-R33]',
    async (role) => {
      caller.role = role;
      expect((await app().request('/leases')).status).toBe(403);
      expect(readLeases).not.toHaveBeenCalled();
    },
  );

  it('says so when no sandbox service is configured', async () => {
    vi.stubEnv('SANDBOX_TOKEN', '');
    const response = await app().request('/leases');
    await expect(response.json()).resolves.toEqual({
      status: 'unavailable',
      reason: 'not_configured',
    });
    expect(readLeases).not.toHaveBeenCalled();
  });

  it('gives a developer the host’s count of leases with the capacity, no more [SBX-R33]', async () => {
    caller.role = 'developer';
    const response = await app().request('/capacity');
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.leases).toEqual({ active: 1, max: 2 });
    expect(body.runtimeSessions).toEqual([]);
  });
});
