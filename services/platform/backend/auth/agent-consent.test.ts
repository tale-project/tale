// @vitest-environment node

/**
 * A person connecting a coding agent at the consent step: the organization
 * they choose, who may connect an agent there and with which access, and the
 * connection recorded before the code is handed over.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { connectAgent } from '../domains/agent_connections/service.ts';
import { evaluateTwoFactorEnforcement } from '../domains/two_factor/service.ts';
import {
  AGENT_UNBOUND_REFERENCE_PREFIX,
  type AgentConsentSession,
  agentConsentGate,
  agentConsentReferenceId,
} from './agent-consent.ts';
import { mayConnectAgentIn } from './api-key-create-gate.ts';
import { findOrganizationMember } from './membership.ts';

vi.mock('./membership.ts', () => ({
  findOrganizationMember: vi.fn(),
}));
vi.mock('./api-key-create-gate.ts', () => ({
  mayConnectAgentIn: vi.fn(),
}));
vi.mock('../domains/two_factor/service.ts', () => ({
  evaluateTwoFactorEnforcement: vi.fn(),
}));
vi.mock('../domains/agent_connections/service.ts', () => ({
  connectAgent: vi.fn(),
  agentConnectionActor: vi.fn(async (viewer: { userId: string }) => ({
    actorId: viewer.userId,
    actorType: 'user',
  })),
}));

const NOW = 1_800_000_000_000;
const CLIENT = 'https://claude.example.test/client.json';
const ORG = 'org-acme';

/** The query the provider signed for an agent's request. */
const agentQuery = (scope = 'tale:mcp tale:automations.write offline_access') =>
  new URLSearchParams({
    client_id: CLIENT,
    redirect_uri: 'http://127.0.0.1:33418/callback',
    response_type: 'code',
    scope,
    state: 's',
    resource: 'https://tale.example.com/api/v1/mcp',
    sig: 'x',
  }).toString();

const ada: AgentConsentSession = {
  user: { id: 'user-ada', email: 'ada@example.test', emailVerified: true },
  session: { createdAt: new Date(NOW - 3_600_000) },
};

/** A session from before the last day. */
const staleAda: AgentConsentSession = {
  ...ada,
  session: { createdAt: new Date(NOW - 2 * 86_400_000) },
};

function consent(body: unknown, init: RequestInit = {}) {
  return new Request('https://tale.example.com/api/auth/oauth2/consent', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: 'session=1' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    ...init,
  });
}

const choose = (extra: Record<string, unknown> = {}) => ({
  accept: true,
  scope: 'tale:mcp tale:automations.write offline_access',
  oauth_query: agentQuery(),
  tale: { organizationId: ORG },
  ...extra,
});

const redirectTo = (url: string) => Response.json({ redirect: true, url });

function setup(overrides: { session?: AgentConsentSession | null } = {}) {
  const handle = vi.fn((_request: Request): Promise<Response> =>
    Promise.resolve(
      redirectTo('http://127.0.0.1:33418/callback?code=abc&state=s&iss=x'),
    ),
  );
  const deps = {
    sql: vi.fn(() =>
      Promise.resolve([{ name: 'Claude Code', discovery: 'cimd' }]),
    ) as unknown as Sql,
    session: vi.fn(() =>
      Promise.resolve(
        overrides.session === undefined ? ada : overrides.session,
      ),
    ),
    clientIp: () => Promise.resolve('203.0.113.9'),
    now: () => NOW,
  };
  return { handle, deps };
}

const refusal = async (response: Response) => ({
  status: response.status,
  ...(await response.json()),
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(findOrganizationMember).mockResolvedValue({
    id: 'm1',
    organizationId: ORG,
    userId: 'user-ada',
    role: 'developer',
  });
  vi.mocked(mayConnectAgentIn).mockResolvedValue(true);
  vi.mocked(evaluateTwoFactorEnforcement).mockResolvedValue({
    decision: 'allow',
  } as never);
  vi.mocked(connectAgent).mockResolvedValue({
    connection: {} as never,
    created: true,
    scopesChanged: false,
  });
});

describe('what the provider ties an agent consent to', () => {
  it('has no reference for a request that asks for no agent access, as single sign-on never had one', () => {
    expect(
      agentConsentReferenceId({ scopes: ['openid', 'profile'] }),
    ).toBeUndefined();
  });

  it('ties an agent request to no organization until the person has chosen one', () => {
    const first = agentConsentReferenceId({ scopes: ['tale:mcp'] });
    const second = agentConsentReferenceId({ scopes: ['tale:mcp'] });
    expect(first).toMatch(new RegExp(`^${AGENT_UNBOUND_REFERENCE_PREFIX}`));
    // Each is new, so none is ever found again.
    expect(second).not.toBe(first);
  });
});

