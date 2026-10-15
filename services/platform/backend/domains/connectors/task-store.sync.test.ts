import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IssueSyncProjectRefusal } from '../../../lib/connectors/natives/issue-sync.ts';
import { getRun, resolveRunProject } from '../automations/store.ts';
import { loadProjectOrThrow, ProjectError } from '../projects/service.ts';
import { upsertTaskByExternalRef } from '../tasks/external-ref.ts';
import {
  failSyncPosition,
  readSyncPosition,
  saveImportCursor,
} from '../tasks/import-cursors.ts';
import { TaskError } from '../tasks/service.ts';
import { pgTaskStore } from './task-store.ts';

/**
 * The issue sync's backend wiring over mocked domain seams: the trackers
 * are read through the connector door as the step, each issue is written
 * in a transaction of its own, a refusal of one issue is a receipt entry,
 * and the project's refusal stops the step before any tracker is read. The
 * same paths run against Postgres in `tasks/issue-sync.integration.ts`.
 */

vi.mock('../automations/dispatch-store.ts', () => ({
  authorizeActorRun: vi.fn(),
}));
vi.mock('../automations/store.ts', () => ({
  AutomationError: class extends Error {},
  getRun: vi.fn(),
  resolveRunProject: vi.fn(),
}));
vi.mock('../projects/service.ts', () => ({
  ProjectError: class extends Error {},
  loadProjectOrThrow: vi.fn(),
  getProjectAuthContext: vi.fn(),
}));
vi.mock('../tasks/external-ref.ts', () => ({
  upsertTaskByExternalRef: vi.fn(),
}));
vi.mock('../tasks/import-cursors.ts', () => ({
  failSyncPosition: vi.fn(),
  readImportCursor: vi.fn(),
  readSyncPosition: vi.fn(),
  restartSyncPosition: vi.fn(),
  saveImportCursor: vi.fn(),
  waitSyncPosition: vi.fn(),
}));

const tx = vi.fn(
  async (_strings: TemplateStringsArray, ..._values: unknown[]) => [],
);
const transactions = vi.fn((_mode: string) => undefined);
const sql = {
  begin: async (
    optionsOrCallback: string | ((transaction: unknown) => unknown),
    callback?: (transaction: unknown) => unknown,
  ) => {
    transactions(
      typeof optionsOrCallback === 'string' ? optionsOrCallback : '',
    );
    const fn =
      typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
    if (!fn) throw new Error('Expected a transaction callback');
    return fn(tx);
  },
} as unknown as Sql;
const caller = { kind: 'workflow' as const, runId: 'run-1', nodeId: 'sync' };
const project = {
  id: 'project-1',
  organizationId: 'org-1',
  archivedAt: null,
  teamId: null,
  sharedWithTeamIds: [],
  teamIds: [],
};
const snapshot = (n: number) => ({
  id: String(1000 + n),
  title: `Issue ${n}`,
  description: 'Details',
  url: `https://github.com/example/web/issues/${n}`,
  state: 'open' as const,
  syncedAt: Date.parse('2026-10-14T18:00:00Z'),
  repositoryId: 10,
  number: n,
});
const imported = (n: number) => ({
  externalSystem: 'github',
  externalId: `example/web#${n}`,
  externalUrl: snapshot(n).url,
  title: `Issue ${n}`,
  description: 'Details',
  externalIssue: snapshot(n),
});
const sync = {
  organizationId: 'org-1',
  caller,
  projectId: 'project-1',
  sources: [
    {
      kind: 'github' as const,
      owner: 'example',
      repo: 'web',
      credential: 'GitHub work',
    },
  ],
  limit: 100,
  refreshLimit: 0,
};

