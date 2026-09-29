import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { fireEvent, render, screen } from '@/tests/utils/render';

import type { TaskDoc } from '../lib/display';
import { TasksList } from './tasks-list';

type TaskRow = TaskDoc;

vi.mock('../hooks/mutations', () => ({
  useMoveTask: () => ({ mutate: vi.fn(), isPending: false }),
  useAssignTask: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateTask: () => ({ mutate: vi.fn(), isPending: false }),
  useCancelTaskAgentRun: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('@/app/hooks/use-backend-client', () => ({
  useBackendClient: () => ({ query: vi.fn(async () => null) }),
}));
vi.mock('@/app/hooks/use-backend-action', () => ({
  useBackendAction: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('../hooks/use-actor-directory', () => ({
  useActorDirectory: () => ({
    members: [],
    agents: [],
    currentUserId: null,
    resolveActor: () => null,
  }),
  useAssignableActors: () => ({
    assignableMembers: [],
    assignableAgents: [],
    agents: [],
    currentUserId: null,
    resolveActor: () => null,
  }),
}));

vi.mock('../hooks/use-task-status-choreography', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../hooks/use-task-status-choreography')
  >()),
  useTaskStatusChoreography: () => async () => 'move' as const,
}));

vi.mock('../hooks/use-task-subject-contract', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../hooks/use-task-subject-contract')
  >()),
  useTaskSubjectContract: () => null,
  useTaskContractAutomations: () => [],
}));

function makeTask(overrides: Partial<TaskRow> = {}): TaskRow {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- minimal fixture; the row renders title/status/archivedAt only
  return {
    _id: 'task_1',
    _creationTime: 0,
    organizationId: 'org_test',
    projectId: 'project_1',
    title: 'Chase the invoice',
    status: 'todo',
    rank: 'a0',
    number: 1,
    projectKey: 'TAL',
    createdBy: 'user_1',
    createdByType: 'user',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  } as unknown as TaskRow;
}

// An archived row was signalled by `opacity-70` alone, which makes colour the
// sole carrier of the meaning (WCAG 2.1 AA 1.4.1).
describe('TasksList archived rows', () => {
  it('gives an archived row the Archived badge', () => {
    render(<TasksList tasks={[makeTask({ archivedAt: 123 })]} />);
    expect(screen.getByText('Chase the invoice')).toBeInTheDocument();
    expect(screen.getByText('Archived')).toBeInTheDocument();
  });

  it('leaves a live row without one', () => {
    render(<TasksList tasks={[makeTask()]} />);
    expect(screen.getByText('Chase the invoice')).toBeInTheDocument();
    expect(screen.queryByText('Archived')).not.toBeInTheDocument();
  });
});

describe('TasksList keyboard access', () => {
  it('tabs through separate priority, title and assignee controls and opens the right task', async () => {
    const onOpenTask = vi.fn();
    const first = makeTask();
    const second = makeTask({
      _id: 'task_2',
      title: 'Send the receipt',
      rank: 'a1',
    });
    const { user } = render(
      <TasksList
        tasks={[first, second]}
        canWorkTask={() => true}
        onOpenTask={onOpenTask}
      />,
    );

    screen.getByRole('button', { name: 'To do 2' }).focus();
    await user.tab();
    expect(
      screen.getAllByRole('button', { name: 'Priority' })[0],
    ).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: first.title })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onOpenTask).toHaveBeenLastCalledWith(first);
    await user.tab();
    expect(screen.getAllByRole('button', { name: 'Assign' })[0]).toHaveFocus();
    await user.tab();
    await user.tab();
    expect(screen.getByRole('button', { name: second.title })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onOpenTask).toHaveBeenLastCalledWith(second);
    expect(onOpenTask).toHaveBeenCalledTimes(2);
  });

  it('keeps subtask expansion and inline pickers separate from opening', async () => {
    const onOpenTask = vi.fn();
    const parent = makeTask();
    const child = makeTask({
      _id: 'child_1',
      parentTaskId: parent._id,
      title: 'Check the total',
    });
    const { user, container } = render(
      <TasksList
        tasks={[parent, child]}
        canWorkTask={() => true}
        onOpenTask={onOpenTask}
      />,
    );

    screen.getByRole('button', { name: 'Subtasks' }).focus();
    await user.keyboard('{Enter}');
    expect(
      screen.getByRole('button', { name: child.title }),
    ).toBeInTheDocument();
    expect(onOpenTask).not.toHaveBeenCalled();
    screen.getAllByRole('button', { name: 'Priority' })[0]?.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(onOpenTask).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    screen.getAllByRole('button', { name: 'Assign' })[0]?.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(onOpenTask).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');

    const title = screen.getByRole('button', { name: child.title });
    expect(title).not.toHaveAttribute('aria-roledescription');
    title.focus();
    await user.keyboard(' ');
    expect(onOpenTask).toHaveBeenCalledExactlyOnceWith(child);
    await checkAccessibility(container);
  });

  it.each([{ canEdit: false }, { canEdit: true, archivedAt: 123 }])(
    'opens a non-draggable row on Space without announcing it disabled (%j)',
    async ({ canEdit, archivedAt }) => {
      const task = makeTask({ archivedAt });
      const onOpenTask = vi.fn();
      const { user } = render(
        <TasksList
          tasks={[task]}
          canWorkTask={() => canEdit}
          onOpenTask={onOpenTask}
        />,
      );
      const title = screen.getByRole('button', { name: task.title });
      expect(title).not.toHaveAttribute('aria-disabled');
      expect(title).not.toHaveAttribute('aria-roledescription');
      title.focus();
      await user.keyboard(' ');
      expect(onOpenTask).toHaveBeenCalledExactlyOnceWith(task);
    },
  );

  it('uses Space for dragging an editable row without opening it on keyup', async () => {
    const task = makeTask();
    const onOpenTask = vi.fn();
    const { user } = render(
      <TasksList
        tasks={[task]}
        canWorkTask={() => true}
        onOpenTask={onOpenTask}
      />,
    );
    const title = screen.getByRole('button', { name: task.title });
    title.focus();
    await user.keyboard(' ');
    expect(
      screen.getAllByRole('button', { name: task.title }).length,
    ).toBeGreaterThan(1);
    expect(onOpenTask).not.toHaveBeenCalled();
    for (const current of screen.getAllByRole('button', { name: task.title })) {
      expect(fireEvent.keyUp(current, { key: ' ' })).toBe(false);
    }
    await user.keyboard('{Escape}');
    expect(screen.getAllByRole('button', { name: task.title })).toHaveLength(1);
    expect(onOpenTask).not.toHaveBeenCalled();
  });

  it('opens once when clicking the title or sibling metadata', async () => {
    const task = makeTask({ commentCount: 2 });
    const onOpenTask = vi.fn();
    const { user } = render(
      <TasksList tasks={[task]} onOpenTask={onOpenTask} />,
    );
    await user.click(screen.getByRole('button', { name: task.title }));
    expect(onOpenTask).toHaveBeenCalledExactlyOnceWith(task);
    await user.click(screen.getByText('TAL-1'));
    expect(onOpenTask).toHaveBeenCalledTimes(2);
    expect(onOpenTask).toHaveBeenLastCalledWith(task);
  });
});
