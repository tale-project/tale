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

import { dispatch } from '../../../lib/engine/api/dispatch.ts';
import { mintCursorFor } from '../../core/lib/signed_cursor.ts';
import { RateLimitExceededError } from '../../lib/rate-limit.ts';
import { mcpOrigin } from '../../lib/write-origin.ts';
import {
  assertWritable,
  listProjects,
  loadProjectOrThrow,
  ProjectError,
  type ProjectRow,
} from '../projects/service.ts';
import { answerRunAskAs } from './ask-answer.ts';
import { memberNamesOf } from './author-names.ts';
import { admitBenchRuns } from './bench.ts';
import { recentDeployments } from './deployments.ts';
import { pgAutomationStore } from './dispatch-store.ts';
import {
  bindingProjectIds,
  bindProjectInTx,
  deleteAutomationCascade,
  deploy,
  deployedVersion,
  getPendingAskForRun,
  getRun,
  listRunsPage,
  listTriggers,
  listVersions,
  saveVersion,
  unbindProjectInTx,
  versionRow,
} from './store.ts';
import { listVersionHistory } from './versions.ts';

vi.mock('./store.ts', async (original) => ({
  ...(await original<typeof import('./store.ts')>()),
  bindingProjectIds: vi.fn(),
  bindProjectInTx: vi.fn(),
  deleteAutomationCascade: vi.fn(),
  deploy: vi.fn(),
  deployedVersion: vi.fn(),
  getPendingAskForRun: vi.fn(),
  getRun: vi.fn(),
  listRunsPage: vi.fn(),
  listTriggers: vi.fn(),
  listVersions: vi.fn(),
  saveVersion: vi.fn(),
  unbindProjectInTx: vi.fn(),
  versionRow: vi.fn(),
}));
vi.mock('./ask-answer.ts', () => ({ answerRunAskAs: vi.fn() }));
vi.mock('./author-names.ts', () => ({ memberNamesOf: vi.fn() }));
vi.mock('./bench.ts', () => ({ admitBenchRuns: vi.fn() }));
vi.mock('./versions.ts', async (original) => ({
  ...(await original<typeof import('./versions.ts')>()),
  listVersionHistory: vi.fn(),
}));
vi.mock('./audit.ts', () => ({
  auditDefinitionWrite: vi.fn(),
}));
vi.mock('./deployments.ts', () => ({
  recentDeployments: vi.fn(),
}));
vi.mock('../projects/service.ts', async (original) => ({
  ...(await original<typeof import('../projects/service.ts')>()),
  assertWritable: vi.fn(),
  listProjects: vi.fn(),
  loadProjectOrThrow: vi.fn(),
}));

const ORG = 'org-1';
const NAME = 'hr/onboarding';
/** The coding agent's door the store records on every write it makes. */
const ORIGIN = mcpOrigin({
  userId: 'user-1',
  apiKeyId: 'key-1',
  clientName: 'Claude Code',
});

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
    origin: ORIGIN,
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
  vi.mocked(recentDeployments).mockResolvedValue([]);
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
    expect(await s.listVersionHistory?.(NAME)).toEqual({
      versions: [],
      nextBefore: null,
      latestVersion: null,
      deployedVersion: null,
    });
    expect(listVersionHistory).not.toHaveBeenCalled();
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
        repeat: null,
        startDate: null,
        timezone: null,
        catchUp: 'latest',
        event: null,
        input: null,
        hasToken: true,
        enabled: true,
        lastFiredAt: null,
        lastRunId: null,
        lastSkippedAt: null,
        lastSkipReason: null,
        lastSkipDetail: null,
        nextRunAt: null,
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

