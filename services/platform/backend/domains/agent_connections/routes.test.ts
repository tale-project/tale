// @vitest-environment node

/**
 * /api/app/agent-connections at the boundary: what a listing is asked for,
 * the refusal envelope a domain error answers in, and who the service is
 * told is acting.
 */

import type { Context } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrgEnv } from '../../auth/org.ts';

const service = vi.hoisted(() => ({
  listAgentConnections: vi.fn(),
  disconnectAgent: vi.fn(),
}));

vi.mock('./service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./service.ts')>()),
  ...service,
}));
vi.mock('../../auth/auth.ts', () => ({
  loadTrustedProxies: () => Promise.resolve([]),
}));
vi.mock('../../auth/session.ts', () => ({
  requireSession:
    () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
      c.set('sessionBundle', {
        user: { id: 'ada', email: 'ada@example.test', name: 'Ada' },
      } as never);
      await next();
    },
}));
vi.mock('../../auth/org.ts', () => ({
  requireOrgMember:
    () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
      c.set('orgId', 'org-1');
      c.set('orgMember', { role: 'developer' } as never);
      await next();
    },
}));

import { createAgentConnectionRoutes } from './routes.ts';
import { AgentConnectionError } from './service.ts';

function app() {
  return createAgentConnectionRoutes({ sql: {} as never, auth: {} as never });
}

beforeEach(() => {
  vi.clearAllMocks();
  service.listAgentConnections.mockResolvedValue({
    connections: [],
    canSeeEveryone: false,
  });
});

describe('GET /api/app/agent-connections', () => {
  it('lists the caller’s own connections by default, as the person they are here', async () => {
    const res = await app().request('/');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      connections: [],
      canSeeEveryone: false,
    });
    expect(service.listAgentConnections.mock.calls[0]?.[1]).toEqual({
      organizationId: 'org-1',
      viewerId: 'ada',
      viewerRole: 'developer',
      everyone: false,
      includeEnded: false,
    });
  });

  it('passes on what the caller asks for: everyone’s, the ended ones, and only what changed since a moment [AGCONN-R1]', async () => {
    await app().request('/?scope=everyone&ended=true&since=1791000000000');
    expect(service.listAgentConnections.mock.calls[0]?.[1]).toEqual({
      organizationId: 'org-1',
      viewerId: 'ada',
      viewerRole: 'developer',
      everyone: true,
      includeEnded: true,
      since: 1_791_000_000_000,
    });
  });

  it('refuses a query it does not understand, asking the database nothing', async () => {
    for (const query of [
      '?scope=all',
      '?ended=yes',
      '?since=soon',
      '?since=-1',
      '?since=1.5',
    ]) {
      const res = await app().request(`/${query}`);
      expect(res.status, query).toBe(400);
      expect(await res.json()).toMatchObject({ code: 'INVALID_QUERY' });
    }
    expect(service.listAgentConnections).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/app/agent-connections/:id', () => {
  it('ends the connection as the signed-in person, whose address and browser the trail keeps [AGCONN-R2]', async () => {
    service.disconnectAgent.mockResolvedValue({ id: 'conn-1' });
    const res = await app().request('/conn-1', {
      method: 'DELETE',
      headers: { 'user-agent': 'probe' },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 'conn-1', ok: true });
    expect(service.disconnectAgent.mock.calls[0]?.[1]).toEqual({
      organizationId: 'org-1',
      connectionId: 'conn-1',
      viewer: {
        userId: 'ada',
        role: 'developer',
        email: 'ada@example.test',
        userAgent: 'probe',
      },
    });
  });

  it('answers a connection that is not the caller’s to end with its code and 404', async () => {
    service.disconnectAgent.mockRejectedValueOnce(
      new AgentConnectionError(
        'AGENT_CONNECTION_NOT_FOUND',
        'Agent connection not found.',
        404,
      ),
    );
    const res = await app().request('/conn-9', { method: 'DELETE' });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: 'AGENT_CONNECTION_NOT_FOUND',
      message: 'Agent connection not found.',
    });
  });

  it('lets a fault that is no refusal through to the app’s error handler', async () => {
    service.disconnectAgent.mockRejectedValueOnce(new Error('database down'));
    const res = await app().request('/conn-1', { method: 'DELETE' });
    expect(res.status).toBe(500);
  });
});