beforeEach(() => {
  vi.resetAllMocks();
  tx.mockResolvedValue([]);
  vi.mocked(loadProjectOrThrow).mockResolvedValue(project as never);
  vi.mocked(getRun).mockResolvedValue({
    name: 'github-sync-issues',
    projectId: 'project-1',
    startedBy: 'trigger:trigger-1',
  } as never);
  vi.mocked(readSyncPosition).mockResolvedValue({
    cursor: '',
    revision: '7',
    batch: 1,
    resumed: false,
    restarted: false,
    passStartedAt: null,
    lastDrainedAt: null,
    retryAfter: null,
  });
  vi.mocked(saveImportCursor).mockResolvedValue({
    saved: true,
    drained: true,
    batch: 1,
    conflict: false,
    revision: '8',
  });
});

describe('pgTaskStore.syncIssues', () => {
  it('reads the tracker through the connector door as the step, with the source’s credential [TASK-R57]', async () => {
    const runConnector = vi.fn().mockResolvedValue({
      status: 'ok',
      output: {
        issues: [],
        truncated: false,
        nextCursor: null,
        repositoryId: 10,
      },
    });
    const stop = new AbortController();
    await pgTaskStore(sql, { runConnector }).syncIssues({
      ...sync,
      signal: stop.signal,
    });
    expect(runConnector).toHaveBeenCalledWith({
      organizationId: 'org-1',
      connector: 'github',
      action: 'list_import_issues',
      input: { owner: 'example', repo: 'web', limit: 100 },
      credentialRef: 'GitHub work',
      mode: 'live',
      caller,
      signal: stop.signal,
    });
    expect(vi.mocked(saveImportCursor).mock.calls[0]?.[1]).toEqual({
      organizationId: 'org-1',
      projectId: 'project-1',
      externalSystem: 'github',
      source: 'example/web',
    });
  });

  it('writes each issue in a serializable transaction of its own, and skips one the task domain refuses [TASK-R55]', async () => {
    const runConnector = vi.fn().mockResolvedValue({
      status: 'ok',
      output: {
        issues: [imported(1), imported(2), imported(3)],
        truncated: false,
        nextCursor: null,
        repositoryId: 10,
      },
    });
    vi.mocked(upsertTaskByExternalRef).mockImplementation(async (_tx, args) => {
      if (args.externalId === 'example/web#2') {
        throw new TaskError(
          'TASK_EXTERNAL_REF_INVALID',
          'This external issue reference already belongs to a different source identity',
          409,
        );
      }
      return { taskId: `task-${args.externalId}`, created: true, title: 'x' };
    });
    const result = await pgTaskStore(sql, { runConnector }).syncIssues(sync);
    expect(result.sources[0]).toMatchObject({
      ok: true,
      created: 2,
      skipped: 1,
      skippedIssues: [
        { externalId: 'example/web#2', reason: 'TASK_EXTERNAL_REF_INVALID' },
      ],
    });
    expect(
      transactions.mock.calls.filter(([mode]) => mode.includes('serializable')),
    ).toHaveLength(3);
    // Each write took the project's import queue lock first.
    expect(
      tx.mock.calls.filter(([strings]) =>
        String(strings).includes('pg_advisory_xact_lock'),
      ),
    ).toHaveLength(3);
  });

  it('skips an issue the database refuses as data, and writes the others [TASK-R55]', async () => {
    const runConnector = vi.fn().mockResolvedValue({
      status: 'ok',
      output: {
        issues: [imported(1), imported(2), imported(3)],
        truncated: false,
        nextCursor: null,
        repositoryId: 10,
      },
    });
    vi.mocked(upsertTaskByExternalRef).mockImplementation(async (_tx, args) => {
      if (args.externalId === 'example/web#2') {
        throw Object.assign(
          new Error('invalid byte sequence for encoding "UTF8": 0x00'),
          { code: '22021' },
        );
      }
      return { taskId: `task-${args.externalId}`, created: true, title: 'x' };
    });
    const result = await pgTaskStore(sql, { runConnector }).syncIssues(sync);
    expect(result.sources[0]).toMatchObject({
      ok: true,
      created: 2,
      skipped: 1,
      saved: true,
      skippedIssues: [
        { externalId: 'example/web#2', reason: 'SQLSTATE_22021' },
      ],
    });
  });

  it('hands the source’s task labels to the task domain with each issue it writes [TASK-R62]', async () => {
    const runConnector = vi.fn().mockResolvedValue({
      status: 'ok',
      output: {
        issues: [imported(1)],
        truncated: false,
        nextCursor: null,
        repositoryId: 10,
      },
    });
    vi.mocked(upsertTaskByExternalRef).mockResolvedValue({
      taskId: 'task-1',
      created: true,
      title: 'Issue 1',
    });
    await pgTaskStore(sql, { runConnector }).syncIssues({
      ...sync,
      sources: [
        {
          kind: 'github',
          owner: 'example',
          repo: 'web',
          taskLabels: ['source:github'],
        },
      ],
    });
    expect(vi.mocked(upsertTaskByExternalRef).mock.calls[0]?.[1]).toMatchObject(
      {
        externalSystem: 'github',
        externalId: 'example/web#1',
        labels: ['source:github'],
      },
    );
  });

  it('passes a failure of the database itself on, instead of skipping the issue', async () => {
    const runConnector = vi.fn().mockResolvedValue({
      status: 'ok',
      output: {
        issues: [imported(1)],
        truncated: false,
        nextCursor: null,
        repositoryId: 10,
      },
    });
    const lost = Object.assign(new Error('terminating connection'), {
      code: '57P01',
    });
    vi.mocked(upsertTaskByExternalRef).mockRejectedValue(lost);
    await expect(
      pgTaskStore(sql, { runConnector }).syncIssues(sync),
    ).rejects.toBe(lost);
  });

  it('stops the step, without reading a tracker, when the run may not write in the project [CONN-R11]', async () => {
    vi.mocked(loadProjectOrThrow).mockRejectedValue(
      new ProjectError('PROJECT_NOT_FOUND', 'Project not found', 404),
    );
    const runConnector = vi.fn();
    await expect(
      pgTaskStore(sql, { runConnector }).syncIssues(sync),
    ).rejects.toBeInstanceOf(IssueSyncProjectRefusal);
    expect(runConnector).not.toHaveBeenCalled();
    expect(readSyncPosition).not.toHaveBeenCalled();
  });

  it('stops the step when the run’s binding refuses the project [CONN-R11]', async () => {
    vi.mocked(resolveRunProject).mockRejectedValue(
      new TaskError('PROJECT_NOT_FOUND', 'Project not found', 404),
    );
    const runConnector = vi.fn();
    await expect(
      pgTaskStore(sql, { runConnector }).syncIssues(sync),
    ).rejects.toBeInstanceOf(IssueSyncProjectRefusal);
    expect(runConnector).not.toHaveBeenCalled();
  });

  it('passes a database failure on instead of writing it into a receipt', async () => {
    const outage = new Error('connection terminated');
    vi.mocked(readSyncPosition).mockRejectedValue(outage);
    await expect(
      pgTaskStore(sql, { runConnector: vi.fn() }).syncIssues(sync),
    ).rejects.toBe(outage);
  });

  it('counts a batch the tracker refused against the revision its run read [TASK-R59]', async () => {
    const runConnector = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error('fetch failed'), { name: 'TypeError' }),
      );
    const result = await pgTaskStore(sql, { runConnector }).syncIssues(sync);
    expect(result.sources[0]).toMatchObject({ ok: false, error: 'failed' });
    expect(vi.mocked(failSyncPosition).mock.calls[0]?.[2]).toEqual({
      revision: '7',
    });
  });

  it('refuses the sync from a store built without the connector door', async () => {
    await expect(pgTaskStore(sql).syncIssues(sync)).rejects.toThrow(
      /connector door/,
    );
  });
});