describe('listVersionHistory', () => {
  const record = (version: number, createdBy: string) => ({
    version,
    message: `cut ${String(version)}`,
    createdBy,
    createdAt: 1_000 + version,
    via: 'mcp' as const,
    viaInferred: false,
    apiKeyId: 'key-1',
    clientName: 'Claude Code',
    basedOnVersion: version > 1 ? version - 1 : null,
    restoredFromVersion: null,
    changes: { nodes: { added: 0, removed: 0, changed: 1 } },
    testsPassed: true,
    testsCheckedAt: 5,
    tests: { passed: 2, failed: 0, total: 2, via: 'save' as const },
    live: version === 6,
    lastDeployedAt: version === 6 ? 6_000 : null,
  });

  it('answers a page as the app reads it, each row with the name of the member who saved it [MCP-R30]', async () => {
    vi.mocked(listVersionHistory).mockResolvedValue({
      versions: [record(7, 'api-key:user-1'), record(6, 'system:pack')],
      nextBefore: 6,
      latestVersion: 7,
      deployedVersion: 6,
    });
    vi.mocked(memberNamesOf).mockResolvedValue(
      new Map([
        ['api-key:user-1', 'Ada Lovelace'],
        ['system:pack', null],
      ]),
    );
    const page = await store().listVersionHistory?.(NAME, {
      limit: 2,
      before: 8,
    });
    expect(listVersionHistory).toHaveBeenCalledWith(
      expect.anything(),
      ORG,
      NAME,
      {
        limit: 2,
        before: 8,
      },
    );
    expect(memberNamesOf).toHaveBeenCalledWith(expect.anything(), ORG, [
      'api-key:user-1',
      'system:pack',
    ]);
    expect(page).toMatchObject({
      nextBefore: 6,
      latestVersion: 7,
      deployedVersion: 6,
    });
    expect(page?.versions[0]).toMatchObject({
      version: 7,
      createdBy: 'api-key:user-1',
      createdByName: 'Ada Lovelace',
      createdVia: 'mcp',
      clientName: 'Claude Code',
      basedOnVersion: 6,
      restoredFromVersion: null,
      tests: { passed: 2, failed: 0, total: 2 },
      deployed: false,
    });
    expect(page?.versions[1]).toMatchObject({
      version: 6,
      createdByName: null,
      deployed: true,
      lastDeployedAt: 6_000,
    });
  });

  it('reads a bounded batch even when the complete history is empty', async () => {
    vi.mocked(listVersionHistory).mockResolvedValue({
      versions: [],
      nextBefore: null,
      latestVersion: null,
      deployedVersion: null,
    });
    vi.mocked(memberNamesOf).mockResolvedValue(new Map());
    await store().listVersionHistory?.(NAME);
    expect(listVersionHistory).toHaveBeenCalledWith(
      expect.anything(),
      ORG,
      NAME,
      { limit: 200 },
    );
  });

  /** The maintained database reader's defaults: 50 rows unless a bounded
   * page is named, and the last row as the cursor while older rows remain.
   * The production adapter and actual dispatch run over this reader double. */
  function historyOf(count: number) {
    const all = Array.from({ length: count }, (_, index) =>
      record(count - index, index % 2 === 0 ? 'api-key:user-1' : 'system:pack'),
    );
    vi.mocked(listVersionHistory).mockImplementation(
      async (_sql, _organization, _name, page = {}) => {
        const older = all.filter(
          (row) => page.before === undefined || row.version < page.before,
        );
        const versions = older.slice(0, page.limit ?? 50);
        return {
          versions,
          nextBefore:
            versions.length < older.length ? versions.at(-1)!.version : null,
          latestVersion: count,
          deployedVersion: 6,
        };
      },
    );
    vi.mocked(memberNamesOf).mockResolvedValue(
      new Map([
        ['api-key:user-1', 'Ada Lovelace'],
        ['system:pack', null],
      ]),
    );
    return all;
  }

  it.each([51, 205])(
    'actual dispatch over the PG adapter returns all %i retained versions when limit is omitted [MCP-R30]',
    async (count) => {
      const all = historyOf(count);
      const result = await dispatch(
        'list_versions',
        { name: NAME },
        {
          store: store(),
        },
      );
      expect(result).toMatchObject({
        latestVersion: count,
        deployedVersion: 6,
        nextBefore: null,
        versions: all.map((row) => ({
          version: row.version,
          createdByName:
            row.createdBy === 'system:pack' ? null : 'Ada Lovelace',
          basedOnVersion: row.basedOnVersion,
          changes: row.changes,
          tests: row.tests,
          deployed: row.live,
          lastDeployedAt: row.lastDeployedAt,
        })),
      });
      expect(listVersionHistory).toHaveBeenNthCalledWith(
        1,
        expect.anything(),
        ORG,
        NAME,
        { limit: 200 },
      );
      expect(listVersionHistory).toHaveBeenCalledTimes(Math.ceil(count / 200));
      if (count > 200) {
        expect(listVersionHistory).toHaveBeenNthCalledWith(
          2,
          expect.anything(),
          ORG,
          NAME,
          { limit: 200, before: 6 },
        );
      }
    },
  );

  it('returns every older retained version when before is given without a limit', async () => {
    const all = historyOf(240);
    const result = await dispatch(
      'list_versions',
      { name: NAME, before: 211 },
      {
        store: store(),
      },
    );
    expect(result).toMatchObject({
      latestVersion: 240,
      deployedVersion: 6,
      nextBefore: null,
      versions: all
        .filter((row) => row.version < 211)
        .map((row) => ({ version: row.version })),
    });
    expect(listVersionHistory).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      ORG,
      NAME,
      { limit: 200, before: 211 },
    );
    expect(listVersionHistory).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      ORG,
      NAME,
      { limit: 200, before: 11 },
    );
    expect(listVersionHistory).toHaveBeenCalledTimes(2);
  });

  it.each([1, 200])(
    'an explicit limit of %i remains one page with its next cursor',
    async (limit) => {
      const all = historyOf(205);
      const result = await dispatch(
        'list_versions',
        { name: NAME, limit },
        {
          store: store(),
        },
      );
      expect(result).toMatchObject({
        latestVersion: 205,
        nextBefore: 206 - limit,
        versions: all.slice(0, limit).map((row) => ({ version: row.version })),
      });
      expect(listVersionHistory).toHaveBeenCalledTimes(1);
      expect(listVersionHistory).toHaveBeenCalledWith(
        expect.anything(),
        ORG,
        NAME,
        { limit },
      );
    },
  );

  it('keeps the latest and live pointers of the first page while exhausting the history', async () => {
    historyOf(205);
    const reader = vi.mocked(listVersionHistory).getMockImplementation()!;
    vi.mocked(listVersionHistory).mockImplementation(async (...args) => {
      const page = await reader(...args);
      return args[3]?.before === undefined
        ? page
        : {
            ...page,
            latestVersion: 206,
            deployedVersion: 3,
            versions: page.versions.map((row) =>
              Object.assign(row, {
                live: row.version === 3,
              }),
            ),
          };
    });
    const result = await store().listVersionHistory?.(NAME);
    expect(result).toMatchObject({
      latestVersion: 205,
      deployedVersion: 6,
      nextBefore: null,
    });
    expect(result?.versions.find((row) => row.version === 6)?.deployed).toBe(
      true,
    );
    expect(result?.versions.find((row) => row.version === 3)?.deployed).toBe(
      false,
    );
  });

  it.each([
    ['an empty page with a cursor', [], 6],
    ['a cursor outside the page', [record(7, 'system:pack')], 6],
    ['a cursor that repeats the boundary', [record(7, 'system:pack')], 7],
  ] as const)(
    'refuses %s instead of claiming a complete history',
    async (_what, versions, nextBefore) => {
      vi.mocked(listVersionHistory).mockResolvedValue({
        versions: [...versions],
        nextBefore,
        latestVersion: 7,
        deployedVersion: null,
      });
      vi.mocked(memberNamesOf).mockResolvedValue(new Map());
      await expect(
        store().listVersionHistory?.(NAME, { before: 7 }),
      ).rejects.toThrow('version history did not advance');
      expect(listVersionHistory).toHaveBeenCalledTimes(1);
      expect(memberNamesOf).not.toHaveBeenCalled();
    },
  );

  it('refuses a repeated cursor on a later page', async () => {
    vi.mocked(listVersionHistory)
      .mockResolvedValueOnce({
        versions: [record(6, 'system:pack')],
        nextBefore: 6,
        latestVersion: 7,
        deployedVersion: null,
      })
      .mockResolvedValueOnce({
        versions: [record(5, 'system:pack')],
        nextBefore: 6,
        latestVersion: 7,
        deployedVersion: null,
      });
    vi.mocked(memberNamesOf).mockResolvedValue(new Map());
    await expect(store().listVersionHistory?.(NAME)).rejects.toThrow(
      'version history did not advance',
    );
    expect(listVersionHistory).toHaveBeenCalledTimes(2);
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
      message: 'why',
      baseVersion: 7,
      create: true,
      metadataMode: 'carry',
      presentation: null,
      origin: ORIGIN,
      authorize: expect.any(Function),
    });
  });

  it('records a restore as based on and restored from the older version, and saves nothing when the latest already is that content', async () => {
    vi.mocked(saveVersion).mockResolvedValue({
      name: NAME,
      version: 7,
      unchanged: true,
    });
    const saved = await store().save(doc as never, 'Restore v3', {
      testsPassed: true,
      restoredFrom: 3,
      metadata: {
        settings: { forms: [] },
        taskContract: null,
        presentation: null,
      },
    });
    expect(saved).toMatchObject({ version: 7, unchanged: true });
    expect(saveVersion).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        basedOnVersion: 3,
        restoredFromVersion: 3,
        unlessIdentical: true,
        testsPassed: true,
        metadataMode: 'carry',
        settings: { forms: [] },
        taskContract: null,
        presentation: null,
      }),
    );
  });

  it('saves a restore under the automation it restores, never on the one an old document names', async () => {
    vi.mocked(saveVersion).mockResolvedValue({ name: NAME, version: 8 });
    await store().save(
      { version: 1 as const, name: 'someone/else', nodes: [] } as never,
      'Restore v3',
      { restoredFrom: 3, name: NAME },
    );
    const args = vi.mocked(saveVersion).mock.calls.at(-1)?.[1];
    expect(args).toMatchObject({
      organizationId: ORG,
      name: NAME,
      restoredFromVersion: 3,
    });
    // An ordinary save still names the automation by its document.
    await store().save(doc as never, 'why');
    expect(vi.mocked(saveVersion).mock.calls.at(-1)?.[1]).toMatchObject({
      name: NAME,
    });
  });

  it('saves an ordinary version without a restore’s marks', async () => {
    vi.mocked(saveVersion).mockResolvedValue({ name: NAME, version: 8 });
    await store().save(doc as never, 'why');
    const args = vi.mocked(saveVersion).mock.calls.at(-1)?.[1];
    expect(args).not.toHaveProperty('restoredFromVersion');
    expect(args).not.toHaveProperty('basedOnVersion');
    expect(args).not.toHaveProperty('unlessIdentical');
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
      kind: 'deploy',
      deploymentId: 'deployment-1',
      trigger: null,
    });
    await store().deploy(NAME, 7, {
      testsPassed: true,
      expectedDeployedVersion: 6,
    });
    expect(deploy).toHaveBeenCalledWith(expect.anything(), {
      organizationId: ORG,
      name: NAME,
      version: 7,
      origin: ORIGIN,
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
      origin: ORIGIN,
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
      origin: ORIGIN,
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

/**
 * A run waiting on a person's answer names the question in `get_run` — the
 * only place an agent learns the `askId` `answer_run_ask` needs (the REST
 * door has `GET /runs/{id}/ask`). Read only for a run that waits on one.
 */
describe('getRun names the question a waiting run asks', () => {
  const waitingRow = {
    id: 'run-7',
    name: NAME,
    version: 3,
    projectId: null as string | null,
    status: 'waiting',
    mode: 'live',
    startedBy: 'api-key:user-1',
    input: { _tale: {} },
    output: null,
    trace: null,
    effects: null,
    detail: 'agent:review',
    failureCode: null,
    startedAt: 1,
    finishedAt: null,
    askPending: true,
    resumeCount: 0,
    lastResumeReason: null,
    lastResumedAt: null,
    stalled: false,
  };
  const pending = {
    askId: 'ask-42',
    runId: 'run-7',
    nodeId: 'review',
    question: 'Send the reminder to Acme today?',
    createdAt: 10,
    expiresAt: 20,
  };

  it("Ada's agent reads the question her run asks, with the askId to answer it [MCP-R27]", async () => {
    vi.mocked(getRun).mockResolvedValue(waitingRow as never);
    vi.mocked(getPendingAskForRun).mockResolvedValue(pending);
    const run = await store().getRun?.('run-7');
    expect(run).toMatchObject({
      waitingFor: 'ask',
      ask: {
        askId: 'ask-42',
        nodeId: 'review',
        question: 'Send the reminder to Acme today?',
        expiresAt: 20,
      },
    });
    expect(run?.ask).not.toHaveProperty('runId');
    expect(getPendingAskForRun).toHaveBeenCalledWith(
      expect.anything(),
      ORG,
      'run-7',
    );
  });

  it('reads no question for a run that waits on none, and none of a run the person cannot see', async () => {
    vi.mocked(getRun).mockResolvedValue({
      ...waitingRow,
      askPending: false,
    } as never);
    expect(await store().getRun?.('run-7')).not.toHaveProperty('ask');
    vi.mocked(getRun).mockResolvedValue({
      ...waitingRow,
      projectId: 'p-hidden',
    } as never);
    expect(await store().getRun?.('run-7')).toBeNull();
    expect(getPendingAskForRun).not.toHaveBeenCalled();
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

/**
 * Nothing of another organization is reachable through the store: every
 * read and write is keyed by the caller's own organization, and a project
 * or run id that belongs to another answers "not found" before anything
 * is written. Bea's key is for org-2; `hr/onboarding`, its project p-1 and
 * run-1 belong to org-1.
 */
describe("another organization's automations, projects and runs stay out of reach", () => {
  beforeEach(() => {
    vi.mocked(versionRow).mockImplementation(
      async (_sql, org, _name, version) =>
        org === ORG ? versionOf(version ?? 7) : null,
    );
    vi.mocked(recentDeployments).mockImplementation(async (_sql, org) =>
      org === ORG
        ? [
            {
              version: 7,
              previousVersion: 6,
              deployedAt: 1,
              deployedBy: 'user-1',
              via: null,
            },
          ]
        : [],
    );
    vi.mocked(getRun).mockImplementation(async (_sql, org) =>
      org === ORG
        ? ({ id: 'run-1', name: NAME, projectId: null } as never)
        : null,
    );
  });
  const bea = () => store({ organizationId: 'org-2' });

  it("reads org-1's automation and its deployments as nothing", async () => {
    expect(await bea().getVersionView?.(NAME)).toBeNull();
    expect(await bea().listDeployments?.(NAME)).toEqual([]);
    expect(versionRow).toHaveBeenCalledWith(
      expect.anything(),
      'org-2',
      NAME,
      undefined,
    );
    expect(recentDeployments).toHaveBeenCalledWith(
      expect.anything(),
      'org-2',
      NAME,
    );
  });

  it("deletes only within org-2, never org-1's automation of the same name", async () => {
    vi.mocked(deleteAutomationCascade).mockResolvedValue({ versions: 0 });
    await bea().deleteAutomation?.(NAME, 7);
    expect(deleteAutomationCascade).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: 'org-2', name: NAME }),
    );
  });

  it("refuses to install into org-1's project as not found, and installs nothing", async () => {
    vi.mocked(loadProjectOrThrow).mockImplementation(async (_sql, id) => ({
      ...projectRow(id),
      organizationId: ORG,
    }));
    await expect(
      bea().setAutomationProjects?.(NAME, { add: ['p-1'], remove: [] }),
    ).rejects.toMatchObject({ code: 'PROJECT_NOT_FOUND' });
    expect(bindProjectInTx).not.toHaveBeenCalled();
    expect(unbindProjectInTx).not.toHaveBeenCalled();
  });

  it("answers org-1's run as not found, and records no answer", async () => {
    await expect(
      bea().answerAsk?.('run-1', 'ask-1', 'Yes'),
    ).rejects.toMatchObject({ code: 'RUN_NOT_FOUND' });
    expect(getRun).toHaveBeenCalledWith(expect.anything(), 'org-2', 'run-1');
    expect(answerRunAskAs).not.toHaveBeenCalled();
  });
});

describe('admitBench', () => {
  it("asks for room for the runs in the store's own organization, and hands back the release", async () => {
    const release = vi.fn();
    vi.mocked(admitBenchRuns).mockResolvedValue(release);
    const room = await store({ organizationId: 'org-2' }).admitBench?.(3);
    expect(admitBenchRuns).toHaveBeenCalledWith(expect.anything(), 'org-2', 3);
    expect(room).toBe(release);
  });

  it('answers how long to wait when the budget is spent or every place is taken', async () => {
    vi.mocked(admitBenchRuns).mockRejectedValue(
      new RateLimitExceededError('spent', 1_500),
    );
    expect(await store().admitBench?.(1)).toEqual({ retryAfterMs: 1_500 });
  });

  it('lets a fault through as the fault it is', async () => {
    vi.mocked(admitBenchRuns).mockRejectedValue(
      new Error('connection refused'),
    );
    await expect(store().admitBench?.(1)).rejects.toThrow('connection refused');
  });
});
