import {
  markRetryQueueKey,
  RETRY_QUEUE_LOCK_CLASS,
  retryQueueKeysOf,
} from '@tale/shared/db/serializable';
import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { authorizeActorRun } from '../automations/dispatch-store.ts';
import { getRun, resolveRunProject } from '../automations/store.ts';
import { loadProjectOrThrow } from '../projects/service.ts';
import { upsertTaskByExternalRef } from '../tasks/external-ref.ts';
import type { TaskRow } from '../tasks/service.ts';
import { pgTaskStore } from './task-store.ts';

vi.mock('../automations/dispatch-store.ts', () => ({
  authorizeActorRun: vi.fn(),
}));
vi.mock('../automations/store.ts', () => ({
  getRun: vi.fn(),
  resolveRunProject: vi.fn(),
}));
vi.mock('../projects/service.ts', () => ({
  loadProjectOrThrow: vi.fn(),
  getProjectAuthContext: vi.fn(),
}));
vi.mock('../tasks/external-ref.ts', () => ({
  upsertTaskByExternalRef: vi.fn(),
}));

const tx = vi.fn(async () => []);
const sql = {
  begin: async (
    optionsOrCallback: string | ((transaction: unknown) => unknown),
    callback?: (transaction: unknown) => unknown,
  ) => {
    const fn =
      typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
    if (!fn) throw new Error('Expected a transaction callback');
    return fn(tx);
  },
} as unknown as Sql;
const input = {
  organizationId: 'org-1',
  projectId: 'project-1',
  externalSystem: 'github',
  externalId: 'example/web#1',
  title: 'Issue',
};
const workflow = { kind: 'workflow' as const, runId: 'run-1', nodeId: 'tasks' };
const project = {
  id: 'project-1',
  organizationId: 'org-1',
  archivedAt: null,
  teamId: null,
  sharedWithTeamIds: [],
  teamIds: [],
};
const person = (role: string, teamIds: string[] = []) => ({
  organizationId: 'org-1',
  userId: 'user-1',
  role,
  teamIds,
});

beforeEach(() => {
  vi.resetAllMocks();
  tx.mockResolvedValue([]);
  vi.mocked(loadProjectOrThrow).mockResolvedValue(project as never);
  vi.mocked(authorizeActorRun).mockResolvedValue(person('editor') as never);
  vi.mocked(getRun).mockResolvedValue({
    name: 'github/import-issues',
    projectId: null,
    startedBy: 'user:user-1',
  } as never);
  vi.mocked(upsertTaskByExternalRef).mockResolvedValue({
    taskId: 'task-1',
    created: true,
    title: 'Issue',
  });
});

