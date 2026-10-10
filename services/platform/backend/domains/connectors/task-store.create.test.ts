import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { authorizeActorRun } from '../automations/dispatch-store.ts';
import {
  AutomationError,
  getRun,
  resolveRunProject,
} from '../automations/store.ts';
import {
  getProjectAuthContext,
  loadProjectOrThrow,
} from '../projects/service.ts';
import { automationOwnerOfWorkflowSlug } from '../tasks/external-ref.ts';
import { createTask, TaskError } from '../tasks/service.ts';
import { pgTaskStore } from './task-store.ts';

vi.mock('../automations/dispatch-store.ts', () => ({
  authorizeActorRun: vi.fn(),
}));
vi.mock('../automations/store.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../automations/store.ts')>()),
  getRun: vi.fn(),
  resolveRunProject: vi.fn(),
}));
vi.mock('../projects/service.ts', () => ({
  loadProjectOrThrow: vi.fn(),
  getProjectAuthContext: vi.fn(),
}));
vi.mock('../tasks/external-ref.ts', () => ({
  automationOwnerOfWorkflowSlug: vi.fn(),
  upsertTaskByExternalRef: vi.fn(),
}));
vi.mock('../tasks/service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tasks/service.ts')>()),
  createTask: vi.fn(),
}));

/** The task row the store reads back by its id, once it exists. */
let stored: { number: number; title: string; projectId: string } | null;
const statements: string[] = [];
const tx = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
  const text = strings.join('?');
  statements.push(text);
  if (text.includes('FROM app.tasks')) {
    return Promise.resolve(stored === null ? [] : [stored]);
  }
  if (text.includes('lower(u.email)')) {
    return Promise.resolve(
      values.includes('ada@example.com') ? [{ id: 'user-ada' }] : [],
    );
  }
  if (text.includes('FROM "member"')) {
    return Promise.resolve(
      values.includes('user-noah') ? [{ userId: 'user-noah' }] : [],
    );
  }
  if (text.includes('FROM app.project_agents')) {
    return Promise.resolve(
      values.includes('writer') ? [{ id: 'agent-7' }] : [],
    );
  }
  return Promise.resolve([]);
});
const sql = {
  begin: async (callback: (transaction: unknown) => unknown) => callback(tx),
} as unknown as Sql;

const workflow = {
  kind: 'workflow' as const,
  runId: 'run-1',
  nodeId: 'ticket',
};
const project = {
  id: 'project-1',
  organizationId: 'org-1',
  archivedAt: null,
  teamId: null,
  sharedWithTeamIds: [],
  teamIds: [],
};
const ada = {
  organizationId: 'org-1',
  userId: 'user-1',
  role: 'editor',
  teamIds: [],
};
const ask = {
  organizationId: 'org-1',
  caller: workflow,
  idempotencyKey: 'run-1/ticket/0/0',
  projectId: 'project-1',
  title: 'Reply to Ada about the refund',
};

beforeEach(() => {
  vi.resetAllMocks();
  stored = null;
  statements.length = 0;
  vi.mocked(loadProjectOrThrow).mockResolvedValue(project as never);
  vi.mocked(authorizeActorRun).mockResolvedValue(ada as never);
  vi.mocked(getProjectAuthContext).mockResolvedValue({
    organizationId: 'org-1',
    userId: 'system',
    role: 'owner',
  } as never);
  vi.mocked(getRun).mockResolvedValue({
    name: 'support/triage',
    projectId: null,
    startedBy: 'user:user-1',
  } as never);
  vi.mocked(automationOwnerOfWorkflowSlug).mockResolvedValue('support/triage');
  vi.mocked(createTask).mockImplementation(async (_tx, _auth, args) => {
    stored = { number: 12, title: args.title, projectId: args.projectId };
    return 'created';
  });
});

