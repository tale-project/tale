import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import type { TaskOwnership } from '../../core/tasks/access.ts';
import type { ProjectAuthContext, ProjectRow } from '../projects/service.ts';
import {
  assertTaskCreatable,
  assertTaskLabelsEditable,
  assertTaskReadable,
  assertTaskWorkable,
  assigneeChanges,
  mayWorkTask,
  TaskError,
  type WorkableTask,
} from './service.ts';

/** A database the guards must not touch: the task itself (or the caller's
 * role) settles every case that uses it. */
const noQueries = ((): never => {
  throw new Error('the guard read the database');
}) as unknown as Sql;

/** A database whose one answer is the subtask tree above a task. */
const ancestry = (rows: TaskOwnership[]): Sql =>
  ((strings: TemplateStringsArray) => {
    if (!strings.join('?').includes('WITH RECURSIVE up')) {
      throw new Error('unexpected query');
    }
    return Promise.resolve(rows);
  }) as unknown as Sql;

const project = (overrides: Partial<ProjectRow> = {}): ProjectRow => ({
  id: 'proj-1',
  organizationId: 'org-a',
  name: 'Board',
  description: null,
  icon: null,
  color: null,
  key: null,
  externalItemId: null,
  taskCounter: 0,
  openTaskCount: 0,
  doneTaskCount: 0,
  projectAgentCount: 0,
  defaultTaskReviewerAgentId: null,
  teamId: null,
  sharedWithTeamIds: [],
  teamIds: [],
  instructions: null,
  createdBy: 'user-1',
  createdAt: 0,
  updatedAt: 0,
  archivedAt: null,
  pinnedAt: null,
  ...overrides,
});

const auth = (
  overrides: Partial<ProjectAuthContext> = {},
): ProjectAuthContext => ({
  organizationId: 'org-a',
  userId: 'user-1',
  role: 'owner',
  teamIds: [],
  ...overrides,
});

/** Whose task it is: created by `user-2` unless the case says otherwise. */
const task = (overrides: Partial<WorkableTask> = {}): WorkableTask => ({
  createdBy: 'user-2',
  createdByType: 'user',
  assigneeType: null,
  assigneeId: null,
  parentTaskId: null,
  ...overrides,
});

const thrown = (run: () => void): TaskError => {
  try {
    run();
  } catch (error) {
    if (error instanceof TaskError) return error;
    throw error;
  }
  throw new Error('expected a TaskError');
};

const rejected = async (run: () => Promise<unknown>): Promise<TaskError> => {
  try {
    await run();
  } catch (error) {
    if (error instanceof TaskError) return error;
    throw error;
  }
  throw new Error('expected a TaskError');
};

describe('task guards — tenant isolation', () => {
  it('a foreign org project answers as MISSING even for an owner', async () => {
    // The role matrix is org-relative: an org-B owner is nobody in org A,
    // and the admin bypass inside checkProjectAccess must never run across
    // the org boundary. 404 (not 403) so a leaked id confirms nothing.
    const foreign = auth({ organizationId: 'org-b', role: 'owner' });
    const read = thrown(() => assertTaskReadable(project(), foreign));
    expect(read.code).toBe('PROJECT_NOT_FOUND');
    expect(read.status).toBe(404);
    const write = await rejected(() =>
      assertTaskWorkable(noQueries, project(), task(), foreign),
    );
    expect(write.code).toBe('PROJECT_NOT_FOUND');
    expect(write.status).toBe(404);
    const create = thrown(() => assertTaskCreatable(project(), foreign));
    expect(create.code).toBe('PROJECT_NOT_FOUND');
    expect(create.status).toBe(404);
    expect(await mayWorkTask(noQueries, project(), task(), foreign)).toBe(
      false,
    );
  });

  it('the cross-org refusal is indistinguishable from a missing project', () => {
    // Same code + status the projects domain answers for an id that does
    // not exist at all — org membership is not confirmable by probing.
    const error = thrown(() =>
      assertTaskReadable(project(), auth({ organizationId: 'org-b' })),
    );
    expect({ code: error.code, status: error.status }).toEqual({
      code: 'PROJECT_NOT_FOUND',
      status: 404,
    });
  });

  it('a team-restricted project stays visible only to its teams', () => {
    const restricted = project({ teamId: 'team-1' });
    expect(() =>
      assertTaskReadable(
        restricted,
        auth({ role: 'member', teamIds: ['team-1'] }),
      ),
    ).not.toThrow();
    const refused = thrown(() =>
      assertTaskReadable(restricted, auth({ role: 'member', teamIds: [] })),
    );
    expect(refused.code).toBe('TASK_FORBIDDEN');
    expect(refused.status).toBe(403);
  });
});

