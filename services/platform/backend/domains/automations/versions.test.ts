// @vitest-environment node

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./store.ts', async (original) => ({
  ...(await original<typeof import('./store.ts')>()),
  saveVersion: vi.fn(),
  versionRow: vi.fn(),
}));

import { appOrigin } from '../../lib/write-origin.ts';
import { AutomationError, saveVersion, versionRow } from './store.ts';
import {
  listVersionHistory,
  protectedVersions,
  restoreVersion,
} from './versions.ts';

interface Statement {
  text: string;
  values: unknown[];
}

const ORG = 'org_1';
const NAME = 'billing/dunning';

/** A history row as the read selects it. */
function record(version: number, overrides: Record<string, unknown> = {}) {
  return {
    version,
    message: `v${String(version)}`,
    createdBy: 'user_ada',
    createdAt: version * 1_000,
    createdVia: 'app',
    apiKeyId: null,
    clientName: null,
    basedOnVersion: version > 1 ? version - 1 : null,
    restoredFromVersion: null,
    changes: { nodes: { added: 1, removed: 0, changed: 0 } },
    testsPassed: true,
    testsCheckedAt: version * 1_000 + 1,
    lastDeployedAt: null,
    ...overrides,
  };
}

function fake(state: {
  pointer?: { version: number; deployedBy: string; deployedAtMs: number };
  rows?: ReturnType<typeof record>[];
  latest?: number | null;
}) {
  const statements: Statement[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    if (text === '' || text.startsWith('AND a.version <')) {
      return { fragment: text };
    }
    statements.push({ text, values });
    if (text.includes('FROM app.automation_deployments')) {
      return Promise.resolve(
        state.pointer === undefined ? [] : [state.pointer],
      );
    }
    if (text.includes('SELECT max(version)')) {
      return Promise.resolve([{ latest: state.latest ?? null }]);
    }
    if (text.includes('FROM app.automations a')) {
      const limit = Number(values.at(-1));
      return Promise.resolve((state.rows ?? []).slice(0, limit));
    }
    return Promise.resolve([]);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { sql: tag as unknown as Sql, statements };
}

describe('listVersionHistory [AUTO-R47]', () => {
  it('answers each version with its door, lineage, change summary, tests and whether it is live', async () => {
    const { sql, statements } = fake({
      pointer: { version: 3, deployedBy: 'user_ben', deployedAtMs: 9_000 },
      rows: [
        record(3, { lastDeployedAt: 8_000 }),
        record(2, {
          createdBy: 'api-key:user_ben',
          createdVia: 'mcp',
          apiKeyId: 'key_1',
          clientName: 'Claude Code',
          restoredFromVersion: 1,
          lastDeployedAt: 7_000,
        }),
        // Saved before doors and summaries were recorded.
        record(1, {
          createdBy: 'api-key:user_ada',
          createdVia: null,
          changes: null,
          basedOnVersion: null,
        }),
      ],
      latest: 3,
    });
    const history = await listVersionHistory(sql, ORG, NAME);
    expect(history.latestVersion).toBe(3);
    expect(history.deployedVersion).toBe(3);
    expect(history.nextBefore).toBeNull();
    expect(history.versions.map((row) => row.version)).toEqual([3, 2, 1]);
    // The live version went live when its pointer says, the later of the
    // two times.
    expect(history.versions[0]).toMatchObject({
      live: true,
      lastDeployedAt: 9_000,
      via: 'app',
      viaInferred: false,
      basedOnVersion: 2,
    });
    expect(history.versions[1]).toMatchObject({
      live: false,
      lastDeployedAt: 7_000,
      via: 'mcp',
      clientName: 'Claude Code',
      apiKeyId: 'key_1',
      restoredFromVersion: 1,
    });
    // A version older than the record of doors reads its door from who
    // saved it, and says so.
    expect(history.versions[2]).toMatchObject({
      via: 'mcp',
      viaInferred: true,
      changes: null,
      lastDeployedAt: null,
    });
    for (const statement of statements) {
      expect(statement.values).toEqual(expect.arrayContaining([ORG, NAME]));
    }
  });

  it('pages by version and says where the next page starts', async () => {
    const { sql } = fake({
      rows: [record(9), record(8), record(7)],
      latest: 9,
    });
    const page = await listVersionHistory(sql, ORG, NAME, { limit: 2 });
    expect(page.versions.map((row) => row.version)).toEqual([9, 8]);
    expect(page.nextBefore).toBe(8);
  });
});

describe('restoreVersion [AUTO-R48]', () => {
  beforeEach(() => {
    vi.mocked(saveVersion).mockReset();
    vi.mocked(versionRow).mockReset();
  });

  it('saves the older version’s content as the newest, restored from and based on it', async () => {
    vi.mocked(versionRow).mockResolvedValue({
      name: NAME,
      version: 2,
      document: { version: 1, name: NAME, nodes: [] },
      message: 'v2',
      testsPassed: true,
      testsCheckedAt: 1,
      taskContract: { workflow: NAME },
      settings: null,
      presentation: { name: 'Dunning' },
      createdBy: 'user_ben',
      createdAt: 1,
      createdVia: 'app',
      apiKeyId: null,
      clientName: null,
    });
    vi.mocked(saveVersion).mockResolvedValue({ name: NAME, version: 5 });
    const sql = {} as Sql;
    await expect(
      restoreVersion(sql, {
        organizationId: ORG,
        name: NAME,
        version: 2,
        origin: appOrigin('user_ada'),
        baseVersion: 4,
      }),
    ).resolves.toEqual({ name: NAME, version: 5, restoredFrom: 2 });
    expect(saveVersion).toHaveBeenCalledWith(sql, {
      organizationId: ORG,
      name: NAME,
      document: { version: 1, name: NAME, nodes: [] },
      origin: appOrigin('user_ada'),
      message: 'Restore v2',
      taskContract: { workflow: NAME },
      settings: null,
      presentation: { name: 'Dunning' },
      basedOnVersion: 2,
      restoredFromVersion: 2,
      unlessIdentical: true,
      baseVersion: 4,
    });
  });

  it('answers unchanged when the content is the latest already', async () => {
    vi.mocked(versionRow).mockResolvedValue({
      name: NAME,
      version: 2,
      document: {},
      message: null,
      testsPassed: null,
      testsCheckedAt: null,
      taskContract: null,
      settings: null,
      presentation: null,
      createdBy: 'user_ben',
      createdAt: 1,
      createdVia: null,
      apiKeyId: null,
      clientName: null,
    });
    vi.mocked(saveVersion).mockResolvedValue({
      name: NAME,
      version: 4,
      unchanged: true,
    });
    await expect(
      restoreVersion({} as Sql, {
        organizationId: ORG,
        name: NAME,
        version: 2,
        origin: appOrigin('user_ada'),
        message: 'Back to the March flow',
      }),
    ).resolves.toEqual({
      name: NAME,
      version: 4,
      restoredFrom: 2,
      unchanged: true,
    });
    expect(saveVersion).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ message: 'Back to the March flow' }),
    );
  });

  it('refuses a version the automation does not have', async () => {
    vi.mocked(versionRow).mockResolvedValue(null);
    const refused = await restoreVersion({} as Sql, {
      organizationId: ORG,
      name: NAME,
      version: 9,
      origin: appOrigin('user_ada'),
    }).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(AutomationError);
    expect(refused).toMatchObject({
      code: 'AUTOMATION_VERSION_UNKNOWN',
      status: 404,
    });
    expect(saveVersion).not.toHaveBeenCalled();
  });
});

describe('protectedVersions', () => {
  it('reads one automation’s live, deployed, run, newest and lineage versions', async () => {
    const statements: Statement[] = [];
    const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
      statements.push({ text: strings.join('?'), values });
      return Promise.resolve([{ version: 7 }, { version: 3 }]);
    };
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
    const kept = await protectedVersions(tag as unknown as Sql, ORG, NAME);
    expect([...kept].sort((left, right) => left - right)).toEqual([3, 7]);
    const [read] = statements;
    const text = (read?.text ?? '').replace(/\s+/g, ' ');
    for (const source of [
      'FROM app.automation_deployments',
      'FROM app.automation_deployment_events',
      'FROM app.automation_runs',
      'a.based_on_version',
      'a.restored_from_version',
    ]) {
      expect(text).toContain(source);
    }
    // Every source is scoped to the one automation.
    expect(read?.values.filter((value) => value === ORG)).toHaveLength(6);
    expect(read?.values.filter((value) => value === NAME)).toHaveLength(6);
  });
});
