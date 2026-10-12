import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  compareVersions,
  dispatch,
  type DispatchStore,
  type VersionSummary,
  type VersionView,
} from './dispatch';
import { DOC_EXAMPLE } from './docs';
import { runAutomationTests } from './tests';

vi.mock('./tests', () => ({ runAutomationTests: vi.fn() }));

/**
 * What a coding agent reads and does with versions through the method
 * table: the history a page at a time, when each version went live, two
 * versions compared, an older version brought back as the newest. Each is
 * held to what the app's version screens show; the host behind the store
 * is a double — what it keeps and records is its own tests'.
 */

const NAME = 'billing/dunning';
const DOC = { ...DOC_EXAMPLE.automation, name: NAME };

/** The document as saved in version `n`: only its description differs. */
const docOf = (n: number) => ({ ...DOC, description: `version ${String(n)}` });

/** A store holding `billing/dunning` at v7, v5 deployed. */
function store(overrides: Partial<DispatchStore> = {}): DispatchStore {
  return {
    list: async () => [{ name: NAME, latest: 7, deployedVersion: 5 }],
    get: async (name: string, version?: number) =>
      name === NAME && (version === undefined || (version >= 1 && version <= 7))
        ? { meta: { version: version ?? 7 }, automation: docOf(version ?? 7) }
        : null,
    deployedVersion: async (name: string) => (name === NAME ? 5 : null),
    save: async () => ({ name: NAME, version: 8 }),
    deploy: async (name: string, version: number) => ({
      name,
      version,
      previousVersion: 5,
    }),
    ...overrides,
  };
}

const row = (version: number): VersionSummary => ({
  version,
  message: `cut ${String(version)}`,
  createdBy: 'user_ada',
  createdAt: 1_000 + version,
  createdVia: 'mcp',
  clientName: 'Claude Code',
  viaInferred: false,
  basedOnVersion: version - 1 || null,
  restoredFromVersion: null,
  changes: { nodes: { added: 0, removed: 0, changed: 1 } },
  tests: null,
  deployed: version === 5,
  lastDeployedAt: version === 5 ? 5_000 : null,
});

beforeEach(() => {
  vi.mocked(runAutomationTests).mockReset();
  vi.mocked(runAutomationTests).mockResolvedValue({
    passed: 1,
    failed: 0,
    results: [{ name: 'ok', pass: true, index: 0, ms: 1 }],
  });
});

describe('list_versions pages', () => {
  it('asks the host for a page and answers it with where the next one starts [MCP-R30]', async () => {
    const listVersionHistory = vi.fn(async () => ({
      versions: [row(6), row(5)],
      nextBefore: 5,
      latestVersion: 7,
      deployedVersion: 5,
    }));
    const result = await dispatch(
      'list_versions',
      { name: NAME, limit: 2, before: 7 },
      { store: store({ listVersionHistory }) },
    );
    expect(listVersionHistory).toHaveBeenCalledWith(NAME, {
      limit: 2,
      before: 7,
    });
    expect(result).toEqual({
      deployedVersion: 5,
      latestVersion: 7,
      versions: [row(6), row(5)],
      nextBefore: 5,
    });
  });

  it('asks for no page when the call names none, so the history is complete', async () => {
    const listVersionHistory = vi.fn(async () => ({
      versions: [row(2), row(1)],
      nextBefore: null,
      latestVersion: 2,
      deployedVersion: null,
    }));
    await dispatch(
      'list_versions',
      { name: NAME },
      { store: store({ listVersionHistory }) },
    );
    expect(listVersionHistory).toHaveBeenCalledWith(NAME, {});
  });

  it.each([
    ['a limit of zero', { limit: 0 }],
    ['a limit over the most one page holds', { limit: 201 }],
    ['a limit that is not a whole number', { limit: 1.5 }],
    ['a start that is not a version number', { before: 'x' }],
    ['a start below the first version', { before: 0 }],
  ])('refuses %s', async (_what, params) => {
    const listVersionHistory = vi.fn();
    const result = await dispatch(
      'list_versions',
      { name: NAME, ...params },
      { store: store({ listVersionHistory }) },
    );
    expect(result).toMatchObject({
      code: 'INVALID_PARAMS',
      hint: expect.stringContaining('limit'),
    });
    expect(listVersionHistory).not.toHaveBeenCalled();
  });

  it('keeps the deployments beside the history it always answered', async () => {
    const deployments = [
      {
        version: 5,
        previousVersion: 4,
        deployedAt: 3,
        deployedBy: 'user_ben',
        via: null,
      },
    ];
    const result = await dispatch(
      'list_versions',
      { name: NAME },
      {
        store: store({
          listVersions: async () => [],
          listDeployments: async () => deployments,
        }),
      },
    );
    expect(result).toEqual({
      deployedVersion: 5,
      latestVersion: null,
      versions: [],
      nextBefore: null,
      deployments,
    });
  });

  it('answers the latest version of a host that lists whole histories only', async () => {
    const result = await dispatch(
      'list_versions',
      { name: NAME },
      {
        store: store({
          listVersions: async () => [
            { version: 2, createdBy: 'u', createdAt: 2 },
            { version: 1, createdBy: 'u', createdAt: 1 },
          ],
        }),
      },
    );
    expect(result).toMatchObject({
      latestVersion: 2,
      nextBefore: null,
      deployedVersion: 5,
    });
  });
});