describe('requests the gate leaves to the provider', () => {
  it.each([
    [
      'a single sign-on consent',
      { ...choose(), oauth_query: 'scope=openid+email&client_id=a' },
    ],
    ['a refusal of consent', choose({ accept: false })],
    ['a body without the signed query', { accept: true }],
    ['a body that is no object', '[]'],
    ['a body that is not JSON', '{oops'],
  ])(
    'passes %s on as it came, reading nothing of the person',
    async (_what, body) => {
      const { handle, deps } = setup();
      const request = consent(body);
      await agentConsentGate(request, deps, handle);
      expect(handle).toHaveBeenCalledTimes(1);
      expect(handle.mock.calls[0]?.[0]).toBe(request);
      expect(deps.session).not.toHaveBeenCalled();
      expect(connectAgent).not.toHaveBeenCalled();
    },
  );

  it('passes an agent consent from nobody signed in on, for the provider to refuse', async () => {
    const { handle, deps } = setup({ session: null });
    const request = consent(choose());
    await agentConsentGate(request, deps, handle);
    expect(handle.mock.calls[0]?.[0]).toBe(request);
    expect(connectAgent).not.toHaveBeenCalled();
  });
});

describe('connecting an agent to an organization [AGCONN-R7]', () => {
  it('asks the person to choose an organization before anything else, and the provider never sees the request', async () => {
    const { handle, deps } = setup();
    for (const tale of [
      undefined,
      {},
      { organizationId: '' },
      { organizationId: 7 },
    ]) {
      const answer = await agentConsentGate(
        consent(choose({ tale })),
        deps,
        handle,
      );
      expect(await refusal(answer)).toMatchObject({
        status: 400,
        code: 'AGENT_CONSENT_ORG_REQUIRED',
      });
    }
    expect(handle).not.toHaveBeenCalled();
    expect(findOrganizationMember).not.toHaveBeenCalled();
  });

  it('refuses an organization named by something that cannot be an id', async () => {
    const { handle, deps } = setup();
    const answer = await agentConsentGate(
      consent(choose({ tale: { organizationId: 'o'.repeat(129) } })),
      deps,
      handle,
    );
    expect(await refusal(answer)).toMatchObject({
      status: 400,
      code: 'AGENT_CONSENT_ORG_REQUIRED',
    });
    expect(findOrganizationMember).not.toHaveBeenCalled();
  });

  it('refuses an organization the person is not an active member of', async () => {
    const { handle, deps } = setup();
    for (const member of [
      null,
      { id: 'm', organizationId: ORG, userId: 'user-ada', role: 'disabled' },
    ]) {
      vi.mocked(findOrganizationMember).mockResolvedValueOnce(member);
      const answer = await agentConsentGate(consent(choose()), deps, handle);
      expect(await refusal(answer)).toMatchObject({
        status: 403,
        code: 'ORG_FORBIDDEN',
      });
    }
    expect(handle).not.toHaveBeenCalled();
    expect(findOrganizationMember).toHaveBeenCalledWith(
      deps.sql,
      ORG,
      'user-ada',
    );
  });

  it('refuses an account whose address is not verified or whose two-factor enrollment is due', async () => {
    const unverified = setup({
      session: {
        ...ada,
        user: { ...ada.user, emailVerified: false },
      },
    });
    expect(
      await refusal(
        await agentConsentGate(
          consent(choose()),
          unverified.deps,
          unverified.handle,
        ),
      ),
    ).toMatchObject({ status: 403, code: 'IDENTITY_NOT_ELIGIBLE' });
    vi.mocked(evaluateTwoFactorEnforcement).mockResolvedValueOnce({
      decision: 'blocked',
    } as never);
    const blocked = setup();
    expect(
      await refusal(
        await agentConsentGate(consent(choose()), blocked.deps, blocked.handle),
      ),
    ).toMatchObject({ status: 403, code: 'IDENTITY_NOT_ELIGIBLE' });
    expect(unverified.handle).not.toHaveBeenCalled();
    expect(blocked.handle).not.toHaveBeenCalled();
  });

  it('refuses a person who may not connect an agent in this organization, asking about this organization and role', async () => {
    vi.mocked(mayConnectAgentIn).mockResolvedValueOnce(false);
    const { handle, deps } = setup();
    const answer = await agentConsentGate(consent(choose()), deps, handle);
    expect(await refusal(answer)).toMatchObject({
      status: 403,
      code: 'AGENT_CONNECT_FORBIDDEN',
    });
    expect(mayConnectAgentIn).toHaveBeenCalledWith(deps.sql, {
      organizationId: ORG,
      userId: 'user-ada',
      role: 'developer',
    });
    expect(handle).not.toHaveBeenCalled();
  });

  it('refuses access that was never asked for, as the provider does', async () => {
    const { handle, deps } = setup();
    const answer = await agentConsentGate(
      consent(choose({ scope: 'tale:mcp tale:automations.deploy' })),
      deps,
      handle,
    );
    expect(await refusal(answer)).toMatchObject({
      status: 400,
      error: 'invalid_request',
      error_description: 'Scope not originally requested',
    });
    expect(handle).not.toHaveBeenCalled();
  });

  it('always allows reading and testing, so the access without it is refused', async () => {
    const { handle, deps } = setup();
    const answer = await agentConsentGate(
      consent(choose({ scope: 'tale:automations.write' })),
      deps,
      handle,
    );
    expect(await refusal(answer)).toMatchObject({
      status: 400,
      code: 'AGENT_SCOPE_MCP_REQUIRED',
    });
    expect(handle).not.toHaveBeenCalled();
  });

  it('refuses access beyond what the person’s role here allows, naming it [AGCONN-R8]', async () => {
    vi.mocked(findOrganizationMember).mockResolvedValue({
      id: 'm',
      organizationId: ORG,
      userId: 'user-ada',
      role: 'member',
    });
    const { handle, deps } = setup();
    const answer = await agentConsentGate(consent(choose()), deps, handle);
    expect(await refusal(answer)).toMatchObject({
      status: 403,
      code: 'AGENT_SCOPE_NOT_ALLOWED',
      data: { scopes: ['tale:automations.write'] },
    });
    // What a member may read and test, they may allow.
    const read = await agentConsentGate(
      consent(
        choose({
          scope: 'tale:mcp tale:settings.read',
          oauth_query: agentQuery('tale:mcp tale:settings.read'),
        }),
      ),
      deps,
      handle,
    );
    expect(read.status).toBe(200);
  });

  it('asks for a sign-in from the last day before anything beyond reading is allowed, and for nothing more to read [AGCONN-R9]', async () => {
    const stale = setup({ session: staleAda });
    expect(
      await refusal(
        await agentConsentGate(consent(choose()), stale.deps, stale.handle),
      ),
    ).toMatchObject({ status: 403, code: 'SESSION_NOT_FRESH' });
    expect(stale.handle).not.toHaveBeenCalled();
    const reading = await agentConsentGate(
      consent(
        choose({
          scope: 'tale:mcp tale:settings.read',
          oauth_query: agentQuery('tale:mcp tale:settings.read'),
        }),
      ),
      stale.deps,
      stale.handle,
    );
    expect(reading.status).toBe(200);
    const fresh = setup();
    expect(
      (await agentConsentGate(consent(choose()), fresh.deps, fresh.handle))
        .status,
    ).toBe(200);
  });

  it('counts a day to the millisecond: a session a millisecond short of it is fresh, one a day old is not [AGCONN-R9]', async () => {
    const DAY = 86_400_000;
    for (const [age, status] of [
      [DAY - 1, 200],
      [DAY, 403],
      [DAY + 3_600_000, 403],
    ] as const) {
      const { handle, deps } = setup({
        session: { ...ada, session: { createdAt: new Date(NOW - age) } },
      });
      expect(
        (await agentConsentGate(consent(choose()), deps, handle)).status,
        `${age} ms old`,
      ).toBe(status);
    }
  });

  it('asks for a sign-in again when the session does not say when it began', async () => {
    const { handle, deps } = setup({
      session: { ...ada, session: { createdAt: undefined } },
    });
    expect(
      await refusal(await agentConsentGate(consent(choose()), deps, handle)),
    ).toMatchObject({ code: 'SESSION_NOT_FRESH' });
  });
});

