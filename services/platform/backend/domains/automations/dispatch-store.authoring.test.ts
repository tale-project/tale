// @vitest-environment node

/**
 * The organization store behind the MCP authoring tools: what a coding
 * agent's call may read and change, and what it records. Reads answer only
 * what the app would show the person (an automation installed only in
 * projects they cannot read is "not found"); a save records its door, key
 * and client and carries the version fields it leaves out; installations,
 * deletes and answers pass the same gates as the REST API; a run page's
 * cursor is redeemable only on the listing, and in the organization, that
 * answered it. The store functions are doubles; each has its own tests.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mintCursorFor } from '../../core/lib/signed_cursor.ts';
import {
  assertWritable,
  listProjects,
  loadProjectOrThrow,
  ProjectError,
  type ProjectRow,
} from '../projects/service.ts';
import { answerRunAskAs } from './ask-answer.ts';
import { listDeployments } from './audit.ts';
import { pgAutomationStore } from './dispatch-store.ts';
import {
  bindingProjectIds,
  bindProjectInTx,
  deleteAutomationCascade,
  deploy,
  deployedVersion,
  getRun,
  listRunsPage,
  listTriggers,
  listVersions,
  saveVersion,
  unbindProjectInTx,
  versionRow,
} from './store.ts';

vi.mock('./store.ts', async (original) => ({
  ...(await original<typeof import('./store.ts')>()),
  bindingProjectIds: vi.fn(),
  bindProjectInTx: vi.fn(),
  deleteAutomationCascade: vi.fn(),
  deploy: vi.fn(),
  deployedVersion: vi.fn(),
  getRun: vi.fn(),
  listRunsPage: vi.fn(),
  listTriggers: vi.fn(),
  listVersions: vi.fn(),
  saveVersion: vi.fn(),
  unbindProjectInTx: vi.fn(),
  versionRow: vi.fn(),
}));
vi.mock('./ask-answer.ts', () => ({ answerRunAskAs: vi.fn() }));
vi.mock('./audit.ts', () => ({
  auditDefinitionWrite: vi.fn(),
  listDeployments: vi.fn(),
}));
vi.mock('../projects/service.ts', async (original) => ({
  ...(await original<typeof import('../projects/service.ts')>()),
  assertWritable: vi.fn(),
  listProjects: vi.fn(),
  loadProjectOrThrow: vi.fn(),
}));

const ORG = 'org-1';
const NAME = 'hr/onboarding';

/** p-1 is readable and writable; p-ro readable, not writable; p-hidden is
 * a project the caller cannot read. */
const projectRow = (id: string): ProjectRow =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the fields the gates read
  ({
    id,
    organizationId: ORG,
    teamId: null,
    sharedWithTeamIds: [],
    archivedAt: null,
  }) as unknown as ProjectRow;

const versionOf = (version: number) => ({
  name: NAME,
  version,
  document: { name: NAME },
  message: 'why',
  testsPassed: true,
  testsCheckedAt: 1,
  taskContract: null,
  settings: { forms: [] },
  presentation: null,
  createdBy: 'api-key:user-1',
  createdAt: 2,
  createdVia: 'mcp' as const,
  apiKeyId: 'key-1',
  clientName: 'Claude Code',
});

function store(
  options: {
    role?: string;
    visibleOnly?: boolean;
    organizationId?: string;
  } = {},
) {
  const tag = async (strings: TemplateStringsArray) => {
    const text = strings.join('?');
    if (text.includes('FROM "member"'))
      return [{ role: options.role ?? 'developer' }];
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
    organizationId: options.organizationId ?? ORG,
    actor: 'api-key:user-1',
    apiKeyId: 'key-1',
    via: 'mcp',
    clientName: 'Claude Code',
    ...(options.visibleOnly === false ? {} : { visibleOnly: true }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listProjects).mockResolvedValue([
    projectRow('p-1'),
    projectRow('p-ro'),
  ] as never);
  vi.mocked(loadProjectOrThrow).mockImplementation(async (_sql, id) => {
    if (id === 'p-1' || id === 'p-ro') return projectRow(id);
    throw new ProjectError('PROJECT_NOT_FOUND', 'Project not found', 404);
  });
  vi.mocked(assertWritable).mockImplementation((project) => {
    if (project.id === 'p-ro') {
      throw new ProjectError('RBAC_FORBIDDEN', 'Editor role required', 403);
    }
  });
  vi.mocked(bindingProjectIds).mockResolvedValue([]);
  vi.mocked(versionRow).mockImplementation(async (_sql, _org, _name, version) =>
    versionOf(version ?? 7),
  );
  vi.mocked(deployedVersion).mockResolvedValue(6);
  vi.mocked(listTriggers).mockResolvedValue([]);
  vi.mocked(listVersions).mockResolvedValue([]);
  vi.mocked(listDeployments).mockResolvedValue([]);
});