describe('task guards — who creates and who works a task', () => {
  const member = auth({ role: 'member', userId: 'user-1' });

  it('a member creates a task in any project they can read', () => {
    // The founder's call: delegating work to a project agent starts with a
    // task, so creating one is a reader's right, not an editor's.
    expect(() => assertTaskCreatable(project(), member)).not.toThrow();
    expect(() =>
      assertTaskCreatable(
        project({ teamId: 'team-1', teamIds: ['team-1'] }),
        auth({ role: 'member', userId: 'user-1', teamIds: ['team-1'] }),
      ),
    ).not.toThrow();
  });

  it('a member cannot create in a team project they cannot see', () => {
    const refused = thrown(() =>
      assertTaskCreatable(
        project({ teamId: 'team-1', teamIds: ['team-1'] }),
        member,
      ),
    );
    expect(refused.code).toBe('TASK_FORBIDDEN');
    expect(refused.status).toBe(403);
  });

  it('a member works the tasks they created and the ones assigned to them', async () => {
    const created = task({ createdBy: 'user-1' });
    const assigned = task({ assigneeType: 'user', assigneeId: 'user-1' });
    for (const own of [created, assigned]) {
      await expect(
        assertTaskWorkable(noQueries, project(), own, member),
      ).resolves.toBeUndefined();
      expect(await mayWorkTask(noQueries, project(), own, member)).toBe(true);
    }
  });

  it('a member works the subtasks under their own task, whoever added them', async () => {
    // An agent broke the member's task down; the subtask is nobody's own,
    // but closing the parent must not wait on someone else.
    const subtask = task({
      createdBy: 'agent-1',
      createdByType: 'agent',
      parentTaskId: 'task-parent',
    });
    const own = task({ createdBy: 'user-1' });
    await expect(
      assertTaskWorkable(ancestry([own]), project(), subtask, member),
    ).resolves.toBeUndefined();
    expect(
      await mayWorkTask(ancestry([task(), own]), project(), subtask, member),
    ).toBe(true);
    // Under someone else's task it stays theirs.
    const refused = await rejected(() =>
      assertTaskWorkable(ancestry([task()]), project(), subtask, member),
    );
    expect(refused.code).toBe('RBAC_FORBIDDEN');
    // An editor never needs the tree read.
    await expect(
      assertTaskWorkable(
        noQueries,
        project(),
        subtask,
        auth({ role: 'editor' }),
      ),
    ).resolves.toBeUndefined();
  });

  it("a member cannot change someone else's task — reading and commenting stay theirs", async () => {
    // Created by another person, or by an agent or an automation that
    // happens to carry the member's id, or handed to an agent: not theirs.
    for (const others of [
      task(),
      task({ createdBy: 'user-1', createdByType: 'agent' }),
      task({ assigneeType: 'agent', assigneeId: 'user-1' }),
    ]) {
      const refused = await rejected(() =>
        assertTaskWorkable(noQueries, project(), others, member),
      );
      expect(refused.code).toBe('RBAC_FORBIDDEN');
      expect(refused.status).toBe(403);
      expect(await mayWorkTask(noQueries, project(), others, member)).toBe(
        false,
      );
    }
    expect(() => assertTaskReadable(project(), member)).not.toThrow();
  });

  it('editors and admins of the SAME org work every task, as before', async () => {
    for (const role of ['owner', 'admin', 'developer', 'editor']) {
      await expect(
        assertTaskWorkable(noQueries, project(), task(), auth({ role })),
      ).resolves.toBeUndefined();
      expect(() =>
        assertTaskCreatable(project(), auth({ role })),
      ).not.toThrow();
    }
  });

  it('the label catalog stays with the project editors', () => {
    const refused = thrown(() => assertTaskLabelsEditable(project(), member));
    expect(refused.code).toBe('RBAC_FORBIDDEN');
    for (const role of ['owner', 'admin', 'developer', 'editor']) {
      expect(() =>
        assertTaskLabelsEditable(project(), auth({ role })),
      ).not.toThrow();
    }
  });

  it('an archived project is read-only for every role — its own code, not a permission one', async () => {
    // Archived = read-only for the whole project (the rule the docs and the
    // REST door already stated); the app door used to let tasks through.
    // The code is distinct from RBAC_FORBIDDEN so the UI can say "restore
    // it first" rather than "you may not".
    const archived = project({ archivedAt: 1_700_000_000_000 });
    expect(() => assertTaskReadable(archived, auth())).not.toThrow();
    for (const role of ['owner', 'admin', 'developer', 'editor']) {
      const work = await rejected(() =>
        assertTaskWorkable(noQueries, archived, task(), auth({ role })),
      );
      expect(work.code).toBe('PROJECT_ARCHIVED');
      expect(work.status).toBe(403);
      for (const run of [
        () => assertTaskCreatable(archived, auth({ role })),
        () => assertTaskLabelsEditable(archived, auth({ role })),
      ]) {
        const refused = thrown(run);
        expect(refused.code).toBe('PROJECT_ARCHIVED');
        expect(refused.status).toBe(403);
      }
    }
    // The member's own task is archived with it.
    const own = await rejected(() =>
      assertTaskWorkable(
        noQueries,
        archived,
        task({ createdBy: 'user-1' }),
        member,
      ),
    );
    expect(own.code).toBe('PROJECT_ARCHIVED');
    expect(thrown(() => assertTaskCreatable(archived, member)).code).toBe(
      'PROJECT_ARCHIVED',
    );
    expect(
      await mayWorkTask(
        noQueries,
        archived,
        task({ createdBy: 'user-1' }),
        member,
      ),
    ).toBe(false);
  });
});

