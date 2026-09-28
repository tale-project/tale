// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { startOfCalendarDate, type TaskRepeat } from '@/lib/shared/task-repeat';
import { render, screen, waitFor, within } from '@/tests/utils/render';

import type { TaskDoc } from '../lib/display';
import { TaskModal } from './task-modal';

const state = vi.hoisted(() => ({
  tasks: {} as Record<string, Record<string, unknown>>,
  automations: [] as Record<string, unknown>[],
  canEdit: true,
  mutateAsync: vi.fn(async (): Promise<unknown> => null),
}));

const baseTask = {
  _id: 'task-repeat',
  _creationTime: 0,
  organizationId: 'org-repeat',
  projectId: 'project-repeat',
  title: 'Water the plants',
  status: 'todo',
  rank: 'a0',
  number: 1,
  createdBy: 'user-repeat',
  createdByType: 'user',
  createdAt: 0,
  updatedAt: 0,
} satisfies TaskDoc;

const weekly: TaskRepeat = {
  frequency: 'weekly',
  interval: 1,
  weekdays: [1],
  timezone: 'Europe/Zurich',
};

/** A deployed automation whose task contract owns the tasks assigned to it. */
const invoiceIntake = {
  name: 'invoice-intake',
  deployedVersion: 1,
  taskContract: { workflow: 'invoice-intake' },
  presentation: { name: 'Invoice intake' },
};

// Stub I/O, not the modal or its pickers: the Repeat row's state and what
// it writes are the modal's own decisions.
vi.mock('@/app/hooks/use-backend-query', () => ({
  useBackendQuery: (name: string, args: unknown) => {
    const taskId =
      typeof args === 'object' && args !== null && 'taskId' in args
        ? args.taskId
        : undefined;
    if (name === 'tasks/queries:getTask' && typeof taskId === 'string') {
      const task = state.tasks[taskId];
      return {
        data: task
          ? { task, canEdit: state.canEdit, canComment: false }
          : undefined,
        isLoading: false,
      };
    }
    if (name === 'projects/queries:getProject' && args !== 'skip') {
      return { data: { key: 'OPS', name: 'Operations' }, isLoading: false };
    }
    // The organization-level listing carries the automation; the
    // project-level one (listed beside it) has none of its own.
    if (name === 'automations/queries:listAutomations' && args !== 'skip') {
      const projectLevel =
        typeof args === 'object' && args !== null && 'projectId' in args;
      return { data: projectLevel ? [] : state.automations, isLoading: false };
    }
    return { data: undefined, isLoading: false };
  },
}));
vi.mock('@/app/hooks/use-backend-mutation', () => ({
  useBackendMutation: () => ({
    mutateAsync: state.mutateAsync,
    isPending: false,
  }),
}));
vi.mock('@/app/hooks/use-backend-action', () => ({
  useBackendAction: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/app/hooks/use-backend-client', () => ({
  useBackendClient: () => ({ query: vi.fn(async () => null) }),
}));
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-repeat',
}));
vi.mock('@/app/hooks/use-current-member-context', () => ({
  useCurrentMemberContext: () => ({ data: { userId: 'user-repeat' } }),
}));
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
}));
vi.mock('../hooks/use-actor-directory', () => ({
  useActorDirectory: () => ({
    members: [],
    agents: [],
    resolveActor: () => ({ name: 'Test owner' }),
  }),
  useAssignableActors: () => ({
    assignableMembers: [],
    assignableAgents: [],
    agents: [],
    resolveActor: () => ({ name: 'Invoice intake' }),
  }),
}));
vi.mock('@/app/features/shared/files/use-file-upload', () => ({
  useFileUpload: () => ({ attachments: [], uploadingFiles: [] }),
}));
vi.mock('./task-comments', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./task-comments')>()),
  TaskComments: () => null,
  TaskCommentComposer: () => null,
  TaskCommentComposerSkeleton: () => null,
}));
vi.mock('./task-timeline', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./task-timeline')>()),
  TaskTimeline: () => null,
}));
vi.mock('./task-attachments', () => ({ TaskAttachments: () => null }));

function renderModal(taskId?: string) {
  return render(
    <TaskModal
      open
      onOpenChange={vi.fn()}
      organizationId="org-repeat"
      projectId="project-repeat"
      taskId={taskId}
    />,
  );
}

function openTask(task: Record<string, unknown>, others: TaskDoc[] = []) {
  state.tasks = Object.fromEntries(
    [task, ...others].map((entry) => [entry._id, entry]),
  );
  return renderModal(baseTask._id);
}