describe('an automation step creates a task', () => {
  it('creates it in the project, as the automation, under an id its execution keeps [CONN-R23]', async () => {
    const answer = await pgTaskStore(sql).create({
      ...ask,
      title: `  ${'L'.repeat(260)}  `,
      status: 'todo',
      dueDate: 1_791_806_400_000,
      labels: ['support'],
    });
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    const [, auth, args, options] = vi.mocked(createTask).mock.calls[0] ?? [];
    expect(auth).toBe(ada);
    expect(args).toMatchObject({
      projectId: 'project-1',
      status: 'todo',
      dueDate: 1_791_806_400_000,
      labels: ['support'],
    });
    // Cut as an import's title is, never refused for its length.
    expect(args?.title).toHaveLength(200);
    expect(args?.title.endsWith('…')).toBe(true);
    expect(options?.creator).toEqual({ id: 'support/triage', type: 'app' });
    expect(options?.taskId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(answer.task).toEqual({
      taskId: options?.taskId,
      number: 12,
      title: args?.title,
      url: `/dashboard/org-1/projects/project-1/tasks?task=${options?.taskId}`,
    });
    expect(resolveRunProject).toHaveBeenCalledWith(tx, {
      organizationId: 'org-1',
      name: 'support/triage',
      projectId: 'project-1',
    });
  });

  it('answers the task a retry of the same execution already made [CONN-R23]', async () => {
    const store = pgTaskStore(sql);
    const first = await store.create(ask);
    const second = await store.create(ask);
    expect(createTask).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
    // Another execution is another task.
    stored = null;
    const other = await store.create({
      ...ask,
      idempotencyKey: 'run-1/ticket/1/0',
    });
    expect(createTask).toHaveBeenCalledTimes(2);
    expect(other.ok && first.ok && other.task.taskId).not.toBe(
      first.ok && first.task.taskId,
    );
  });

  it.each([
    [
      'a member by email',
      'ada@example.com',
      { assigneeType: 'user', assigneeId: 'user-ada' },
    ],
    [
      'a member by user id',
      'user-noah',
      { assigneeType: 'user', assigneeId: 'user-noah' },
    ],
    [
      'an agent of the project',
      'writer',
      { assigneeType: 'agent', assigneeId: 'agent-7' },
    ],
  ])('assigns %s', async (_who, assignee, resolved) => {
    await pgTaskStore(sql).create({ ...ask, assignee });
    expect(vi.mocked(createTask).mock.calls[0]?.[2]).toMatchObject(resolved);
  });

  it('names the workflow engine as the creator when no deployed automation owns the run', async () => {
    vi.mocked(automationOwnerOfWorkflowSlug).mockResolvedValue(null);
    await pgTaskStore(sql).create(ask);
    expect(vi.mocked(createTask).mock.calls[0]?.[3]?.creator).toEqual({
      id: 'workflow',
      type: 'agent',
    });
  });
});

describe('the labels a step names', () => {
  it.each([
    ['an editor started the run', 'user:user-1', 'editor', true],
    ['a trigger started it', 'trigger:t-1', 'editor', true],
    ['a reader started it', 'user:user-1', 'member', false],
  ])(
    'adds what the catalog lacks when %s: %s',
    async (_case, startedBy, role, mint) => {
      vi.mocked(getRun).mockResolvedValue({
        name: 'support/triage',
        projectId: null,
        startedBy,
      } as never);
      vi.mocked(authorizeActorRun).mockResolvedValue({ ...ada, role } as never);
      await pgTaskStore(sql).create({ ...ask, labels: ['support'] });
      expect(vi.mocked(createTask).mock.calls[0]?.[3]?.mintLabels).toBe(mint);
    },
  );
});

describe('a refused task.create [CONN-R24]', () => {
  it('refuses a project the automation is not installed in, writing nothing', async () => {
    vi.mocked(resolveRunProject).mockRejectedValue(
      new AutomationError(
        'AUTOMATION_PROJECT_FORBIDDEN',
        'This automation is not installed in that project.',
        403,
      ),
    );
    await expect(pgTaskStore(sql).create(ask)).resolves.toEqual({
      ok: false,
      refusal: {
        kind: 'project',
        detail: 'This automation is not installed in that project.',
      },
    });
    expect(createTask).not.toHaveBeenCalled();
  });

  it('refuses a run pinned to another project', async () => {
    vi.mocked(getRun).mockResolvedValue({
      name: 'support/triage',
      projectId: 'project-9',
      startedBy: 'user:user-1',
    } as never);
    await expect(pgTaskStore(sql).create(ask)).resolves.toMatchObject({
      ok: false,
      refusal: { kind: 'project' },
    });
  });

  it('refuses an assignee no member or agent answers to', async () => {
    await expect(
      pgTaskStore(sql).create({ ...ask, assignee: 'nobody@example.com' }),
    ).resolves.toMatchObject({ ok: false, refusal: { kind: 'assignee' } });
    expect(createTask).not.toHaveBeenCalled();
  });

  it('refuses an assignee the task domain will not let work in the project', async () => {
    vi.mocked(createTask).mockRejectedValue(
      new TaskError('ASSIGNEE_NO_PROJECT_ACCESS', 'Assignee lacks access'),
    );
    await expect(
      pgTaskStore(sql).create({ ...ask, assignee: 'ada@example.com' }),
    ).resolves.toEqual({
      ok: false,
      refusal: { kind: 'assignee', detail: 'Assignee lacks access' },
    });
  });

  it('lets any other failure through', async () => {
    vi.mocked(createTask).mockRejectedValue(new Error('connection reset'));
    await expect(pgTaskStore(sql).create(ask)).rejects.toThrow(
      'connection reset',
    );
  });

  it('refuses a caller that is not an automation step', async () => {
    await expect(
      pgTaskStore(sql).create({
        ...ask,
        caller: { kind: 'user', userId: 'user-1' },
      }),
    ).rejects.toMatchObject({ code: 'TASK_CREATE_FORBIDDEN' });
  });
});