describe('comparing two versions', () => {
  it('compares the latest version with the one saved before it [MCP-R31]', async () => {
    const base = store();
    const get = vi.fn((name: string, version?: number) =>
      base.get(name, version),
    );
    const result = await compareVersions(store({ get }), { name: NAME });
    expect(get).toHaveBeenCalledWith(NAME, 6);
    expect(get).toHaveBeenCalledWith(NAME, 7);
    expect(result).toMatchObject({
      name: NAME,
      from: 6,
      to: 7,
      identical: false,
      first: false,
      description: { field: 'description', kind: 'changed' },
    });
    expect(result).not.toHaveProperty('unified');
  });

  it('reads the aliases: the live version, the latest, the one before another', async () => {
    expect(
      await compareVersions(store(), {
        name: NAME,
        from: 'deployed',
        to: 'latest',
      }),
    ).toMatchObject({ from: 5, to: 7 });
    expect(
      await compareVersions(store(), { name: NAME, from: 'previous', to: 3 }),
    ).toMatchObject({ from: 2, to: 3 });
    // A REST query hands numbers over as text.
    expect(
      await compareVersions(store(), { name: NAME, from: '2', to: '4' }),
    ).toMatchObject({ from: 2, to: 4 });
  });

  it('compares the first version with nothing', async () => {
    expect(await compareVersions(store(), { name: NAME, to: 1 })).toMatchObject(
      { from: null, to: 1, first: true },
    );
  });

  it('says two equal versions are identical', async () => {
    const same = store({
      get: async (name, version) =>
        name === NAME
          ? { meta: { version: version ?? 7 }, automation: DOC }
          : null,
    });
    expect(await compareVersions(same, { name: NAME })).toMatchObject({
      identical: true,
      counts: { changed: 0 },
    });
  });

  it('answers the patch between the two versions as YAML in the unified format', async () => {
    const result = await compareVersions(store(), {
      name: NAME,
      format: 'unified',
    });
    expect(result).toMatchObject({ name: NAME, from: 6, to: 7 });
    expect(result.unified).toEqual(expect.stringContaining('--- v6'));
    expect(result.unified).toEqual(expect.stringContaining('+++ v7'));
    expect(result.unified).toEqual(
      expect.stringContaining('+description: version 7'),
    );
    // The patch stands for the changes: neither is sent twice.
    expect(result).not.toHaveProperty('nodes');
  });

  it('answers both in the format that says both', async () => {
    const result = await compareVersions(store(), {
      name: NAME,
      format: 'both',
    });
    expect(result).toHaveProperty('nodes');
    expect(result).toHaveProperty('unified');
  });

  it('marks a patch it had to cut', async () => {
    const big = (version: number) => ({
      meta: { version },
      automation: {
        ...DOC,
        nodes: [
          {
            id: 'long',
            type: 'transform',
            code: `return ${JSON.stringify('x'.repeat(40_000))}.length + ${String(version)};\n`.repeat(
              12,
            ),
          },
        ],
      },
    });
    const result = await compareVersions(
      store({
        get: async (name, version) =>
          name === NAME ? big(version ?? 7) : null,
      }),
      { name: NAME, format: 'unified' },
    );
    expect(result).toMatchObject({ truncated: true });
  });

  it('compares what a version keeps beside its document when the host has it', async () => {
    const view = (version: number): VersionView => ({
      name: NAME,
      version,
      latestVersion: 7,
      deployedVersion: 5,
      document: docOf(version),
      settings: version === 7 ? { forms: ['a'] } : null,
      taskContract: null,
      presentation: null,
      message: null,
      testsPassed: null,
      testsCheckedAt: null,
      createdBy: 'u',
      createdAt: 1,
      createdVia: 'mcp',
      clientName: null,
      projectIds: [],
      trigger: null,
    });
    const result = await compareVersions(
      store({ getVersionView: async (_n, v) => view(v ?? 7) }),
      { name: NAME },
    );
    expect(result).toMatchObject({
      package: [
        expect.objectContaining({ field: expect.stringContaining('settings') }),
      ],
    });
  });

  it('refuses a version the automation never had, and a live version when none is live', async () => {
    expect(
      await compareVersions(store(), { name: NAME, from: 2, to: 9 }),
    ).toMatchObject({
      code: 'AUTOMATION_VERSION_UNKNOWN',
      hint: expect.stringContaining('list_versions'),
    });
    expect(
      await compareVersions(store({ deployedVersion: async () => null }), {
        name: NAME,
        from: 'deployed',
      }),
    ).toMatchObject({ code: 'AUTOMATION_NOT_DEPLOYED' });
    expect(await compareVersions(store(), { name: 'nope' })).toMatchObject({
      code: 'AUTOMATION_NOT_FOUND',
    });
  });

  it('refuses an alias or a format it does not know, and a previous version of to', async () => {
    expect(
      await compareVersions(store(), { name: NAME, from: 'newest' }),
    ).toMatchObject({ code: 'INVALID_PARAMS' });
    expect(
      await compareVersions(store(), { name: NAME, format: 'html' }),
    ).toMatchObject({ code: 'INVALID_PARAMS' });
    expect(
      await compareVersions(store(), { name: NAME, to: 'previous' }),
    ).toMatchObject({ code: 'INVALID_PARAMS' });
  });
});

