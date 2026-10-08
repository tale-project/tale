// @vitest-environment node

import { Hono } from 'hono';
import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AutomationError,
  automationExists,
  beginRun,
  beginRunInTx,
  bindProject,
  bindProjectInTx,
  cancelRun,
  cancelRunInTx,
  getRun,
  listAutomations,
  listRunsPage,
  requestLegacyRunStopInTx,
  versionRow,
} from '../domains/automations/store.ts';
import type { ProjectRow } from '../domains/projects/service.ts';
import type { RestEnv } from './shared.ts';
import { createAutomationRestRoutes } from './v1-automations.ts';

vi.mock('../domains/automations/store.ts', async (original) => ({
  ...(await original<typeof import('../domains/automations/store.ts')>()),
  automationExists: vi.fn(),
  beginRun: vi.fn(),
  beginRunInTx: vi.fn(),
  bindProject: vi.fn(),
  bindProjectInTx: vi.fn(),
  cancelRun: vi.fn(),
  cancelRunInTx: vi.fn(),
  getRun: vi.fn(),
  listAutomations: vi.fn(),
  listRunsPage: vi.fn(),
  requestLegacyRunStopInTx: vi.fn(),
  versionRow: vi.fn(),
}));

const project: Pick<
  ProjectRow,
  'id' | 'organizationId' | 'teamId' | 'sharedWithTeamIds' | 'archivedAt'
> = {
  id: 'p-1',
  organizationId: 'org-1',
  teamId: null,
  sharedWithTeamIds: [],
  archivedAt: null,
};
const run = {
  id: 'run-1',
  organizationId: 'org-1',
  projectId: 'p-1',
  name: 'billing/dunning',
};

function mount(
  options: {
    project?: Partial<typeof project> | null;
    role?: string;
    orgExplicit?: boolean;
  } = {},
) {
  const selected =
    options.project === null ? null : { ...project, ...options.project };
  const tag = async (strings: TemplateStringsArray) => {
    const text = strings.join('?');
    if (text.includes('INSERT INTO app.rate_limits')) return [{ value: '1' }];
    if (text.includes('FROM app.projects'))
      return selected === null ? [] : [selected];
    if (text.includes('FROM "member"'))
      return [
        { organizationId: 'org-1', role: 'developer' },
        { organizationId: 'org-2', role: 'developer' },
      ];
    return [];
  };
  const begin = vi.fn(
    async (
      _options: string | ((tx: unknown) => Promise<unknown>),
      callback?: (tx: unknown) => Promise<unknown>,
    ) => (typeof _options === 'function' ? _options(sql) : callback?.(sql)),
  );
  const sql = Object.assign(tag, {
    unsafe: (text: string) => text,
    begin,
  }) as unknown as Sql;
  const app = new Hono<RestEnv>();
  app.use(async (c, next) => {
    c.set('userId', 'user-1');
    c.set('userEmail', 'user@example.com');
    c.set('organizationId', 'org-1');
    c.set('orgSlug', 'acme');
    c.set('role', options.role ?? 'developer');
    c.set('orgExplicit', options.orgExplicit ?? true);
    c.set('clientIp', '203.0.113.9');
    await next();
  });
  app.route('/api/v1', createAutomationRestRoutes({ sql }));
  return { app, sql, begin };
}

const json = (method: string, body?: unknown) => ({
  method,
  headers: { 'content-type': 'application/json' },
  ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(versionRow).mockResolvedValue({
    name: 'billing/dunning',
    version: 1,
  } as never);
  vi.mocked(beginRun).mockResolvedValue({ runId: 'run-1', version: 1 });
  vi.mocked(beginRunInTx).mockResolvedValue({ runId: 'run-1', version: 1 });
  vi.mocked(bindProject).mockResolvedValue({ bound: true });
  vi.mocked(bindProjectInTx).mockResolvedValue({ bound: true });
  vi.mocked(cancelRun).mockResolvedValue({ cancelled: true });
  vi.mocked(cancelRunInTx).mockResolvedValue({ cancelled: true });
  vi.mocked(getRun).mockResolvedValue(run as never);
  vi.mocked(automationExists).mockResolvedValue(true);
  vi.mocked(listRunsPage).mockResolvedValue({
    runs: [],
    isDone: true,
    next: null,
  });
  vi.mocked(listAutomations).mockResolvedValue([]);
});