describe('making the consent', () => {
  it('lets the provider make it for the organization chosen — without the organization field — and keeps the agent signed in', async () => {
    const seen: Array<{ reference: string | undefined; body: unknown }> = [];
    const { handle, deps } = setup();
    handle.mockImplementation(async (request: Request) => {
      seen.push({
        reference: agentConsentReferenceId({ scopes: ['tale:mcp'] }),
        body: await request.json(),
      });
      return redirectTo('http://127.0.0.1:33418/callback?code=abc&iss=x');
    });
    // The person allowed reading and editing, and did not list the app's
    // request to stay signed in: staying signed in is not their choice.
    const answer = await agentConsentGate(
      consent(choose({ scope: 'tale:mcp tale:automations.write' })),
      deps,
      handle,
    );
    expect(answer.status).toBe(200);
    expect(seen).toEqual([
      {
        reference: ORG,
        body: {
          accept: true,
          scope: 'tale:mcp tale:automations.write offline_access',
          oauth_query: agentQuery(),
        },
      },
    ]);
    // Outside the consent, an agent request is bound to no organization.
    expect(agentConsentReferenceId({ scopes: ['tale:mcp'] })).toMatch(
      new RegExp(`^${AGENT_UNBOUND_REFERENCE_PREFIX}`),
    );
  });

  it('adds no request to stay signed in that the app did not make', async () => {
    const { handle, deps } = setup();
    await agentConsentGate(
      consent(
        choose({
          scope: 'tale:mcp',
          oauth_query: agentQuery('tale:mcp'),
        }),
      ),
      deps,
      handle,
    );
    expect(await handle.mock.calls[0]?.[0].json()).toMatchObject({
      scope: 'tale:mcp',
    });
  });

  it('accepts everything that was asked when the body names no scope, if the role allows it', async () => {
    const { handle, deps } = setup();
    const { scope: _scope, ...withoutScope } = choose();
    const answer = await agentConsentGate(consent(withoutScope), deps, handle);
    expect(answer.status).toBe(200);
    expect(await handle.mock.calls[0]?.[0].json()).toMatchObject({
      scope: 'tale:mcp tale:automations.write offline_access',
    });
  });

  it('records the connection before the code is handed over: the app, where it came from and the access, without the request to stay signed in [AGCONN-R10]', async () => {
    const { handle, deps } = setup();
    const answer = await agentConsentGate(consent(choose()), deps, handle);
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({
      redirect: true,
      url: 'http://127.0.0.1:33418/callback?code=abc&state=s&iss=x',
    });
    expect(connectAgent).toHaveBeenCalledWith(deps.sql, {
      organizationId: ORG,
      userId: 'user-ada',
      clientId: CLIENT,
      clientName: 'Claude Code',
      provenance: 'metadata_document',
      clientHost: 'claude.example.test',
      redirectHost: '127.0.0.1',
      scopes: ['tale:mcp', 'tale:automations.write'],
      actor: { actorId: 'user-ada', actorType: 'user' },
    });
  });

  it('records an app that registered itself as unverified, with no host', async () => {
    const { handle, deps } = setup();
    deps.sql = vi.fn(() =>
      Promise.resolve([{ name: '  Cursor‮ ', discovery: null }]),
    ) as unknown as Sql;
    await agentConsentGate(consent(choose()), deps, handle);
    expect(connectAgent).toHaveBeenCalledWith(
      deps.sql,
      expect.objectContaining({
        clientName: 'Cursor',
        provenance: 'registered',
        clientHost: null,
      }),
    );
  });

  it.each([
    ['an error the provider answers', new Response('no', { status: 400 })],
    [
      'a redirect that carries no code',
      redirectTo('http://127.0.0.1:33418/callback?error=access_denied'),
    ],
    ['an answer that is not JSON', new Response('plain')],
  ])(
    'records nothing for %s, and hands the answer on as it was',
    async (_what, answer) => {
      const { handle, deps } = setup();
      handle.mockResolvedValueOnce(answer);
      const returned = await agentConsentGate(consent(choose()), deps, handle);
      expect(returned).toBe(answer);
      expect(connectAgent).not.toHaveBeenCalled();
    },
  );

  it('never delivers the code when the connection cannot be recorded [AGCONN-R10]', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(connectAgent).mockRejectedValueOnce(new Error('database down'));
    const { handle, deps } = setup();
    const answer = await agentConsentGate(consent(choose()), deps, handle);
    const body = await refusal(answer);
    expect(body).toMatchObject({
      status: 503,
      code: 'AGENT_CONNECTION_UNAVAILABLE',
    });
    // Not the redirect that carried the code.
    expect(JSON.stringify(body)).not.toContain('code=abc');
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