describe('get_automation against another version', () => {
  it('answers the version beside what it changed against the one named [MCP-R31]', async () => {
    const result = (await dispatch(
      'get_automation',
      { name: NAME, version: 6, against: 'previous' },
      { store: store() },
    )) as Record<string, unknown>;
    expect(result).toMatchObject({
      meta: { version: 6 },
      automation: docOf(6),
      diff: { name: NAME, from: 5, to: 6, identical: false },
    });
  });

  it('reads the live version against the latest the way a deploy would change it', async () => {
    const result = await dispatch(
      'get_automation',
      { name: NAME, against: 'deployed' },
      { store: store() },
    );
    expect(result).toMatchObject({
      meta: { version: 7 },
      diff: { from: 5, to: 7 },
    });
  });

  it('answers the unified patch when it is asked for', async () => {
    const result = (await dispatch(
      'get_automation',
      { name: NAME, version: 7, against: 6, diffFormat: 'unified' },
      { store: store() },
    )) as { diff: Record<string, unknown> };
    expect(result.diff.unified).toEqual(expect.stringContaining('+++ v7'));
    expect(result.diff).not.toHaveProperty('nodes');
  });

  it('answers the refusal when the comparison cannot be made, and the plain read without against', async () => {
    expect(
      await dispatch(
        'get_automation',
        { name: NAME, against: 99 },
        { store: store() },
      ),
    ).toMatchObject({ code: 'AUTOMATION_VERSION_UNKNOWN' });
    expect(
      await dispatch('get_automation', { name: NAME }, { store: store() }),
    ).not.toHaveProperty('diff');
  });
});