function repeatTrigger() {
  return screen.queryByRole('button', { name: /^Repeat:/ });
}

beforeEach(() => {
  state.tasks = {};
  state.automations = [];
  state.canEdit = true;
  state.mutateAsync.mockClear();
});

describe('TaskModal — the create form’s Repeat row', () => {
  // The property panel is wide enough that every preset label and the Due
  // date's full date fit beside their names.
  it('lays the panel out at 17rem', async () => {
    renderModal();
    const trigger = await screen.findByRole('button', {
      name: 'Repeat: Never',
    });
    expect(trigger.closest('aside')).toHaveClass('md:w-[17rem]');
  });

  // A task created straight into Done would never come back; choosing a
  // closed status drops the rule and locks the row, so reopening the status
  // does not revive it unseen.
  it('locks the row and drops the rule while a closed status is chosen', async () => {
    const { user } = renderModal();
    await user.click(
      await screen.findByRole('button', { name: 'Repeat: Never' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Repeat' });
    await user.click(within(dialog).getByRole('radio', { name: 'Daily' }));
    expect(
      await screen.findByRole('button', { name: 'Repeat: Daily' }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Status' }));
    await user.click(await screen.findByRole('option', { name: /Done/ }));
    const locked = await screen.findByRole('button', {
      name: 'Repeat: Never',
    });
    expect(locked).toHaveAttribute('aria-disabled', 'true');
    expect(locked).toHaveAccessibleDescription('Only open tasks repeat.');

    await user.click(screen.getByRole('button', { name: 'Status' }));
    await user.click(await screen.findByRole('option', { name: /To do/ }));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Repeat: Never' }),
      ).not.toHaveAttribute('aria-disabled'),
    );
  });

  it('locks the row once an automation is the assignee', async () => {
    state.automations = [invoiceIntake];
    const { user } = renderModal();
    await user.click(
      await screen.findByRole('button', { name: 'Repeat: Never' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Repeat' });
    await user.click(within(dialog).getByRole('radio', { name: 'Daily' }));

    await user.click(screen.getByRole('button', { name: 'Assign' }));
    await user.click(
      await screen.findByRole('option', { name: /Invoice intake/ }),
    );
    const locked = await screen.findByRole('button', {
      name: 'Repeat: Never',
    });
    expect(locked).toHaveAttribute('aria-disabled', 'true');
    expect(locked).toHaveAccessibleDescription(
      "An automation runs this task, so it doesn't repeat.",
    );
  });
});

describe('TaskModal — the details panel’s Repeat row', () => {
  it('offers the rule on an open top-level task, with the mode', async () => {
    openTask({ ...baseTask, repeat: weekly });
    const trigger = await screen.findByRole('button', {
      name: 'Repeat: Weekly, Mon',
    });
    expect(trigger).not.toHaveAttribute('aria-disabled');
    expect(trigger).toHaveAccessibleDescription(
      'Weekly on Monday The next task is created when this one is done or cancelled.',
    );
  });

  it('says a subtask comes back with its repeating parent', async () => {
    const parent = {
      ...baseTask,
      _id: 'task-parent',
      number: 3,
      repeat: weekly,
    };
    openTask({ ...baseTask, parentTaskId: parent._id }, [parent]);
    const line = await screen.findByRole('button', {
      name: 'Repeat: With OPS-3',
    });
    expect(line).toHaveAttribute('aria-disabled', 'true');
    expect(line).toHaveAccessibleDescription(
      'This subtask comes back with OPS-3: each time OPS-3 repeats, its next task gets a fresh copy of it.',
    );
  });

  // Archived subtasks are left out of the parent's next task.
  it('has no row on an archived subtask of a repeating parent', async () => {
    const parent = {
      ...baseTask,
      _id: 'task-parent',
      number: 3,
      repeat: weekly,
    };
    openTask({ ...baseTask, parentTaskId: parent._id, archivedAt: 1 }, [
      parent,
    ]);
    expect(
      await screen.findByRole('button', { name: 'Part of OPS-3' }),
    ).toBeInTheDocument();
    expect(repeatTrigger()).toBeNull();
    expect(screen.queryByText('With OPS-3')).toBeNull();
  });

  it('has no row on a subtask whose parent does not repeat', async () => {
    const parent = { ...baseTask, _id: 'task-parent', number: 3 };
    openTask({ ...baseTask, parentTaskId: parent._id }, [parent]);
    // The parent link is there, so the parent has been read.
    expect(
      await screen.findByRole('button', { name: 'Part of OPS-3' }),
    ).toBeInTheDocument();
    expect(repeatTrigger()).toBeNull();
    expect(screen.queryByText('Repeat')).toBeNull();
  });

  // Assigned to an automation whose contract this browser cannot resolve:
  // the row stays under Due date and says why the task does not repeat.
  it('locks the row on a task an unresolved automation owns', async () => {
    openTask({
      ...baseTask,
      assigneeType: 'app',
      assigneeId: 'retired-intake',
    });
    const locked = await screen.findByRole('button', {
      name: 'Repeat: Never',
    });
    expect(locked).toHaveAttribute('aria-disabled', 'true');
    expect(locked).toHaveAccessibleDescription(
      "An automation runs this task, so it doesn't repeat.",
    );
    expect(screen.queryByText('More fields')).toBeNull();
  });

  // A task an automation's contract owns folds its board vocabulary away;
  // the Repeat row goes first in that fold.
  it('moves the locked row into More fields on a contract-owned task', async () => {
    state.automations = [invoiceIntake];
    openTask({
      ...baseTask,
      assigneeType: 'app',
      assigneeId: 'invoice-intake',
    });
    const fold = (await screen.findByText('More fields')).closest('details');
    expect(fold).not.toBeNull();
    const locked = within(fold as HTMLElement).getByRole('button', {
      name: 'Repeat: Never',
      hidden: true,
    });
    expect(locked).toHaveAttribute('aria-disabled', 'true');
  });

  it('locks a closed task’s rule, saying how to change it', async () => {
    openTask({ ...baseTask, status: 'done', repeat: weekly });
    const locked = await screen.findByRole('button', {
      name: 'Repeat: Weekly, Mon',
    });
    expect(locked).toHaveAttribute('aria-disabled', 'true');
    expect(locked).toHaveAccessibleDescription(
      'Weekly on Monday The next task is created when this one is done or cancelled. Reopen this task to change how it repeats.',
    );
  });

  it('points a continued series at its next task', async () => {
    const next = { ...baseTask, _id: 'task-next', number: 8, repeat: weekly };
    openTask(
      {
        ...baseTask,
        status: 'done',
        repeat: weekly,
        repeatNextTaskId: next._id,
        repeatContinued: true,
      },
      [next],
    );
    const locked = await screen.findByRole('button', {
      name: 'Repeat: Weekly, Mon',
    });
    // Its own rule, and where the series went — not when this task would
    // create a next one, which it never does again.
    expect(locked).toHaveAccessibleDescription(
      'Weekly on Monday This series continues on OPS-8. Change the repeat there.',
    );
    expect(
      screen.getByRole('button', { name: 'Next task: OPS-8' }),
    ).toBeInTheDocument();
  });

  // The toast's "Stop repeating" is brief and, over this dialog, out of
  // the keyboard's reach: the action stays beside the next task's link.
  it('keeps Stop repeating beside the next task while the series goes on', async () => {
    const next = { ...baseTask, _id: 'task-next', number: 8, repeat: weekly };
    const { user } = openTask(
      {
        ...baseTask,
        status: 'done',
        repeat: weekly,
        repeatNextTaskId: next._id,
        repeatContinued: true,
      },
      [next],
    );
    const link = await screen.findByRole('button', {
      name: 'Next task: OPS-8',
    });
    const stop = screen.getByRole('button', { name: 'Stop repeating' });
    expect(stop.parentElement).toBe(link.parentElement);
    state.mutateAsync.mockResolvedValueOnce({ removedNextTask: true });
    await user.click(stop);
    expect(state.mutateAsync).toHaveBeenCalledWith({
      taskId: baseTask._id,
      nextTaskId: next._id,
    });
  });

  // The button leaves once the stop goes through: focus goes on to the
  // row's Repeat control rather than falling back to the dialog.
  it.each([
    ['takes the next task back', true],
    ['keeps the next task', false],
  ])(
    'hands focus back to the Repeat row once a stop %s',
    async (_case, removedNextTask) => {
      const next = { ...baseTask, _id: 'task-next', number: 8, repeat: weekly };
      const { user } = openTask(
        {
          ...baseTask,
          status: 'done',
          repeat: weekly,
          repeatNextTaskId: next._id,
          repeatContinued: true,
        },
        [next],
      );
      const stop = await screen.findByRole('button', {
        name: 'Stop repeating',
      });
      stop.focus();
      state.mutateAsync.mockResolvedValueOnce({ removedNextTask });
      await user.keyboard('{Enter}');
      await waitFor(() =>
        expect(
          screen.queryByRole('button', { name: 'Stop repeating' }),
        ).toBeNull(),
      );
      expect(
        screen.getByRole('button', { name: 'Repeat: Weekly, Mon' }),
      ).toHaveFocus();
    },
  );

  // Stopped here, or the next task set to Never: the row says the series
  // stopped instead of sending anyone to change it there.
  it.each<[string, Partial<TaskDoc>, Partial<TaskDoc>, string, string]>([
    [
      'this task was stopped, its next task kept',
      { repeat: undefined },
      { repeat: undefined },
      'Repeat: Never',
      'This series has stopped.',
    ],
    [
      'its next task no longer repeats',
      {},
      { repeat: undefined },
      'Repeat: Weekly, Mon',
      'Weekly on Monday This series has stopped.',
    ],
  ])(
    'says the series has stopped once %s',
    async (_case, taskOverrides, nextOverrides, name, description) => {
      const next = {
        ...baseTask,
        _id: 'task-next',
        number: 8,
        repeat: weekly,
        ...nextOverrides,
      };
      openTask(
        {
          ...baseTask,
          status: 'done',
          repeat: weekly,
          repeatNextTaskId: next._id,
          repeatContinued: true,
          ...taskOverrides,
        },
        [next],
      );
      const locked = await screen.findByRole('button', { name });
      expect(locked).toHaveAttribute('aria-disabled', 'true');
      expect(locked).toHaveAccessibleDescription(description);
      expect(
        screen.getByRole('button', { name: 'Next task: OPS-8' }),
      ).toBeInTheDocument();
    },
  );

  // A due-date series continued while the task stayed open, and that next
  // task was deleted since: the task never continues again, so the row is
  // locked on its own rule, with nothing left to open or stop.
  it('says this task cannot repeat again once its next task was deleted', async () => {
    openTask({
      ...baseTask,
      status: 'todo',
      repeat: { ...weekly, createOn: 'dueDate' },
      repeatContinued: true,
    });
    const locked = await screen.findByRole('button', {
      name: 'Repeat: Weekly, Mon',
    });
    expect(locked).toHaveAttribute('aria-disabled', 'true');
    expect(locked).toHaveAccessibleDescription(
      'Weekly on Monday Its next task was deleted. This task cannot repeat again.',
    );
    expect(screen.queryByRole('button', { name: /^Next task/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Stop repeating' })).toBeNull();
  });

  it.each<[string, { canEdit?: boolean }, Partial<TaskDoc>, Partial<TaskDoc>]>([
    ['without the right to change the task', { canEdit: false }, {}, {}],
    ['on an archived task', {}, { archivedAt: 1 }, {}],
    // Someone set the next task to Never: the series already ended.
    ['once the next task no longer repeats', {}, {}, { repeat: undefined }],
    // Stopped, with the next task kept: neither carries the rule.
    [
      'once the series was stopped',
      {},
      { repeat: undefined },
      { repeat: undefined },
    ],
  ])(
    'offers no Stop repeating %s',
    async (_case, viewer, taskOverrides, nextOverrides) => {
      state.canEdit = viewer.canEdit ?? true;
      const next = {
        ...baseTask,
        _id: 'task-next',
        number: 8,
        repeat: weekly,
        ...nextOverrides,
      };
      openTask(
        {
          ...baseTask,
          status: 'done',
          repeat: weekly,
          repeatNextTaskId: next._id,
          repeatContinued: true,
          ...taskOverrides,
        },
        [next],
      );
      expect(
        await screen.findByRole('button', { name: 'Next task: OPS-8' }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Stop repeating' }),
      ).toBeNull();
    },
  );

  // With only a start date ahead, the first due date is on or after it —
  // never before it, which the server refuses as an out-of-order schedule.
  it('dates a new series no earlier than a later start date', async () => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const start = startOfCalendarDate({ year: 2099, month: 3, day: 2 }, zone);
    const { user } = openTask({ ...baseTask, startDate: start });
    await user.click(
      await screen.findByRole('button', { name: 'Repeat: Never' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Repeat' });
    await user.click(within(dialog).getByRole('radio', { name: 'Daily' }));
    expect(state.mutateAsync).toHaveBeenCalledWith({
      taskId: baseTask._id,
      repeat: { frequency: 'daily', interval: 1, timezone: zone },
      dueDate: start,
    });
  });
});