describe('reads follow what the app would show the person [MCP-R9]', () => {
  it('Mia cannot read hr/onboarding, installed only in a project of a team she is not in: every read says not found [MCP-R9]', async () => {
    vi.mocked(bindingProjectIds).mockResolvedValue(['p-hidden']);
    vi.mocked(listTriggers).mockResolvedValue([
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the fields the read uses
      { name: NAME, kind: 'schedule' } as never,
    ]);
    const s = store({ role: 'member' });
    expect(await s.get(NAME)).toBeNull();
    expect(await s.deployedVersion(NAME)).toBeNull();
    expect(await s.getVersionView?.(NAME)).toBeNull();
    expect(await s.listVersions?.(NAME)).toEqual([]);
    expect(await s.listTriggers?.(NAME)).toEqual([]);
    expect(await s.listTriggers?.()).toEqual([]);
    expect(await s.listDeployments?.(NAME)).toEqual([]);
    expect(versionRow).not.toHaveBeenCalled();
  });

  it.each([[['p-1']], [['p-hidden', 'p-1']], [[]]])(
    'installed in %j, it reads',
    async (bindings) => {
      vi.mocked(bindingProjectIds).mockResolvedValue(bindings);
      expect(await store({ role: 'member' }).get(NAME)).toEqual({
        meta: { version: 7 },
        automation: { name: NAME },
      });
    },
  );

  it('the app’s own doors keep reading what they read (no visibility asked)', async () => {
    vi.mocked(bindingProjectIds).mockResolvedValue(['p-hidden']);
    expect(await store({ visibleOnly: false }).get(NAME)).not.toBeNull();
  });
});