describe('save_automation restoring a version', () => {
  const view: VersionView = {
    name: NAME,
    version: 3,
    latestVersion: 7,
    deployedVersion: 5,
    document: docOf(3),
    settings: { forms: [] },
    taskContract: { workflow: NAME },
    presentation: { name: 'Dunning' },
    message: 'third',
    testsPassed: true,
    testsCheckedAt: 1,
    createdBy: 'user_ada',
    createdAt: 2,
    createdVia: 'app',
    clientName: null,
    projectIds: [],
    trigger: null,
  };

  it('saves an older version as the newest, with what it kept beside its document, and deploys nothing [MCP-R32]', async () => {
    const save = vi.fn(async () => ({ name: NAME, version: 8 }));
    const deploy = vi.fn();
    const result = await dispatch(
      'save_automation',
      {
        name: NAME,
        restoreVersion: 3,
        baseVersion: 7,
        message: 'back to three',
      },
      {
        store: store({
          save,
          deploy,
          getVersionView: async (_name, version) =>
            version === 3 ? view : null,
        }),
      },
    );
    expect(save).toHaveBeenCalledWith(docOf(3), 'back to three', {
      testsPassed: true,
      testReport: expect.objectContaining({ passed: 1 }),
      baseVersion: 7,
      restoredFrom: 3,
      // Under the automation it was asked to restore, whatever the
      // document names.
      name: NAME,
      metadata: {
        settings: { forms: [] },
        taskContract: { workflow: NAME },
        presentation: { name: 'Dunning' },
      },
    });
    expect(deploy).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      name: NAME,
      version: 8,
      restoredFrom: 3,
      testsPassed: true,
    });
    expect(result).not.toHaveProperty('unchanged');
  });

  it('words the version itself when the call gives no message', async () => {
    const save = vi.fn(async () => ({ name: NAME, version: 8 }));
    await dispatch(
      'save_automation',
      { name: NAME, restoreVersion: 3 },
      { store: store({ save }) },
    );
    expect(save).toHaveBeenCalledWith(
      docOf(3),
      'Restore v3',
      expect.objectContaining({ restoredFrom: 3 }),
    );
  });

  it('answers that nothing was saved when the latest version already is that content', async () => {
    const result = await dispatch(
      'save_automation',
      { name: NAME, restoreVersion: 7 },
      {
        store: store({
          save: async () => ({ name: NAME, version: 7, unchanged: true }),
        }),
      },
    );
    expect(result).toMatchObject({
      name: NAME,
      version: 7,
      restoredFrom: 7,
      unchanged: true,
    });
  });

  it('refuses what a restore does not take beside restoreVersion, and a call without the name', async () => {
    const save = vi.fn();
    for (const extra of [
      { automation: DOC },
      { settings: { forms: [] } },
      { taskContract: null },
      { presentation: null },
      { create: true },
      { projectId: 'p-1' },
    ]) {
      expect(
        await dispatch(
          'save_automation',
          { name: NAME, restoreVersion: 3, ...extra },
          { store: store({ save }) },
        ),
      ).toMatchObject({
        code: 'INVALID_PARAMS',
        hint: expect.stringContaining('restoreVersion'),
      });
    }
    expect(
      await dispatch(
        'save_automation',
        { restoreVersion: 3 },
        { store: store({ save }) },
      ),
    ).toMatchObject({ code: 'INVALID_PARAMS' });
    expect(save).not.toHaveBeenCalled();
  });

  it('refuses a version the automation never had', async () => {
    const save = vi.fn();
    const result = await dispatch(
      'save_automation',
      { name: NAME, restoreVersion: 9 },
      { store: store({ save }) },
    );
    expect(result).toMatchObject({
      code: 'AUTOMATION_VERSION_UNKNOWN',
      hint: expect.stringContaining('list_versions'),
    });
    expect(save).not.toHaveBeenCalled();
  });

  it('refuses a version that no longer validates, naming what is wrong, and saves nothing', async () => {
    const save = vi.fn();
    const result = await dispatch(
      'save_automation',
      { name: NAME, restoreVersion: 3 },
      {
        store: store({
          save,
          get: async () => ({
            meta: { version: 3 },
            automation: { ...DOC, nodes: [{ id: 'x', type: 'nope' }] },
          }),
        }),
      },
    );
    expect(result).toMatchObject({
      code: 'AUTOMATION_INVALID',
      errors: expect.any(Array),
    });
    expect(save).not.toHaveBeenCalled();
  });

  it('passes the host’s refusal of a stale base through as data', async () => {
    const result = await dispatch(
      'save_automation',
      { name: NAME, restoreVersion: 3, baseVersion: 5 },
      {
        store: store({
          save: async () => {
            throw Object.assign(new Error('v6 was saved since'), {
              code: 'AUTOMATION_VERSION_STALE',
              status: 409,
              data: { latestVersion: 6, baseVersion: 5 },
            });
          },
        }),
      },
    );
    expect(result).toMatchObject({
      code: 'AUTOMATION_VERSION_STALE',
      error: `v6 of "${NAME}" was saved after the version you read`,
      data: { latestVersion: 6, baseVersion: 5 },
      // The next step names tools the endpoint serves: the comparison is
      // get_automation's, and the restore is save_automation's.
      hint: `get_automation {name: "${NAME}", version: 6, against: "previous"} shows what v6 changed; restore again with baseVersion: 6 if the person still wants the older content back`,
    });
  });

  it('records the verdict of a restored version whose tests fail, as a save does', async () => {
    vi.mocked(runAutomationTests).mockResolvedValue({
      passed: 0,
      failed: 1,
      results: [{ name: 'ok', pass: false, index: 0, ms: 1 }],
    });
    const save = vi.fn(async () => ({ name: NAME, version: 8 }));
    const result = await dispatch(
      'save_automation',
      { name: NAME, restoreVersion: 3 },
      {
        store: store({
          save,
          get: async () => ({
            meta: { version: 3 },
            automation: {
              ...docOf(3),
              tests: [{ name: 'ok', input: {}, expect: { output: 'x' } }],
            },
          }),
        }),
      },
    );
    expect(save).toHaveBeenCalledWith(
      expect.anything(),
      'Restore v3',
      expect.objectContaining({ testsPassed: false }),
    );
    expect(result).toMatchObject({ version: 8, testsPassed: false });
  });
});

describe('deploy_automation says what kind of deploy it was', () => {
  it('calls a deploy of an older version a rollback, and any other a deploy [MCP-R3]', async () => {
    const back = await dispatch(
      'deploy_automation',
      { name: NAME, version: 3, expectedDeployedVersion: 5 },
      { store: store() },
    );
    expect(back).toMatchObject({
      deployed: { name: NAME, version: 3 },
      previousVersion: 5,
      kind: 'rollback',
    });
    const forward = await dispatch(
      'deploy_automation',
      { name: NAME, version: 7 },
      { store: store() },
    );
    expect(forward).toMatchObject({ kind: 'deploy' });
    const first = await dispatch(
      'deploy_automation',
      { name: NAME, version: 7 },
      {
        store: store({
          deploy: async (name, version) => ({
            name,
            version,
            previousVersion: null,
          }),
        }),
      },
    );
    expect(first).toMatchObject({ kind: 'deploy', previousVersion: null });
  });
});