describe('project automation REST scope', () => {
  it('lists only installations in the URL project without leaking other project ids [AUTO-R2]', async () => {
    vi.mocked(listAutomations).mockResolvedValue([
      {
        name: 'shared',
        latestVersion: 1,
        deployedVersion: 1,
        description: null,
        inputs: null,
        presentation: null,
        projectIds: ['p-1', 'private-project'],
        trigger: null,
      },
      {
        name: 'elsewhere',
        latestVersion: 1,
        deployedVersion: 1,
        description: null,
        inputs: null,
        presentation: null,
        projectIds: ['p-2'],
        trigger: null,
      },
    ]);
    const response = await mount().app.request(
      '/api/v1/projects/p-1/automations',
    );
    expect(response.status).toBe(200);
    // `private-project` is not among the caller's projects: the listing
    // names the installations they can see, and only those.
    expect(await response.json()).toEqual({
      automations: [
        {
          name: 'shared',
          latestVersion: 1,
          deployedVersion: 1,
          description: null,
          inputs: null,
          presentation: null,
          projectIds: ['p-1'],
          trigger: null,
        },
      ],
    });
  });

  it('binds the URL project without accepting an ownership payload and decodes automation names', async () => {
    const { app } = mount();
    const response = await app.request(
      '/api/v1/projects/p-1/automations/billing__dunning',
      json('POST'),
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      name: 'billing/dunning',
      added: true,
    });
    expect(bindProjectInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ projectId: 'p-1', name: 'billing/dunning' }),
    );
  });

  it.each([
    ['POST', '/automations/billing__dunning', { projectId: 'other' }],
    ['POST', '/automations/billing__dunning/runs', { projectId: 'other' }],
    ['POST', '/runs/run-1/cancel', { projectId: 'other' }],
  ])('refuses scope selectors in %s %s', async (method, suffix, body) => {
    const response = await mount().app.request(
      `/api/v1/projects/p-1${suffix}`,
      json(method, body),
    );
    expect(response.status).toBe(400);
    expect(bindProjectInTx).not.toHaveBeenCalled();
    expect(beginRunInTx).not.toHaveBeenCalled();
    expect(cancelRunInTx).not.toHaveBeenCalled();
  });

  it('starts a run using the URL scope in the project authorization transaction', async () => {
    const { app, begin } = mount();
    const response = await app.request(
      '/api/v1/projects/p-1/automations/billing__dunning/runs',
      json('POST', { input: { projectId: 'business-data' } }),
    );
    expect(response.status).toBe(202);
    expect(begin).toHaveBeenCalled();
    expect(beginRunInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        projectId: 'p-1',
        input: { projectId: 'business-data' },
      }),
    );
  });

  it('filters project run history by both project and automation', async () => {
    const response = await mount().app.request(
      '/api/v1/projects/p-1/automations/billing__dunning/runs',
    );
    expect(response.status).toBe(200);
    expect(listRunsPage).toHaveBeenCalledWith(expect.anything(), 'org-1', {
      name: 'billing/dunning',
      projectId: 'p-1',
      limit: 50,
    });
  });

  it('reads and cancels a run in its URL project', async () => {
    const { app } = mount();
    expect((await app.request('/api/v1/projects/p-1/runs/run-1')).status).toBe(
      200,
    );
    expect(
      (
        await app.request(
          '/api/v1/projects/p-1/runs/run-1/cancel',
          json('POST'),
        )
      ).status,
    ).toBe(200);
    expect(cancelRunInTx).toHaveBeenCalledWith(
      expect.anything(),
      'org-1',
      'run-1',
      'user-1',
    );
  });

  it.each([null, 'p-2'])(
    'refuses a run owned by scope %s even for an administrator',
    async (projectId) => {
      vi.mocked(getRun).mockResolvedValue({ ...run, projectId } as never);
      const { app } = mount({ role: 'admin' });
      expect(
        (await app.request('/api/v1/projects/p-1/runs/run-1')).status,
      ).toBe(404);
      expect(
        (
          await app.request(
            '/api/v1/projects/p-1/runs/run-1/cancel',
            json('POST'),
          )
        ).status,
      ).toBe(404);
      expect(cancelRunInTx).not.toHaveBeenCalled();
    },
  );

  it.each([
    { project: null },
    { project: { organizationId: 'org-2' } },
    { project: { teamId: 'private-team' } },
  ])(
    'hides absent, foreign and inaccessible projects: %j [AUTO-R2]',
    async (options) => {
      const { app } = mount(options as never);
      expect(
        (await app.request('/api/v1/projects/p-1/runs/run-1')).status,
      ).toBe(404);
      expect(
        (
          await app.request(
            '/api/v1/projects/p-1/automations/billing__dunning/runs',
            json('POST'),
          )
        ).status,
      ).toBe(404);
      expect(getRun).not.toHaveBeenCalled();
      expect(beginRunInTx).not.toHaveBeenCalled();
    },
  );

  it('allows member reads but refuses project run writes including mock runs', async () => {
    const { app } = mount({ role: 'member' });
    expect((await app.request('/api/v1/projects/p-1/runs/run-1')).status).toBe(
      200,
    );
    expect(
      (
        await app.request(
          '/api/v1/projects/p-1/automations/billing__dunning/runs',
          json('POST', { mode: 'mock' }),
        )
      ).status,
    ).toBe(403);
  });

  it('allows archived project reads but no new or cancelled runs [AUTO-R8]', async () => {
    const { app } = mount({ project: { archivedAt: 1 } as never });
    expect((await app.request('/api/v1/projects/p-1/runs/run-1')).status).toBe(
      200,
    );
    expect(
      (
        await app.request(
          '/api/v1/projects/p-1/automations/billing__dunning/runs',
          json('POST'),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await app.request(
          '/api/v1/projects/p-1/runs/run-1/cancel',
          json('POST'),
        )
      ).status,
    ).toBe(403);
  });
});