describe('task import authorization and reconciliation policy', () => {
  it('reuses project dedupe and preserves local progress on every repeat', async () => {
    await expect(
      pgTaskStore(sql).upsert({ ...input, caller: workflow }),
    ).resolves.toEqual({ taskId: 'task-1', created: true, title: 'Issue' });
    expect(getRun).toHaveBeenCalledWith(tx, 'org-1', 'run-1');
    expect(resolveRunProject).toHaveBeenCalledWith(tx, {
      organizationId: 'org-1',
      name: 'github/import-issues',
      projectId: 'project-1',
    });
    expect(upsertTaskByExternalRef).toHaveBeenCalledWith(tx, {
      ...input,
      actorId: 'workflow',
      dedupeScope: 'project',
      descriptionMode: 'preserve',
    });
    expect(
      vi.mocked(upsertTaskByExternalRef).mock.calls[0]?.[1],
    ).not.toHaveProperty('externalState');
  });

  it.each([
    { organizationId: 'foreign', archivedAt: null },
    { organizationId: 'org-1', archivedAt: 1 },
  ])('rejects a foreign or archived target before writing', async (target) => {
    vi.mocked(loadProjectOrThrow).mockResolvedValue(target as never);
    await expect(
      pgTaskStore(sql).upsert({ ...input, caller: workflow }),
    ).rejects.toMatchObject({ code: 'PROJECT_NOT_FOUND' });
    expect(upsertTaskByExternalRef).not.toHaveBeenCalled();
  });

  it.each([null, { projectId: 'other-project' }])(
    'refuses a missing run or cross-project workflow',
    async (run) => {
      vi.mocked(getRun).mockResolvedValue(run as never);
      await expect(
        pgTaskStore(sql).upsert({ ...input, caller: workflow }),
      ).rejects.toMatchObject({ code: 'PROJECT_NOT_FOUND' });
      expect(upsertTaskByExternalRef).not.toHaveBeenCalled();
    },
  );

  it('does not record refresh attempts when project authorization refuses selection', async () => {
    vi.mocked(loadProjectOrThrow).mockResolvedValue({
      organizationId: 'foreign',
      archivedAt: null,
    } as never);
    await expect(
      pgTaskStore(sql).listExternalIssues({
        organizationId: 'org-1',
        projectId: 'project-1',
        caller: workflow,
        externalSystem: 'github',
        repositoryId: 10,
        limit: 1,
      }),
    ).rejects.toMatchObject({ code: 'PROJECT_NOT_FOUND' });
    // The shared import mutex is the only statement; no task read or stamp ran.
    expect(tx).toHaveBeenCalledTimes(1);
    expect(tx).toHaveBeenCalledWith(
      expect.anything(),
      RETRY_QUEUE_LOCK_CLASS,
      'task-issue-import:org-1:project-1',
    );
  });

  it('propagates the run binding refusal', async () => {
    const refused = new Error('automation is not bound to the target');
    vi.mocked(resolveRunProject).mockRejectedValue(refused);
    await expect(
      pgTaskStore(sql).upsert({ ...input, caller: workflow }),
    ).rejects.toBe(refused);
    expect(upsertTaskByExternalRef).not.toHaveBeenCalled();
  });

  it('checks human membership and project access and attributes the creator', async () => {
    await pgTaskStore(sql).upsert({
      ...input,
      caller: { kind: 'user', userId: 'user-1' },
    });
    expect(authorizeActorRun).toHaveBeenCalledWith(
      tx,
      'org-1',
      'user-1',
      'membership',
    );
    // An editor's call reaches every task and grows the label catalog.
    expect(upsertTaskByExternalRef).toHaveBeenCalledWith(tx, {
      ...input,
      actorId: 'user-1',
      creatorType: 'user',
      dedupeScope: 'project',
      descriptionMode: 'preserve',
    });
  });

  it('checks an org-wide run starter before writing to a private project', async () => {
    vi.mocked(loadProjectOrThrow).mockResolvedValue({
      ...project,
      teamId: 'team-1',
      teamIds: ['team-1'],
    } as never);
    vi.mocked(authorizeActorRun).mockResolvedValue(person('member') as never);
    await expect(
      pgTaskStore(sql).upsert({ ...input, caller: workflow }),
    ).rejects.toMatchObject({ code: 'TASK_FORBIDDEN' });
    expect(authorizeActorRun).toHaveBeenCalledWith(
      tx,
      'org-1',
      'user-1',
      'membership',
    );
    expect(upsertTaskByExternalRef).not.toHaveBeenCalled();
  });

  it("a member's run works within the member's reach instead of dying on an editor check", async () => {
    // A member may start an automation built for their task; its task
    // natives create in the project and change only what the member may
    // work, naming only labels the catalog already has.
    vi.mocked(authorizeActorRun).mockResolvedValue(person('member') as never);
    await expect(
      pgTaskStore(sql).upsert({ ...input, caller: workflow }),
    ).resolves.toEqual({ taskId: 'task-1', created: true, title: 'Issue' });
    const sent = vi.mocked(upsertTaskByExternalRef).mock.calls[0]?.[1];
    expect(sent).toMatchObject({ mintLabels: false });
    const authorize = sent?.authorizeReconcile;
    if (authorize === undefined) throw new Error('expected a reconcile gate');
    const row = (createdBy: string) =>
      ({
        createdBy,
        createdByType: 'user',
        assigneeType: null,
        assigneeId: null,
        parentTaskId: null,
      }) as unknown as TaskRow;
    await expect(authorize(row('user-1'))).resolves.toBeUndefined();
    await expect(authorize(row('user-2'))).rejects.toMatchObject({
      code: 'RBAC_FORBIDDEN',
    });
  });

  it('a run a schedule fired keeps the automation reach', async () => {
    vi.mocked(getRun).mockResolvedValue({
      name: 'github/import-issues',
      projectId: null,
      startedBy: 'trigger:trigger-1',
    } as never);
    await pgTaskStore(sql).upsert({ ...input, caller: workflow });
    expect(authorizeActorRun).not.toHaveBeenCalled();
    expect(
      vi.mocked(upsertTaskByExternalRef).mock.calls[0]?.[1],
    ).not.toHaveProperty('authorizeReconcile');
  });

  it('does not turn a database failure into a successful empty import', async () => {
    const failure = new Error('database disconnected');
    vi.mocked(upsertTaskByExternalRef).mockRejectedValue(failure);
    await expect(
      pgTaskStore(sql).upsert({ ...input, caller: workflow }),
    ).rejects.toBe(failure);
  });

  it('locks a batch in stable source order while returning the original issue order', async () => {
    // Each result carries the title the domain answered — the one the task
    // carries (cut, or kept by a source reconcile) — never the one sent.
    vi.mocked(upsertTaskByExternalRef).mockImplementation(
      async (_tx, issue) => ({
        taskId: issue.externalId,
        created: true,
        title: `Stored ${issue.title}`,
      }),
    );
    const issues = [
      {
        externalSystem: 'github',
        externalId: 'example/web#2',
        title: 'Second',
      },
      { externalSystem: 'github', externalId: 'example/web#1', title: 'First' },
    ];
    await expect(
      pgTaskStore(sql).upsertIssues({
        organizationId: 'org-1',
        projectId: 'project-1',
        caller: workflow,
        issues,
      }),
    ).resolves.toEqual([
      { taskId: 'example/web#2', created: true, title: 'Stored Second' },
      { taskId: 'example/web#1', created: true, title: 'Stored First' },
    ]);
    expect(
      vi
        .mocked(upsertTaskByExternalRef)
        .mock.calls.map((call) => call[1].externalId),
    ).toEqual(['example/web#1', 'example/web#2']);
  });

  it('queues a batch before reading authorization and preserves nested retry marks', async () => {
    const failure = markRetryQueueKey(
      Object.assign(new Error('concurrent audit write'), { code: '40001' }),
      'audit-chain:org-1',
    );
    vi.mocked(upsertTaskByExternalRef).mockRejectedValueOnce(failure);
    vi.mocked(loadProjectOrThrow).mockImplementation(async () => {
      expect(tx).toHaveBeenCalledWith(
        expect.anything(),
        RETRY_QUEUE_LOCK_CLASS,
        'task-issue-import:org-1:project-1',
      );
      return project as never;
    });
    await pgTaskStore(sql).upsertIssues({
      organizationId: 'org-1',
      projectId: 'project-1',
      caller: workflow,
      issues: [
        {
          externalSystem: 'github',
          externalId: 'example/web#1',
          title: 'Issue',
        },
      ],
    });
    expect(retryQueueKeysOf(failure)).toEqual([
      'task-issue-import:org-1:project-1',
      'audit-chain:org-1',
    ]);
    expect(tx).toHaveBeenCalledTimes(2);
  });

  it.each(['40001', '40P01'])(
    'retries an atomic batch after PostgreSQL %s',
    async (code) => {
      vi.mocked(upsertTaskByExternalRef).mockRejectedValueOnce(
        Object.assign(new Error('retry transaction'), { code }),
      );
      await expect(
        pgTaskStore(sql).upsertIssues({
          organizationId: 'org-1',
          projectId: 'project-1',
          caller: workflow,
          issues: [
            {
              externalSystem: 'github',
              externalId: 'example/web#1',
              title: 'Issue',
            },
          ],
        }),
      ).resolves.toEqual([{ taskId: 'task-1', created: true, title: 'Issue' }]);
      expect(upsertTaskByExternalRef).toHaveBeenCalledTimes(2);
      expect(loadProjectOrThrow).toHaveBeenCalledTimes(2);
    },
  );
});
