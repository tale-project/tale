// @vitest-environment node

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { listProjects, type ProjectRow } from '../projects/service.ts';
import { pgAutomationStore } from './dispatch-store.ts';
import {
  beginRun,
  beginRunInTx,
  cancelRun,
  cancelRunInTx,
  getRun,
  listRuns,
} from './store.ts';

vi.mock('./store.ts', async (original) => ({
  ...(await original<typeof import('./store.ts')>()),
  beginRun: vi.fn(),
  beginRunInTx: vi.fn(),
  cancelRun: vi.fn(),
  cancelRunInTx: vi.fn(),
  getRun: vi.fn(),
  listRuns: vi.fn(),
}));
vi.mock('../projects/service.ts', async (original) => ({
  ...(await original<typeof import('../projects/service.ts')>()),
  listProjects: vi.fn(),
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
  version: 1,
  status: 'queued',
  mode: 'live',
  startedBy: 'api-key:user-1',
  detail: null,
  startedAt: 1,
  finishedAt: null,
  input: '{}',
  output: null,
  trace: null,
  effects: null,
};

function store(
  options: {
    role?: string;
    project?: Partial<typeof project> | null;
    scopeProjectId?: string;
    bindings?: string[];
    writes?: unknown[][];
  } = {},
) {
  const selected =
    options.project === null ? null : { ...project, ...options.project };
  const tag = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?');
    if (text.includes('FROM "member"'))
      return [{ role: options.role ?? 'developer' }];
    if (text.includes('FROM app.projects'))
      return selected === null ? [] : [selected];
    if (text.includes('FROM app.automation_project_bindings'))
      return (options.bindings ?? []).map((projectId) => ({ projectId }));
    if (text.includes('INSERT INTO app.automation_runs')) {
      options.writes?.push(values);
      return [{ id: 'run-1' }];
    }
    return [];
  };
  const sql = Object.assign(tag, {
    unsafe: (text: string) => text,
    json: (value: unknown) => value,
    begin: async (
      beginOptions: string | ((tx: unknown) => Promise<unknown>),
      callback?: (tx: unknown) => Promise<unknown>,
    ) =>
      typeof beginOptions === 'function' ? beginOptions(sql) : callback?.(sql),
  }) as unknown as Sql;
  return pgAutomationStore(sql, {
    organizationId: 'org-1',
    actor: 'api-key:user-1',
    ...(options.scopeProjectId !== undefined
      ? { projectId: options.scopeProjectId }
      : {}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getRun).mockResolvedValue(run as never);
  vi.mocked(beginRun).mockResolvedValue({ runId: run.id, version: 1 });
  vi.mocked(beginRunInTx).mockResolvedValue({ runId: run.id, version: 1 });
  vi.mocked(cancelRun).mockResolvedValue({ cancelled: true });
  vi.mocked(cancelRunInTx).mockResolvedValue({ cancelled: true });
  vi.mocked(listRuns).mockResolvedValue([]);
  vi.mocked(listProjects).mockResolvedValue([project] as never);
});

describe('MCP and engine actor project scope', () => {
  it.each([
    { project: null },
    { project: { organizationId: 'org-2' } },
    { project: { teamId: 'private-team' } },
  ])(
    'denies project run creation, detail and cancellation for %j',
    async (options) => {
      const engine = store(options);
      await expect(
        engine.startRun?.('billing/dunning', {}, 'live', 1, 'p-1'),
      ).rejects.toMatchObject({ code: 'PROJECT_NOT_FOUND' });
      await expect(engine.getRun?.('run-1')).resolves.toBeNull();
      await expect(engine.cancelRun?.('run-1')).rejects.toMatchObject({
        code: 'PROJECT_NOT_FOUND',
      });
      expect(beginRunInTx).not.toHaveBeenCalled();
      expect(cancelRunInTx).not.toHaveBeenCalled();
    },
  );

  it('starts the explicit readable project within the project authorization transaction', async () => {
    await expect(
      store().startRun?.('billing/dunning', { invoice: 1 }, 'live', 1, 'p-1'),
    ).resolves.toEqual({ runId: 'run-1', version: 1 });
    expect(beginRunInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        projectId: 'p-1',
        startedBy: 'api-key:user-1',
      }),
    );
  });

  it('uses a builder session project without allowing its caller to substitute another one', async () => {
    const engine = store({ scopeProjectId: 'p-1' });
    await engine.startRun?.('billing/dunning', {}, 'live', 1);
    expect(beginRunInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ projectId: 'p-1' }),
    );
    vi.mocked(beginRunInTx).mockClear();
    await expect(
      engine.startRun?.('billing/dunning', {}, 'live', 1, 'p-2'),
    ).rejects.toMatchObject({ code: 'PROJECT_NOT_FOUND' });
    expect(beginRunInTx).not.toHaveBeenCalled();
  });

  it('does not implicitly enter a bound project when the MCP caller omits it', async () => {
    await store().startRun?.('billing/dunning', {}, 'live', 1);
    expect(beginRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ requireOrgScope: true }),
    );
  });

  it('allows member reads but blocks their project mock run writes', async () => {
    const engine = store({ role: 'member' });
    await expect(engine.getRun?.('run-1')).resolves.toMatchObject({
      runId: 'run-1',
    });
    await expect(
      engine.startRun?.('billing/dunning', {}, 'mock', 1, 'p-1'),
    ).rejects.toMatchObject({ code: 'RBAC_FORBIDDEN' });
  });

  it('leaves archived project history readable and refuses writes', async () => {
    const engine = store({ project: { archivedAt: 1 } });
    await expect(engine.getRun?.('run-1')).resolves.toMatchObject({
      runId: 'run-1',
    });
    await expect(
      engine.startRun?.('billing/dunning', {}, 'live', 1, 'p-1'),
    ).rejects.toMatchObject({ code: 'PROJECT_ARCHIVED' });
    await expect(engine.cancelRun?.('run-1')).rejects.toMatchObject({
      code: 'PROJECT_ARCHIVED',
    });
  });

  it('filters run lists in SQL using the actor-readable projects', async () => {
    await store({ role: 'member' }).listRuns?.({ limit: 25 });
    expect(listProjects).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: 'user-1', role: 'member' }),
      { includeArchived: true },
    );
    expect(listRuns).toHaveBeenCalledWith(expect.anything(), 'org-1', {
      limit: 25,
      visibleProjectIds: ['p-1'],
    });
  });

  it('honors pinned project scope on list, detail and cancellation', async () => {
    const engine = store({ scopeProjectId: 'p-1' });
    await engine.listRuns?.({});
    expect(listRuns).toHaveBeenCalledWith(expect.anything(), 'org-1', {
      projectId: 'p-1',
      visibleProjectIds: ['p-1'],
    });
    vi.mocked(getRun).mockResolvedValue({ ...run, projectId: 'p-2' } as never);
    await expect(engine.getRun?.('run-1')).resolves.toBeNull();
    await expect(engine.cancelRun?.('run-1')).resolves.toEqual({
      cancelled: false,
    });
    expect(cancelRunInTx).not.toHaveBeenCalled();
  });

  it('cancels a visible project run and leaves organization runs accessible', async () => {
    const engine = store();
    await expect(engine.cancelRun?.('run-1')).resolves.toEqual({
      cancelled: true,
    });
    expect(cancelRunInTx).toHaveBeenCalledWith(
      expect.anything(),
      'org-1',
      'run-1',
    );
    vi.mocked(getRun).mockResolvedValue({ ...run, projectId: null } as never);
    await expect(engine.getRun?.('run-1')).resolves.toMatchObject({
      runId: 'run-1',
    });
    await expect(engine.cancelRun?.('run-1')).resolves.toEqual({
      cancelled: true,
    });
    expect(cancelRun).toHaveBeenCalledWith(expect.anything(), 'org-1', 'run-1');
  });

  it('authorizes and records a builder mock run inside its project', async () => {
    const writes: unknown[][] = [];
    const engine = store({ scopeProjectId: 'p-1', bindings: ['p-1'], writes });
    await expect(
      engine.authorizeRun?.('billing/dunning', 'mock'),
    ).resolves.toBeUndefined();
    await engine.recordRun?.(
      'billing/dunning',
      1,
      { status: 'success', trace: [], effects: [] },
      'mock',
    );
    expect(writes).toHaveLength(1);
    expect(writes[0]?.[3]).toBe('p-1');
  });

  it('refuses unscoped in-process execution and recording of a project-bound automation', async () => {
    const writes: unknown[][] = [];
    const engine = store({ bindings: ['p-1'], writes });
    await expect(
      engine.authorizeRun?.('billing/dunning', 'mock'),
    ).rejects.toMatchObject({ code: 'AUTOMATION_PROJECT_SCOPE_REQUIRED' });
    await expect(
      engine.recordRun?.(
        'billing/dunning',
        1,
        { status: 'success', trace: [], effects: [] },
        'mock',
      ),
    ).rejects.toMatchObject({ code: 'AUTOMATION_PROJECT_SCOPE_REQUIRED' });
    expect(writes).toHaveLength(0);
  });

  it.each([
    { role: 'member' },
    { project: { teamId: 'private-team' } },
    { project: { archivedAt: 1 } },
  ])(
    'refuses unauthorized builder execution and recording: %j',
    async (options) => {
      const writes: unknown[][] = [];
      const engine = store({ ...options, scopeProjectId: 'p-1', writes });
      await expect(
        engine.authorizeRun?.('billing/dunning', 'mock'),
      ).rejects.toThrow();
      await expect(
        engine.recordRun?.(
          'billing/dunning',
          1,
          { status: 'success', trace: [], effects: [] },
          'mock',
        ),
      ).rejects.toThrow();
      expect(writes).toHaveLength(0);
    },
  );
});
