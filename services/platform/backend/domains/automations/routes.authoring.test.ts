import { Hono, type Context } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrgEnv } from '../../auth/org.ts';

const io = vi.hoisted(() => ({
  document: {} as unknown,
  save: vi.fn(),
  deploy: vi.fn(),
  verdict: vi.fn(),
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
      c.set('orgMember', { role: 'admin' } as never);
      await next();
    },
}));
vi.mock('../../core/connector_credentials/connector_catalog.ts', () => ({
  loadConnectorDefinitions: () => [],
}));
vi.mock('./store.ts', async (original) => ({
  ...(await original<typeof import('./store.ts')>()),
  saveVersion: io.save,
}));
vi.mock('./dispatch-store.ts', () => ({
  pgAutomationStore: () => ({
    get: async () => ({ meta: { version: 2 }, automation: io.document }),
    deploy: io.deploy,
    recordTestVerdict: io.verdict,
  }),
}));

import { createAutomationRoutes } from './routes.ts';
import { AutomationError } from './store.ts';

function document(multiplier: number) {
  return {
    name: 'double',
    nodes: [
      {
        id: 'double',
        type: 'transform',
        input: { n: '{{ input.n }}' },
        code: `return input.n * ${multiplier};`,
      },
    ],
    output: '{{ nodes.double.output }}',
    tests: [{ name: 'doubles seven', input: { n: 7 }, expect: { output: 14 } }],
  };
}
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
  io.save.mockResolvedValue({ name: 'double', version: 2 });
  io.deploy.mockResolvedValue({ name: 'double', version: 2 });
});

describe('app automation acceptance gate', () => {
  it('no longer accepts standalone goal-authoring sessions', async () => {
    const result = await post('/builder/sessions', {
      goal: 'Double a number',
      model: { providerSlug: 'test', modelId: 'test' },
    });
    expect(result.status).toBe(404);
    expect(io.save).not.toHaveBeenCalled();
    expect(io.deploy).not.toHaveBeenCalled();
  });
  it.each([
    [2, true],
    [3, false],
  ])(
    'runs declared tests on save (multiplier %s)',
    async (multiplier, verdict) => {
      const result = await post('/double/save', {
        document: document(multiplier),
        testsPassed: true,
      });
      expect(result.status).toBe(201);
      expect(io.save).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ testsPassed: verdict }),
      );
    },
  );
  it('refuses an untested stored version whose declared tests fail and records the verdict', async () => {
    io.document = document(3);
    const result = await post('/double/deploy', { version: 2 });
    expect(result.status).toBe(409);
    expect(await result.json()).toMatchObject({
      error: 'AUTOMATION_TESTS_FAILING',
    });
    expect(io.deploy).not.toHaveBeenCalled();
    expect(io.verdict).toHaveBeenCalledWith('double', 2, false);
  });
  it('deploys a passing version with a fresh server verdict', async () => {
    io.document = document(2);
    const result = await post('/double/deploy', { version: 2 });
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ name: 'double', version: 2 });
    expect(io.deploy).toHaveBeenCalledWith('double', 2, { testsPassed: true });
  });
  it('does not save a malformed document', async () => {
    const result = await post('/double/save', {
      document: { name: 'double', nodes: 'invalid' },
    });
    expect(result.status).toBe(400);
    expect(io.save).not.toHaveBeenCalled();
  });
  it('forwards the version the draft started from and hands back a stale refusal with its detail', async () => {
    const result = await post('/double/save', {
      document: document(2),
      baseVersion: 5,
    });
    expect(result.status).toBe(201);
    expect(io.save).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ baseVersion: 5 }),
    );

    io.save.mockRejectedValueOnce(
      new AutomationError(
        'AUTOMATION_VERSION_STALE',
        'v6 of "double" was saved after your draft started from v5.',
        409,
        { latestVersion: 6, baseVersion: 5 },
      ),
    );
    const stale = await post('/double/save', {
      document: document(2),
      baseVersion: 5,
    });
    expect(stale.status).toBe(409);
    // The detail rides beside the sentence so the editor can offer "save
    // anyway" on top of the version that landed.
    expect(await stale.json()).toEqual({
      error: 'AUTOMATION_VERSION_STALE',
      message: 'v6 of "double" was saved after your draft started from v5.',
      data: { latestVersion: 6, baseVersion: 5 },
    });
  });
  it('preserves a store refusal after the shared save gate', async () => {
    io.save.mockRejectedValueOnce(
      new AutomationError('PROJECT_NOT_FOUND', 'Project not found', 404),
    );
    const result = await post('/double/save', { document: document(2) });
    expect(result.status).toBe(404);
    expect(await result.json()).toEqual({
      error: 'PROJECT_NOT_FOUND',
      message: 'Project not found',
    });
  });
  it('preserves a store refusal after the shared deploy gate', async () => {
    io.document = document(2);
    io.deploy.mockRejectedValueOnce(
      new AutomationError('AUTOMATION_NAME_TAKEN', 'Name already taken', 409),
    );
    const result = await post('/double/deploy', { version: 2 });
    expect(result.status).toBe(409);
    expect(await result.json()).toEqual({
      error: 'AUTOMATION_NAME_TAKEN',
      message: 'Name already taken',
    });
  });
});