describe('assigneeChanges — one transfer rule for the picker and the bulk bar', () => {
  // The live-run gate refuses (single card) or skips (bulk) exactly when the
  // write TRANSFERS the task; both doors ask this one function, so they can
  // never disagree about what a transfer is.
  const held = { assigneeType: 'agent' as const, assigneeId: 'agent-1' };
  const idle = { assigneeType: null, assigneeId: null };

  it('re-selecting the current assignee is not a transfer', () => {
    expect(assigneeChanges(held, held)).toBe(false);
  });

  it('another worker, or clearing a held task, is a transfer', () => {
    expect(
      assigneeChanges(held, { assigneeType: 'user', assigneeId: 'user-2' }),
    ).toBe(true);
    expect(assigneeChanges(held, null)).toBe(true);
  });

  it('assigning an idle task is a transfer; clearing an idle task is not', () => {
    expect(assigneeChanges(idle, held)).toBe(true);
    expect(assigneeChanges(idle, null)).toBe(false);
  });

  it('a mid-run transfer refusal is a 409 the picker can name', () => {
    const error = new TaskError('TASK_HAS_LIVE_RUN', 'held', 409);
    expect(error.status).toBe(409);
    expect(error.code).toBe('TASK_HAS_LIVE_RUN');
  });
});
