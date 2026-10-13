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
const consent = vi.hoisted(() => ({ readAgentConsentContext: vi.fn() }));
/** The session the mocked sign-in answers with, and the organization gate
 * the route asks of it. */
const session = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
  orgGateRuns: 0,
}));

vi.mock('./service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./service.ts')>()),
  ...service,
}));
vi.mock('./consent-context.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./consent-context.ts')>()),
  ...consent,
}));
vi.mock('../../auth/auth.ts', () => ({
  loadTrustedProxies: () => Promise.resolve([]),
}));
vi.mock('../../auth/session.ts', () => ({
  requireSession:
    () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
      c.set('sessionBundle', {
        user: { id: 'ada', email: 'ada@example.test', name: 'Ada' },
        session: session.current,
      } as never);
      await next();
    },
}));
vi.mock('../../auth/org.ts', () => ({
  requireOrgMember:
    () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
      session.orgGateRuns += 1;
      c.set('orgId', 'org-1');
      c.set('orgMember', { role: 'developer' } as never);
      await next();
    },
}));

import { ConsentContextError } from './consent-context.ts';
import { createAgentConnectionRoutes } from './routes.ts';
import { AgentConnectionError } from './service.ts';

function app() {
  return createAgentConnectionRoutes({ sql: {} as never, auth: {} as never });
}

beforeEach(() => {
  vi.clearAllMocks();
  session.current = { id: 'session-1', activeOrganizationId: 'org-1' };
  session.orgGateRuns = 0;
  consent.readAgentConsentContext.mockResolvedValue({ organizations: [] });
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

describe('GET /api/app/agent-connections/consent-context', () => {
  const ASKED = 'tale:mcp tale:automations.write offline_access';
  const ask = (query: string) => app().request(`/consent-context?${query}`);

  it('tells the consent page where the signed-in person may connect the app, for no organization in particular [AGCONN-R21]', async () => {
    consent.readAgentConsentContext.mockResolvedValue({
      organizations: [{ id: 'org-1' }],
    });
    const res = await ask(
      `client_id=${encodeURIComponent('https://claude.ai/c.json')}&scope=${encodeURIComponent(ASKED)}`,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ organizations: [{ id: 'org-1' }] });
    expect(consent.readAgentConsentContext.mock.calls[0]?.[1]).toEqual({
      userId: 'ada',
      activeOrganizationId: 'org-1',
      clientId: 'https://claude.ai/c.json',
      scope: ASKED,
    });
    expect(session.orgGateRuns).toBe(0);
  });

  it('passes a session with no active organization on as none, and a request with no scope as none', async () => {
    session.current = { id: 'session-1' };
    await ask('client_id=abc');
    expect(consent.readAgentConsentContext.mock.calls[0]?.[1]).toEqual({
      userId: 'ada',
      activeOrganizationId: null,
      clientId: 'abc',
      scope: undefined,
    });
  });

  it('refuses a query without an app, or with one too long to be an id, asking the database nothing', async () => {
    for (const query of [
      '',
      'client_id=',
      `client_id=${'a'.repeat(2049)}`,
      `client_id=abc&scope=${'s'.repeat(2049)}`,
    ]) {
      const res = await ask(query);
      expect(res.status, query).toBe(400);
      expect(await res.json(), query).toMatchObject({ code: 'INVALID_QUERY' });
    }
    expect(consent.readAgentConsentContext).not.toHaveBeenCalled();
  });

  it('answers an unknown app 404 and a request that asks for no agent access 400, each with its code', async () => {
    consent.readAgentConsentContext.mockRejectedValueOnce(
      new ConsentContextError('CLIENT_NOT_FOUND'),
    );
    const unknown = await ask('client_id=nobody&scope=tale:mcp');
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({
      error: 'This app is not known to Tale.',
      code: 'CLIENT_NOT_FOUND',
    });
    consent.readAgentConsentContext.mockRejectedValueOnce(
      new ConsentContextError('NOT_AN_AGENT_REQUEST'),
    );
    const sso = await ask('client_id=abc&scope=openid');
    expect(sso.status).toBe(400);
    expect(await sso.json()).toMatchObject({ code: 'NOT_AN_AGENT_REQUEST' });
  });

  it('refuses a session that belongs to one organization — it may not connect an agent anywhere — and reads nothing', async () => {
    session.current = { id: 'session-1', trustedOrganizationId: 'org-1' };
    const res = await ask(`client_id=abc&scope=tale:mcp`);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'ORG_FORBIDDEN' });
    expect(consent.readAgentConsentContext).not.toHaveBeenCalled();
  });

  it('lets a fault that is no refusal through to the app’s error handler', async () => {
    consent.readAgentConsentContext.mockRejectedValueOnce(
      new Error('database down'),
    );
    expect((await ask('client_id=abc&scope=tale:mcp')).status).toBe(500);
  });

  it('is the only route that does not ask for an organization', async () => {
    await app().request('/');
    expect(session.orgGateRuns).toBe(1);
  });
});
