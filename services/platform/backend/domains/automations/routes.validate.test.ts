import { Hono, type Context } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrgEnv } from '../../auth/org.ts';

/**
 * The editor's draft check: `POST /:name/validate` answers what the engine
 * finds in a document without saving it. It is author-gated like a save —
 * it reads the organization's other automations to check the calls between
 * them — and it never writes.
 */

const io = vi.hoisted(() => ({
  role: 'developer',
  dispatched: vi.fn(),
  save: vi.fn(),
}));
vi.mock('../../auth/session.ts', () => ({
  requireSession:
    () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
      c.set('sessionBundle', { user: { id: 'u1' } } as never);
      await next();
    },
}));
vi.mock('../../auth/org.ts', async (original) => ({
  ...(await original<typeof import('../../auth/org.ts')>()),
  requireOrgMember:
    () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
      c.set('orgId', 'o1');
      c.set('orgMember', { role: io.role } as never);
      await next();
    },
}));
vi.mock('../../core/connector_credentials/connector_catalog.ts', () => ({
  loadConnectorDefinitions: () => [],
}));
vi.mock('../../../lib/engine/api/dispatch.ts', async (original) => {
  const actual =
    await original<typeof import('../../../lib/engine/api/dispatch.ts')>();
  return {
    ...actual,
    dispatch: (...args: Parameters<typeof actual.dispatch>) => {
      io.dispatched(args[0], args[1]);
      return actual.dispatch(...args);
    },
  };
});
vi.mock('./dispatch-store.ts', () => ({
  pgAutomationStore: () => ({
    get: async () => null,
    list: async () => [],
    deployedVersion: async () => null,
    triggerKinds: async () => [],
    save: io.save,
  }),
}));

import { createAutomationRoutes } from './routes.ts';

/** One error (a node read that names no node) and one warning (an unread node). */
const DRAFT = {
  version: 1,
  name: 'billing/dunning',
  nodes: [
    { id: 'stale', type: 'transform', code: 'return 1;' },
    {
      id: 'draft',
      type: 'transform',
      input: { to: '{{ nodes.nope.output }}' },
      code: 'return input.to;',
    },
  ],
  output: '{{ nodes.draft.output }}',
};

async function post(path: string, body: unknown) {
  const app = new Hono().route(
    '/api/app/automations',
    createAutomationRoutes({ sql: {} as never, auth: {} as never }),
  );
  return app.request(`/api/app/automations${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  io.role = 'developer';
});

describe('POST /:name/validate', () => {
  it('refuses a member before the engine reads anything [AUTO-R18]', async () => {
    io.role = 'member';
    const result = await post('/billing/dunning/validate', {
      document: DRAFT,
    });
    expect(result.status).toBe(403);
    expect(io.dispatched).not.toHaveBeenCalled();
  });

  it("answers a developer's draft with every issue, where it is, and the analysis [AUTO-R18]", async () => {
    const result = await post('/billing/dunning/validate', {
      document: DRAFT,
    });
    expect(result.status).toBe(200);
    const body = (await result.json()) as {
      valid: boolean;
      errors: Array<{ code: string; at?: { pointer: string } }>;
      warnings: Array<{ code: string; nodeId?: string }>;
      analysis?: { nodes: Record<string, unknown> };
      types?: unknown;
    };
    expect(body.valid).toBe(false);
    expect(body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'REF_UNKNOWN_NODE',
          at: expect.objectContaining({ pointer: '/nodes/1/input/to' }),
        }),
      ]),
    );
    expect(body.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'UNUSED_NODE', nodeId: 'stale' }),
      ]),
    );
    expect(Object.keys(body.analysis?.nodes ?? {})).toEqual(
      expect.arrayContaining(['draft', 'stale']),
    );
    expect(body.types).toBeUndefined();
    // Checking writes nothing.
    expect(io.save).not.toHaveBeenCalled();
  });

  it('answers the types only when they are asked for', async () => {
    const result = await post('/billing/dunning/validate', {
      document: DRAFT,
      detail: ['types'],
    });
    expect(result.status).toBe(200);
    const body = (await result.json()) as Record<string, unknown>;
    expect(body.types).toBeDefined();
    expect(body.analysis).toBeUndefined();
  });

  it('answers the issues alone for an empty detail', async () => {
    const result = await post('/billing/dunning/validate', {
      document: DRAFT,
      detail: [],
    });
    const body = (await result.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty('analysis');
    expect(body).not.toHaveProperty('types');
    expect(io.dispatched).toHaveBeenCalledWith('validate_automation', {
      automation: DRAFT,
      detail: [],
    });
  });

  it('names the missing document instead of checking nothing', async () => {
    const result = await post('/billing/dunning/validate', {});
    expect(result.status).toBe(400);
    expect(await result.json()).toEqual({
      error: 'invalid body',
      message: 'document: is required',
      data: { issues: [{ path: 'document', message: 'is required' }] },
    });
    expect(io.dispatched).not.toHaveBeenCalled();
  });

  it('refuses a detail it does not know', async () => {
    const result = await post('/billing/dunning/validate', {
      document: DRAFT,
      detail: ['paths'],
    });
    expect(result.status).toBe(400);
    expect(io.dispatched).not.toHaveBeenCalled();
  });
});
