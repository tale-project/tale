// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ backendFetch: vi.fn() }));

vi.mock('./api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api-client')>()),
  backendFetch: h.backendFetch,
}));

import { agentConsentContextQuery } from './agent-connections';
import { BackendApiError } from './api-client';

const ANSWER = {
  client: {
    id: 'https://claude.ai/oauth/c.json',
    name: 'Claude Code',
    provenance: 'metadata_document',
    host: 'claude.ai',
  },
  requestedScopes: ['tale:mcp', 'offline_access'],
  eligible: true,
  activeOrganizationId: 'org-1',
  organizations: [
    {
      id: 'org-1',
      slug: 'acme',
      name: 'Acme',
      role: 'developer',
      allowed: true,
      ceiling: ['tale:mcp'],
      previous: null,
    },
    {
      id: 'org-2',
      slug: 'beta',
      name: 'Beta',
      role: 'member',
      allowed: false,
      reason: 'AGENT_CONNECT_FORBIDDEN',
      ceiling: [],
      previous: ['tale:mcp'],
    },
  ],
};

const run = (args = { clientId: 'c', scope: 'tale:mcp' }) => {
  const options = agentConsentContextQuery(args);
  const signal = new AbortController().signal;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the one field the query function reads
  return (
    options.queryFn as (context: { signal: AbortSignal }) => Promise<unknown>
  )({
    signal,
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  h.backendFetch.mockResolvedValue(ANSWER);
});

describe('the consent context the page reads [AGCONN-R21]', () => {
  it('asks for the app and the access it asked, encoded, for no organization in particular', async () => {
    await run({
      clientId: 'https://claude.ai/oauth/c.json?x=1&y=2',
      scope: 'tale:mcp tale:automations.write',
    });
    const [route, options] = h.backendFetch.mock.calls[0] ?? [];
    expect(route).toBe(
      '/agent-connections/consent-context?client_id=https%3A%2F%2Fclaude.ai%2Foauth%2Fc.json%3Fx%3D1%26y%3D2&scope=tale%3Amcp+tale%3Aautomations.write',
    );
    expect(options).toMatchObject({ signal: expect.any(AbortSignal) });
    expect(options).not.toHaveProperty('orgId');
  });

  it('answers what the server said, as far as the page reads it', async () => {
    await expect(run()).resolves.toEqual(ANSWER);
  });

  it('refuses an answer that is not what the page reads, rather than offer from it', async () => {
    for (const broken of [
      { ...ANSWER, eligible: 'yes' },
      { ...ANSWER, client: { ...ANSWER.client, provenance: 'trusted' } },
      {
        ...ANSWER,
        organizations: [{ ...ANSWER.organizations[0], allowed: 'sure' }],
      },
      {
        ...ANSWER,
        organizations: [{ ...ANSWER.organizations[1], reason: 'WHATEVER' }],
      },
      { client: ANSWER.client },
      null,
    ]) {
      h.backendFetch.mockResolvedValueOnce(broken);
      await expect(run()).rejects.toThrow();
    }
  });

  it('keys the answer for the account, by app and access, and never keeps it', () => {
    const one = agentConsentContextQuery({ clientId: 'a', scope: 's' });
    const other = agentConsentContextQuery({ clientId: 'b', scope: 's' });
    expect(one.queryKey).toEqual([
      'backend',
      'me',
      'agent-connections',
      'consent-context',
      'a',
      's',
    ]);
    expect(other.queryKey).not.toEqual(one.queryKey);
    expect(one.staleTime).toBe(0);
    expect(one.gcTime).toBe(0);
  });

  it('retries the server or the network failing, never a refusal', () => {
    const retry = agentConsentContextQuery({ clientId: 'a', scope: 's' }).retry;
    if (typeof retry !== 'function')
      throw new Error('a retry rule is expected');
    expect(retry(0, new BackendApiError(403, 'no', 'ORG_FORBIDDEN'))).toBe(
      false,
    );
    expect(retry(0, new BackendApiError(404, 'no', 'CLIENT_NOT_FOUND'))).toBe(
      false,
    );
    expect(retry(0, new BackendApiError(503, 'down'))).toBe(true);
    expect(retry(1, new TypeError('Failed to fetch'))).toBe(true);
    expect(retry(2, new BackendApiError(503, 'down'))).toBe(false);
  });
});