describe('organization run scope', () => {
  it('keeps shared definitions in the org catalog without revealing their project installations [AUTO-R2]', async () => {
    vi.mocked(listAutomations).mockResolvedValue([
      {
        name: 'shared',
        latestVersion: 1,
        deployedVersion: 1,
        description: null,
        inputs: null,
        presentation: null,
        projectIds: ['private-project'],
        trigger: null,
      },
    ]);
    const response = await mount().app.request('/api/v1/automations');
    // The catalog names the installations the key holder can SEE — the
    // scope a project-bound automation must be started in — and only
    // those: `private-project` is not among the caller's projects, so the
    // list is empty, never a leak of the hidden id.
    expect(await response.json()).toEqual({
      automations: [
        {
          name: 'shared',
          latestVersion: 1,
          deployedVersion: 1,
          description: null,
          inputs: null,
          presentation: null,
          projectIds: [],
          trigger: null,
        },
      ],
    });
  });

  it('names the visible installations, so a caller can pick the project URL', async () => {
    vi.mocked(listAutomations).mockResolvedValue([
      {
        name: 'shared',
        latestVersion: 1,
        deployedVersion: 1,
        description: null,
        inputs: null,
        presentation: null,
        projectIds: ['p-1', 'private-project'],
        trigger: null,
      },
    ]);
    const response = await mount().app.request('/api/v1/automations');
    expect(await response.json()).toMatchObject({
      automations: [{ name: 'shared', projectIds: ['p-1'] }],
    });
  });

  it('carries the trigger’s health stamps on the listing row, as the store reads them', async () => {
    vi.mocked(listAutomations).mockResolvedValue([
      {
        name: 'parked',
        latestVersion: 1,
        deployedVersion: null,
        description: null,
        inputs: null,
        presentation: null,
        projectIds: [],
        trigger: {
          kind: 'schedule',
          enabled: true,
          nextRunAt: 1_700_000_300_000,
          lastFiredAt: null,
          lastSkippedAt: 1_700_000_000_000,
          lastSkipReason: 'not_deployed',
        },
      },
    ]);
    const response = await mount().app.request('/api/v1/automations');
    // One listing call finds the binding that is enabled and not firing —
    // a caller used to read each automation's triggers one at a time.
    expect(await response.json()).toEqual({
      automations: [
        expect.objectContaining({
          name: 'parked',
          deployedVersion: null,
          trigger: {
            kind: 'schedule',
            enabled: true,
            nextRunAt: 1_700_000_300_000,
            lastFiredAt: null,
            lastSkippedAt: 1_700_000_000_000,
            lastSkipReason: 'not_deployed',
          },
        }),
      ],
    });
  });

  it('limits the global list to organization runs', async () => {
    const response = await mount().app.request(
      '/api/v1/automations/billing__dunning/runs',
    );
    expect(response.status).toBe(200);
    expect(listRunsPage).toHaveBeenCalledWith(expect.anything(), 'org-1', {
      name: 'billing/dunning',
      projectId: null,
      limit: 50,
    });
  });

  it('does not expose or cancel a project run through the global URL', async () => {
    const { app } = mount({ role: 'admin' });
    expect((await app.request('/api/v1/runs/run-1')).status).toBe(404);
    expect(
      (await app.request('/api/v1/runs/run-1/cancel', json('POST'))).status,
    ).toBe(404);
    expect(cancelRun).not.toHaveBeenCalled();
  });

  it('starts org runs with an atomic refusal of implicit project bindings [AUTO-R7]', async () => {
    const response = await mount().app.request(
      '/api/v1/automations/billing__dunning/runs',
      json('POST'),
    );
    expect(response.status).toBe(202);
    expect(beginRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        name: 'billing/dunning',
        requireOrgScope: true,
      }),
    );
  });

  it('rejects the removed projectId selector on global run start', async () => {
    const response = await mount().app.request(
      '/api/v1/automations/billing__dunning/runs',
      json('POST', { projectId: 'p-1' }),
    );
    expect(response.status).toBe(400);
    expect(beginRun).not.toHaveBeenCalled();
  });
});

