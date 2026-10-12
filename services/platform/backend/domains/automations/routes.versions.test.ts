import { Hono, type Context } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrgEnv } from '../../auth/org.ts';

const io = vi.hoisted(() => ({
  role: 'admin',
  exists: true,
  document: {} as unknown,
  save: vi.fn(),
  storeSave: vi.fn(),
  deploy: vi.fn(),
  verdict: vi.fn(),
  versionRow: vi.fn(),
  deployedVersion: vi.fn(),
  history: vi.fn(),
  deployments: vi.fn(),
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
vi.mock('./store.ts', async (original) => ({
  ...(await original<typeof import('./store.ts')>()),
  saveVersion: io.save,
  versionRow: io.versionRow,
  deployedVersion: io.deployedVersion,
}));
vi.mock('./versions.ts', async (original) => ({
  ...(await original<typeof import('./versions.ts')>()),
  listVersionHistory: io.history,
}));
vi.mock('./deployments.ts', async (original) => ({
  ...(await original<typeof import('./deployments.ts')>()),
  listDeploymentEvents: io.deployments,
}));
vi.mock('./dispatch-store.ts', () => ({
  pgAutomationStore: () => ({
    get: async () =>
      io.exists ? { meta: { version: 2 }, automation: io.document } : null,
    // A version in full, read from the same rows the store functions answer.
    getVersionView: async (_name: string, version?: number) => {
      const found = await io.versionRow(undefined, 'o1', 'double', version);
      return found === null
        ? null
        : {
            name: 'double',
            version: found.version,
            latestVersion: 4,
            deployedVersion: null,
            document: found.document,
            settings: found.settings,
            taskContract: found.taskContract,
            presentation: found.presentation,
            message: found.message,
            testsPassed: found.testsPassed,
            testsCheckedAt: found.testsCheckedAt,
            createdBy: found.createdBy,
            createdAt: found.createdAt,
            createdVia: found.createdVia,
            clientName: found.clientName,
            projectIds: [],
            trigger: null,
          };
    },
    save: io.storeSave,
    deploy: io.deploy,
    recordTestVerdict: io.verdict,
  }),
}));

import { createAutomationRoutes } from './routes.ts';
import { AutomationError } from './store.ts';

function document(multiplier: number) {
  return {
    version: 1,
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

/** A saved version as the store reads it. */
function row(version: number, overrides: Record<string, unknown> = {}) {
  return {
    name: 'double',
    version,
    document: document(2),
    message: `v${String(version)}`,
    testsPassed: true,
    testsCheckedAt: 1,
    taskContract: null,
    settings: null,
    presentation: { name: 'Double' },
    createdBy: 'u2',
    createdAt: 1_000,
    createdVia: 'app',
    apiKeyId: null,
    clientName: null,
    ...overrides,
  };
}

/** A history row as `listVersionHistory` answers it. */
function historyRow(version: number, overrides: Record<string, unknown> = {}) {
  return {
    version,
    message: null,
    createdBy: 'u2',
    createdAt: 1_000,
    via: 'mcp',
    viaInferred: false,
    apiKeyId: 'key_1',
    clientName: 'Claude Code',
    basedOnVersion: version - 1,
    restoredFromVersion: null,
    changes: { nodes: { added: 1, removed: 0, changed: 0 } },
    testsPassed: null,
    testsCheckedAt: null,
    live: false,
    lastDeployedAt: null,
    ...overrides,
  };
}

function app() {
  return new Hono().route(
    '/api/app/automations',
    createAutomationRoutes({ sql: {} as never, auth: {} as never }),
  );
}
async function post(path: string, body: unknown) {
  return app().request(`/api/app/automations${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
async function get(path: string) {
  return app().request(`/api/app/automations${path}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  io.role = 'admin';
  io.exists = true;
  io.document = document(2);
  io.save.mockResolvedValue({ name: 'double', version: 5 });
  io.storeSave.mockResolvedValue({ name: 'double', version: 5 });
  io.deploy.mockResolvedValue({ name: 'double', version: 2 });
  io.versionRow.mockImplementation(
    async (_sql: unknown, _org: string, _name: string, version?: number) =>
      row(version ?? 4),
  );
  io.deployedVersion.mockResolvedValue(undefined);
});

describe('restoring a version at the app door [AUTO-R48]', () => {
  it('saves the older version as the newest, restored from it, through the save’s own checks and tests', async () => {
    const result = await post('/double/restore', { version: 1 });
    expect(result.status).toBe(201);
    expect(await result.json()).toEqual({
      name: 'double',
      version: 5,
      restoredFrom: 1,
      testsPassed: true,
      warnings: [],
    });
    // The engine's own restore: the version's document with what it kept
    // beside it, restored from it; the store records the rest.
    expect(io.storeSave).toHaveBeenCalledWith(document(2), 'Restore v1', {
      testsPassed: true,
      testReport: expect.objectContaining({ passed: 1, failed: 0 }),
      restoredFrom: 1,
      metadata: {
        settings: null,
        taskContract: null,
        presentation: { name: 'Double' },
      },
    });
  });

  it('answers 200 and unchanged when the content is the latest already', async () => {
    io.storeSave.mockResolvedValue({
      name: 'double',
      version: 4,
      unchanged: true,
    });
    const result = await post('/double/restore', {
      version: 1,
      message: 'Back to the March flow',
      baseVersion: 4,
    });
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({
      version: 4,
      restoredFrom: 1,
      unchanged: true,
    });
    expect(io.storeSave).toHaveBeenCalledWith(
      document(2),
      'Back to the March flow',
      expect.objectContaining({ baseVersion: 4, restoredFrom: 1 }),
    );
  });

  it('refuses a version that no longer passes today’s checks, saving nothing [AUTO-R23]', async () => {
    io.versionRow.mockResolvedValue(
      row(1, {
        document: { ...document(2), output: '{{ nodes.nope.output }}' },
      }),
    );
    const result = await post('/double/restore', { version: 1 });
    expect(result.status).toBe(400);
    expect(await result.json()).toMatchObject({ error: 'AUTOMATION_INVALID' });
    expect(io.storeSave).not.toHaveBeenCalled();
  });

  it('refuses a version the automation does not have', async () => {
    io.versionRow.mockResolvedValue(null);
    const result = await post('/double/restore', { version: 9 });
    expect(result.status).toBe(404);
    expect(await result.json()).toMatchObject({
      error: 'AUTOMATION_VERSION_UNKNOWN',
    });
  });

  it('refuses an automation that does not exist as not found, saving nothing', async () => {
    io.exists = false;
    const result = await post('/ghost/restore', { version: 1 });
    expect(result.status).toBe(404);
    expect(await result.json()).toMatchObject({
      error: 'AUTOMATION_NOT_FOUND',
    });
    expect(io.storeSave).not.toHaveBeenCalled();
  });

  it('is an author’s write: a member is refused', async () => {
    io.role = 'member';
    const result = await post('/double/restore', { version: 1 });
    expect(result.status).toBe(403);
    expect(io.storeSave).not.toHaveBeenCalled();
  });

  it('keeps the store’s own status when a version was saved since the one the restore read', async () => {
    io.storeSave.mockRejectedValue(
      new AutomationError(
        'AUTOMATION_VERSION_STALE',
        'v5 was saved since',
        409,
        {
          latestVersion: 5,
          baseVersion: 4,
        },
      ),
    );
    const result = await post('/double/restore', {
      version: 1,
      baseVersion: 4,
    });
    expect(result.status).toBe(409);
    expect(await result.json()).toMatchObject({
      error: 'AUTOMATION_VERSION_STALE',
    });
  });
});

describe('deploying at the app door [AUTO-R46]', () => {
  it('hands the expected live version on, and answers the store’s whole deploy with its trigger', async () => {
    const answer = {
      name: 'double',
      version: 2,
      previousVersion: 3,
      kind: 'rollback',
      deploymentId: 'deployment-1',
      trigger: {
        kind: 'schedule',
        enabled: false,
        nextRunAt: null,
        warnings: [],
      },
    };
    io.deploy.mockResolvedValue(answer);
    const result = await post('/double/deploy', {
      version: 2,
      expectedDeployedVersion: 3,
    });
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual(answer);
    expect(io.deploy).toHaveBeenCalledWith('double', 2, {
      testsPassed: true,
      testReport: expect.objectContaining({ passed: 1, failed: 0 }),
      expectedDeployedVersion: 3,
    });
  });

  it('takes an expected null as "nothing is live"', async () => {
    await post('/double/deploy', { version: 2, expectedDeployedVersion: null });
    expect(io.deploy).toHaveBeenCalledWith('double', 2, {
      testsPassed: true,
      testReport: expect.objectContaining({ passed: 1, failed: 0 }),
      expectedDeployedVersion: null,
    });
  });
});

describe('saving at the app door [AUTO-R47]', () => {
  it('records what the draft was based on, and answers what the version changed', async () => {
    const changes = { nodes: { added: 1, removed: 0, changed: 0 } };
    io.save.mockResolvedValue({ name: 'double', version: 4, changes });
    const result = await post('/double/save', {
      document: document(2),
      basedOnVersion: 3,
    });
    expect(result.status).toBe(201);
    expect(await result.json()).toMatchObject({ version: 4, changes });
    expect(io.save).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ basedOnVersion: 3 }),
    );
  });
});

describe('the version history at the app door [AUTO-R47]', () => {
  it('answers a page when asked for one', async () => {
    io.history.mockResolvedValue({
      versions: [historyRow(4, { live: true, lastDeployedAt: 9_000 })],
      nextBefore: 4,
      latestVersion: 5,
      deployedVersion: 4,
    });
    const result = await get('/double/versions?limit=1&before=5');
    expect(io.history).toHaveBeenCalledWith(expect.anything(), 'o1', 'double', {
      limit: 1,
      before: 5,
    });
    expect(await result.json()).toEqual({
      versions: [
        {
          version: 4,
          createdBy: 'u2',
          createdAt: 1_000,
          createdVia: 'mcp',
          viaInferred: false,
          clientName: 'Claude Code',
          basedOnVersion: 3,
          restoredFromVersion: null,
          changes: { nodes: { added: 1, removed: 0, changed: 0 } },
          deployed: true,
          lastDeployedAt: 9_000,
        },
      ],
      nextBefore: 4,
      latestVersion: 5,
      deployedVersion: 4,
    });
  });

  it('answers every version without a page, reading the history page by page', async () => {
    io.history
      .mockResolvedValueOnce({
        versions: [historyRow(3, { message: 'third', testsPassed: true })],
        nextBefore: 3,
        latestVersion: 3,
        deployedVersion: null,
      })
      .mockResolvedValueOnce({
        versions: [historyRow(2), historyRow(1)],
        nextBefore: null,
        latestVersion: 3,
        deployedVersion: null,
      });
    const result = await get('/double/versions');
    const body = (await result.json()) as {
      versions: Array<{
        version: number;
        message?: string;
        testsPassed?: boolean;
      }>;
      nextBefore: number | null;
    };
    expect(body.versions.map((entry) => entry.version)).toEqual([3, 2, 1]);
    // A message and a verdict a version has; none left as null.
    expect(body.versions[0]).toMatchObject({
      message: 'third',
      testsPassed: true,
    });
    expect(body.versions[1]).not.toHaveProperty('message');
    expect(body.versions[1]).not.toHaveProperty('testsPassed');
    expect(body.nextBefore).toBeNull();
    expect(io.history).toHaveBeenLastCalledWith(
      expect.anything(),
      'o1',
      'double',
      { limit: 200, before: 3 },
    );
  });
});

describe('the deployment history at the app door [AUTO-R46]', () => {
  it('answers what is live and the deploys, a page from where the last ended', async () => {
    io.deployments.mockResolvedValue({
      live: {
        version: 4,
        since: 9_000,
        actor: 'u2',
        via: 'app',
        clientName: null,
        activeRuns: 1,
      },
      events: [
        {
          id: 'e-4',
          version: 4,
          previousVersion: 5,
          kind: 'rollback',
          synthesized: false,
          actor: 'u2',
          via: 'app',
          apiKeyId: null,
          clientName: null,
          at: 9_000,
        },
      ],
      nextBefore: { at: 9_000, id: 'e-4' },
    });
    const result = await get('/double/deployments?limit=1&before=9500:e-5');
    expect(io.deployments).toHaveBeenCalledWith(
      expect.anything(),
      'o1',
      'double',
      { limit: 1, before: { at: 9_500, id: 'e-5' } },
    );
    expect(await result.json()).toEqual({
      live: {
        version: 4,
        deployedAt: 9_000,
        deployedBy: 'u2',
        via: 'app',
        clientName: null,
        activeRuns: 1,
      },
      deployments: [
        {
          id: 'e-4',
          version: 4,
          previousVersion: 5,
          kind: 'rollback',
          synthesized: false,
          deployedAt: 9_000,
          deployedBy: 'u2',
          via: 'app',
          clientName: null,
        },
      ],
      nextBefore: { at: 9_000, id: 'e-4' },
    });
  });

  it('reads a position it cannot parse as none', async () => {
    io.deployments.mockResolvedValue({
      live: null,
      events: [],
      nextBefore: null,
    });
    await get('/double/deployments?before=nonsense');
    expect(io.deployments).toHaveBeenCalledWith(
      expect.anything(),
      'o1',
      'double',
      {},
    );
  });
});

describe('an automation at the app door', () => {
  it('says the shown version’s door, lineage and changes, and which version is the latest', async () => {
    io.history.mockResolvedValue({
      versions: [historyRow(3, { restoredFromVersion: 1, basedOnVersion: 1 })],
      nextBefore: 3,
      latestVersion: 5,
      deployedVersion: null,
    });
    const result = await get('/double?version=3');
    expect(io.history).toHaveBeenCalledWith(expect.anything(), 'o1', 'double', {
      before: 4,
      limit: 1,
    });
    expect(await result.json()).toMatchObject({
      name: 'double',
      version: 3,
      latestVersion: 5,
      createdVia: 'mcp',
      viaInferred: false,
      clientName: 'Claude Code',
      basedOnVersion: 1,
      restoredFromVersion: 1,
      changes: { nodes: { added: 1, removed: 0, changed: 0 } },
    });
  });
});