describe('getVersionView', () => {
  it('answers the version in full, its visible installations, and its trigger without the secret', async () => {
    vi.mocked(bindingProjectIds).mockResolvedValue(['p-1', 'p-hidden']);
    vi.mocked(listTriggers).mockResolvedValue([
      {
        id: 'trg-1',
        name: NAME,
        kind: 'webhook',
        cron: null,
        timezone: null,
        event: null,
        hasToken: true,
        enabled: true,
        lastFiredAt: null,
        lastRunId: null,
        lastSkippedAt: null,
        lastSkipReason: null,
        consecutiveFailures: 0,
        lastFailedAt: null,
        lastFailureCode: null,
        lastFailedRunId: null,
      },
    ]);
    const view = await store().getVersionView?.(NAME, 6);
    expect(view).toEqual({
      name: NAME,
      version: 6,
      latestVersion: 7,
      deployedVersion: 6,
      document: { name: NAME },
      settings: { forms: [] },
      taskContract: null,
      presentation: null,
      message: 'why',
      testsPassed: true,
      testsCheckedAt: 1,
      createdBy: 'api-key:user-1',
      createdAt: 2,
      createdVia: 'mcp',
      clientName: 'Claude Code',
      projectIds: ['p-1'],
      trigger: {
        id: 'trg-1',
        name: NAME,
        kind: 'webhook',
        hasToken: true,
        enabled: true,
      },
    });
    // No key id and no token travel on the read.
    expect(JSON.stringify(view)).not.toMatch(/key-1|token"/);
  });
});

describe('save', () => {
  const doc = { version: 1 as const, name: NAME, nodes: [] };

  it('records the door, the key and the client, and carries what the call left out', async () => {
    vi.mocked(saveVersion).mockResolvedValue({
      name: NAME,
      version: 8,
      carried: ['settings'],
    });
    await store().save(doc as never, 'why', {
      baseVersion: 7,
      create: true,
      metadata: { presentation: null },
    });
    expect(saveVersion).toHaveBeenCalledWith(expect.anything(), {
      organizationId: ORG,
      name: NAME,
      document: doc,
      actor: 'api-key:user-1',
      message: 'why',
      baseVersion: 7,
      create: true,
      metadataMode: 'carry',
      presentation: null,
      origin: { via: 'mcp', apiKeyId: 'key-1', clientName: 'Claude Code' },
      authorize: expect.any(Function),
    });
  });

  /** The check the store hands the save to run under the name lock, as the
   * save would run it: `latest` null when the save creates the automation. */
  const authorizeOf = async (
    options: Parameters<ReturnType<typeof store>['save']>[2],
  ): Promise<(latest: number | null) => Promise<void>> => {
    vi.mocked(saveVersion).mockResolvedValueOnce({ name: NAME, version: 1 });
    await store().save(doc as never, '', options);
    const authorize = vi.mocked(saveVersion).mock.calls.at(-1)?.[1].authorize;
    if (authorize === undefined) throw new Error('no authorize hook');
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the scripted handle the store's own sql answers through
    return (latest) => authorize({} as never, latest);
  };

  it('installs a new automation only in a project the person may edit, checked under the name lock', async () => {
    const creating = async (projectId: string) =>
      (await authorizeOf({ projectId, metadata: {} }))(null);
    await expect(creating('p-1')).resolves.toBeUndefined();
    await expect(creating('p-ro')).rejects.toMatchObject({
      code: 'RBAC_FORBIDDEN',
    });
    await expect(creating('p-hidden')).rejects.toMatchObject({
      code: 'PROJECT_NOT_FOUND',
    });
  });

  it('ignores the project of a save that adds a version, as its description says', async () => {
    // Ada saves v8 of an automation that exists, naming a project she
    // cannot edit: the project is not used, so the save is not refused.
    const adding = await authorizeOf({ projectId: 'p-ro', metadata: {} });
    await expect(adding(7)).resolves.toBeUndefined();
  });

  it("refuses Noah's version on top of hr/onboarding, which he cannot see, as a taken name [MCP-R9]", async () => {
    // Installed only in a project of a team Noah (a developer) is not in:
    // a version on top would change it unseen and its answer reveal it.
    vi.mocked(bindingProjectIds).mockResolvedValue(['p-hidden']);
    const authorize = await authorizeOf({ metadata: {} });
    await expect(authorize(7)).rejects.toMatchObject({
      code: 'AUTOMATION_NAME_TAKEN',
      status: 409,
    });
    // A name nobody saved yet is his to create.
    await expect(authorize(null)).resolves.toBeUndefined();
    // Installed where she can read, she adds a version as before.
    vi.mocked(bindingProjectIds).mockResolvedValue(['p-1']);
    await expect(authorize(7)).resolves.toBeUndefined();
  });
});

describe('deploy and delete', () => {
  it('hands the expected live version to the store', async () => {
    vi.mocked(deploy).mockResolvedValue({
      name: NAME,
      version: 7,
      previousVersion: 6,
    });
    await store().deploy(NAME, 7, {
      testsPassed: true,
      expectedDeployedVersion: 6,
    });
    expect(deploy).toHaveBeenCalledWith(expect.anything(), {
      organizationId: ORG,
      name: NAME,
      version: 7,
      actor: 'api-key:user-1',
      testsPassed: true,
      expectedDeployedVersion: 6,
    });
  });

  it('deletes only for the developer bar, and never an automation the person cannot see', async () => {
    vi.mocked(deleteAutomationCascade).mockResolvedValue({ versions: 7 });
    await expect(
      store({ role: 'member' }).deleteAutomation?.(NAME, 7),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_DEVELOPER_SETTINGS' });
    vi.mocked(bindingProjectIds).mockResolvedValue(['p-hidden']);
    await expect(store().deleteAutomation?.(NAME, 7)).rejects.toMatchObject({
      code: 'AUTOMATION_NOT_FOUND',
    });
    expect(deleteAutomationCascade).not.toHaveBeenCalled();
    vi.mocked(bindingProjectIds).mockResolvedValue([]);
    expect(await store().deleteAutomation?.(NAME, 7)).toEqual({ versions: 7 });
    expect(deleteAutomationCascade).toHaveBeenCalledWith(expect.anything(), {
      organizationId: ORG,
      name: NAME,
      actor: 'api-key:user-1',
      expectedLatestVersion: 7,
    });
  });
});

describe('setAutomationProjects', () => {
  it('installs and removes behind every project’s edit gate, in one transaction', async () => {
    vi.mocked(bindingProjectIds).mockResolvedValue(['p-ro']);
    await expect(
      store().setAutomationProjects?.(NAME, { add: ['p-1'], remove: ['p-ro'] }),
    ).rejects.toMatchObject({ code: 'RBAC_FORBIDDEN' });
    expect(bindProjectInTx).not.toHaveBeenCalled();
    expect(unbindProjectInTx).not.toHaveBeenCalled();
  });

  it('refuses removing it from a project it is not installed in, changing nothing', async () => {
    vi.mocked(bindingProjectIds).mockResolvedValue([]);
    await expect(
      store().setAutomationProjects?.(NAME, { add: [], remove: ['p-1'] }),
    ).rejects.toMatchObject({
      code: 'AUTOMATION_NOT_INSTALLED',
      data: { projectId: 'p-1' },
    });
    expect(unbindProjectInTx).not.toHaveBeenCalled();
  });

  it('answers what it added, removed and found already there', async () => {
    vi.mocked(bindingProjectIds).mockResolvedValue(['p-1']);
    vi.mocked(listProjects).mockResolvedValue([
      projectRow('p-1'),
      projectRow('p-2'),
      projectRow('p-3'),
    ] as never);
    vi.mocked(loadProjectOrThrow).mockImplementation(async (_sql, id) =>
      projectRow(id),
    );
    vi.mocked(unbindProjectInTx).mockResolvedValue({ unbound: true });
    vi.mocked(bindProjectInTx).mockImplementation(async (_tx, args) => ({
      bound: args.projectId === 'p-2',
    }));
    expect(
      await store().setAutomationProjects?.(NAME, {
        add: ['p-2', 'p-3'],
        remove: ['p-1'],
      }),
    ).toEqual({ added: ['p-2'], removed: ['p-1'], unchanged: ['p-3'] });
    expect(unbindProjectInTx).toHaveBeenCalledWith(expect.anything(), {
      organizationId: ORG,
      name: NAME,
      projectId: 'p-1',
      actor: 'api-key:user-1',
    });
  });
});

describe('answerAsk', () => {
  const run = {
    id: 'run-1',
    name: NAME,
    projectId: null as string | null,
  };

  it('answers an organization run as the key holder', async () => {
    vi.mocked(getRun).mockResolvedValue(run as never);
    vi.mocked(answerRunAskAs).mockResolvedValue({
      runId: 'run-1',
      askId: 'ask-1',
      taskId: null,
    });
    await store({ role: 'member' }).answerAsk?.('run-1', 'ask-1', 'Yes');
    expect(answerRunAskAs).toHaveBeenCalledWith(expect.anything(), {
      organizationId: ORG,
      run,
      askId: 'ask-1',
      answer: 'Yes',
      answeredBy: 'api-key:user-1',
      author: expect.objectContaining({ userId: 'user-1', role: 'member' }),
    });
  });

  it('answers a hidden project run as not found, and a read-only project run as refused', async () => {
    vi.mocked(getRun).mockResolvedValue({
      ...run,
      projectId: 'p-hidden',
    } as never);
    await expect(
      store().answerAsk?.('run-1', 'ask-1', 'Yes'),
    ).rejects.toMatchObject({ code: 'RUN_NOT_FOUND' });
    vi.mocked(getRun).mockResolvedValue({ ...run, projectId: 'p-ro' } as never);
    await expect(
      store().answerAsk?.('run-1', 'ask-1', 'Yes'),
    ).rejects.toMatchObject({ code: 'RBAC_FORBIDDEN' });
    expect(answerRunAskAs).not.toHaveBeenCalled();
  });
});

describe('listRunsPage', () => {
  it('pages with a cursor signed for this listing in this organization', async () => {
    vi.mocked(listRunsPage).mockResolvedValue({
      runs: [],
      isDone: false,
      next: { at: 1_700_000_000_000, id: 'run-9' },
    });
    const first = await store().listRunsPage?.({ name: NAME, mode: 'mock' });
    expect(listRunsPage).toHaveBeenCalledWith(expect.anything(), ORG, {
      name: NAME,
      mode: 'mock',
      visibleProjectIds: ['p-1', 'p-ro'],
      limit: 50,
    });
    const cursor = first?.nextCursor ?? '';
    expect(cursor).not.toBe('');

    vi.mocked(listRunsPage).mockClear();
    await store().listRunsPage?.({ name: NAME, mode: 'mock', cursor });
    expect(listRunsPage).toHaveBeenCalledWith(
      expect.anything(),
      ORG,
      expect.objectContaining({
        before: { at: 1_700_000_000_000, id: 'run-9' },
      }),
    );
  });

  it('refuses a forged cursor, one from another listing, and one minted in another organization', async () => {
    const position = '1700000000000:run-9';
    const list = `mcp-runs:all:${NAME}:mock:`;
    for (const cursor of [
      'forged',
      mintCursorFor(ORG, 'mcp-runs:all:other:mock:', position),
      mintCursorFor('org-2', list, position),
    ]) {
      expect(
        await store().listRunsPage?.({ name: NAME, mode: 'mock', cursor }),
      ).toBeNull();
    }
    expect(listRunsPage).not.toHaveBeenCalled();
    expect(
      await store().listRunsPage?.({
        name: NAME,
        mode: 'mock',
        cursor: mintCursorFor(ORG, list, position),
      }),
    ).not.toBeNull();
  });
});