describe('legacy quarantine stop requests', () => {
  const request = {
    action: 'stop',
    expectedClaimEpoch: 4,
    expectedObservedAt: 1_700_000_000_000,
    acknowledgeUnknownExternalEffects: true,
  };
  const legacyQuarantine = {
    reason: 'legacy_execution_unproven',
    observedAt: request.expectedObservedAt,
    claimEpoch: 4,
    priorStatus: 'running',
    resolution: { action: 'stop', actor: 'user-1', at: 1_700_000_000_001 },
  };
  const receipt = { requested: true, status: 'quarantined', legacyQuarantine };

  it.each([
    {
      path: '/api/v1/projects/p-1/runs/run-1/legacy-quarantine',
      projectId: 'p-1',
    },
    { path: '/api/v1/runs/run-1/legacy-quarantine', projectId: null },
  ])(
    'requests a stop in the exact $path scope without clearing the hold',
    async ({ path, projectId }) => {
      vi.mocked(getRun).mockResolvedValue({
        ...run,
        projectId,
        status: 'quarantined',
      } as never);
      vi.mocked(requestLegacyRunStopInTx).mockResolvedValue(receipt as never);
      const { app, sql, begin } = mount();
      const response = await app.request(path, json('POST', request));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(receipt);
      expect(begin).toHaveBeenCalledTimes(1);
      expect(requestLegacyRunStopInTx).toHaveBeenCalledWith(sql, {
        organizationId: 'org-1',
        runId: 'run-1',
        actor: 'user-1',
        request,
      });
      expect(cancelRunInTx).not.toHaveBeenCalled();
      expect(cancelRun).not.toHaveBeenCalled();
    },
  );

  it.each([
    {
      path: '/api/v1/projects/p-1/runs/run-1/legacy-quarantine',
      projectId: null,
    },
    {
      path: '/api/v1/projects/p-1/runs/run-1/legacy-quarantine',
      projectId: 'p-2',
    },
    { path: '/api/v1/runs/run-1/legacy-quarantine', projectId: 'p-1' },
  ])(
    'hides runs outside the URL scope: $path / $projectId',
    async ({ path, projectId }) => {
      vi.mocked(getRun).mockResolvedValue({ ...run, projectId } as never);
      const response = await mount({ role: 'admin' }).app.request(
        path,
        json('POST', request),
      );
      expect(response.status).toBe(404);
      expect(requestLegacyRunStopInTx).not.toHaveBeenCalled();
    },
  );

  it.each([
    { options: { project: null }, status: 404 },
    { options: { project: { organizationId: 'org-2' } }, status: 404 },
    { options: { project: { teamId: 'private-team' } }, status: 404 },
    { options: { project: { archivedAt: 1 } }, status: 403 },
    { options: { role: 'member' }, status: 403 },
  ])(
    'preserves the project write gate: $options',
    async ({ options, status }) => {
      const response = await mount(options).app.request(
        '/api/v1/projects/p-1/runs/run-1/legacy-quarantine',
        json('POST', request),
      );
      expect(response.status).toBe(status);
      expect(requestLegacyRunStopInTx).not.toHaveBeenCalled();
    },
  );

  it.each([
    {},
    { ...request, action: 'resume' },
    { ...request, acknowledgeUnknownExternalEffects: false },
    { ...request, expectedClaimEpoch: -1 },
    { ...request, expectedObservedAt: 1.5 },
    { ...request, actor: 'another-user' },
    { ...request, projectId: 'p-2' },
  ])(
    'refuses invalid or authority-bearing request fields: %j',
    async (body) => {
      const response = await mount().app.request(
        '/api/v1/projects/p-1/runs/run-1/legacy-quarantine',
        json('POST', body),
      );
      expect(response.status).toBe(400);
      expect(requestLegacyRunStopInTx).not.toHaveBeenCalled();
      expect(getRun).not.toHaveBeenCalled();
    },
  );

  it('refuses organization stop requests without developer authority', async () => {
    vi.mocked(getRun).mockResolvedValue({ ...run, projectId: null } as never);
    const response = await mount({ role: 'member' }).app.request(
      '/api/v1/runs/run-1/legacy-quarantine',
      json('POST', request),
    );
    expect(response.status).toBe(403);
    expect(requestLegacyRunStopInTx).not.toHaveBeenCalled();
  });

  it('hides missing runs before the stop mutation', async () => {
    vi.mocked(getRun).mockResolvedValue(null);
    const response = await mount().app.request(
      '/api/v1/projects/p-1/runs/run-1/legacy-quarantine',
      json('POST', request),
    );
    expect(response.status).toBe(404);
    expect(requestLegacyRunStopInTx).not.toHaveBeenCalled();
  });

  it('preserves a stale quarantine 409 from the store', async () => {
    vi.mocked(requestLegacyRunStopInTx).mockRejectedValue(
      new AutomationError('RUN_QUARANTINE_CHANGED', 'Quarantine changed', 409),
    );
    const response = await mount().app.request(
      '/api/v1/projects/p-1/runs/run-1/legacy-quarantine',
      json('POST', request),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: 'RUN_QUARANTINE_CHANGED',
    });
  });
});
