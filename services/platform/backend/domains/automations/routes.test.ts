// @vitest-environment node

/**
 * Unit locks for two door contracts of /api/app/automations:
 *
 * - `POST /asks/:askId/answer` validates its body like every other body
 *   route in the file — a bad body is the domain's `invalid body` 400, never
 *   a ZodError escaping into the error reporter as a 500.
 * - `GET /:name` reports `deployedUnpinnedAgentNodes` from the DEPLOYED
 *   version only. `deployedVersion` answers undefined (not null) for an
 *   undeployed automation and `versionRow` reads an omitted version as "the
 *   latest", so a null guard populated the deploy-time warning from the
 *   draft of an automation nothing had deployed.
 */

import type { Context } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrgEnv } from '../../auth/org.ts';

const { answerAsk, deployedVersion, versionRow } = vi.hoisted(() => ({
  answerAsk: vi.fn(),
  deployedVersion: vi.fn(),
  versionRow: vi.fn(),
}));

vi.mock('./store.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./store.ts')>();
  return { ...actual, answerAsk, deployedVersion, versionRow };
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

function makeApp() {
  return createAutomationRoutes({ sql: {} as never, auth: {} as never });
}

async function answer(body: unknown): Promise<Response> {
  return makeApp().request('/asks/ask_1/answer?orgId=o1', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** A version row whose document carries one agent node without a pin. */
function row(version: number, unpinnedAgentId: string) {
  return {
    name: 'ops/greet',
    version,
    document: {
      nodes: [{ id: unpinnedAgentId, type: 'agent', model: 'gpt-x' }],
    },
    message: null,
    testsPassed: null,
    taskContract: null,
    settings: null,
    presentation: null,
    createdBy: 'u1',
    createdAt: 1,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /asks/:askId/answer', () => {
  it.each([
    ['an empty body', {}],
    ['an empty answer', { answer: '' }],
    ['an oversize answer', { answer: 'x'.repeat(20_001) }],
    ['a non-string answer', { answer: 42 }],
  ])('refuses %s with the domain 400, never a 500', async (_label, body) => {
    const res = await answer(body);

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'invalid body' });
    expect(answerAsk).not.toHaveBeenCalled();
  });

  it('records a valid answer', async () => {
    answerAsk.mockResolvedValue(undefined);
    const res = await answer({ answer: 'Account 4400.' });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(answerAsk).toHaveBeenCalledTimes(1);
    expect(answerAsk.mock.calls[0]?.[1]).toEqual({
      organizationId: 'o1',
      askId: 'ask_1',
      answer: 'Account 4400.',
      answeredBy: 'u1',
    });
  });
});

describe('GET /:name — the deployed-version warning', () => {
  it('reports no deployed version and no warning when nothing is deployed', async () => {
    versionRow.mockResolvedValue(row(3, 'draft-agent'));
    deployedVersion.mockResolvedValue(undefined);

    const res = await makeApp().request('/ops/greet?orgId=o1');
    const body: unknown = await res.json();

    expect(res.status).toBe(200);
    expect(body).not.toHaveProperty('deployedVersion');
    expect(body).not.toHaveProperty('deployedUnpinnedAgentNodes');
    // The draft is never re-read as "the deployed version".
    expect(versionRow).toHaveBeenCalledTimes(1);
  });

  it("reports the DEPLOYED version's unpinned agents, not the loaded one's", async () => {
    versionRow.mockImplementation(
      (_sql: unknown, _org: string, _name: string, version?: number) =>
        Promise.resolve(
          version === 1 ? row(1, 'deployed-agent') : row(3, 'draft-agent'),
        ),
    );
    deployedVersion.mockResolvedValue(1);

    const res = await makeApp().request('/ops/greet?orgId=o1');
    const body: unknown = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      version: 3,
      deployedVersion: 1,
      deployedUnpinnedAgentNodes: ['deployed-agent'],
    });
  });
});
