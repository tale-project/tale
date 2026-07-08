import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Doc } from '@/convex/_generated/dataModel';
import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, within } from '@/tests/utils/render';

import { TasksBacklog } from './tasks-backlog';

type TaskRow = Doc<'tasks'>;

// Referenced lazily (at hook-call time) from the mock factories below, so the
// hoisted `vi.mock` calls never hit the TDZ — same pattern as the customers
// table test.
const updateStatusMutate = vi.fn();
const assignMutate = vi.fn();

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org_test',
}));

vi.mock('../hooks/mutations', () => ({
  useUpdateTaskStatus: () => ({
    mutate: updateStatusMutate,
    isPending: false,
  }),
  useAssignTask: () => ({ mutate: assignMutate, isPending: false }),
}));

// The assignee cell reuses the List's AssigneePicker, which reads the member/
// agent directory — stub the directory so no Convex client is needed.
vi.mock('../hooks/use-actor-directory', () => ({
  useActorDirectory: () => ({
    members: [],
    agents: [],
    currentUserId: null,
    resolveActor: () => null,
  }),
}));

function makeTask(overrides: Partial<TaskRow> & { title: string }): TaskRow {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- minimal fixture; the table renders title/description/createdAt and passes _id to the mutations
  return {
    _id: `task_${overrides.title}`,
    _creationTime: 0,
    organizationId: 'org_test',
    projectId: 'project_1',
    status: 'backlog',
    rank: 'a0',
    number: 1,
    createdBy: 'user_1',
    createdByType: 'user',
    createdAt: 1_719_878_400_000,
    updatedAt: 1_719_878_400_000,
    ...overrides,
  } as unknown as TaskRow;
}

/** The backlog data row whose title cell contains `title`. */
function backlogRow(title: string): HTMLElement {
  const row = screen
    .getAllByRole('row')
    .find((candidate) => within(candidate).queryByText(title) !== null);
  if (!row) throw new Error(`no row for "${title}"`);
  return row;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('TasksBacklog', () => {
  it('renders a triage row per proposed task (identifier, title, snippet)', () => {
    render(
      <TasksBacklog
        tasks={[
          makeTask({
            title: '#1337 Add button to header',
            number: 7,
            description: 'Reported via GitHub.\nSecond line.',
          }),
        ]}
        projectKey="TAL"
        canEdit
      />,
    );

    const row = backlogRow('#1337 Add button to header');
    // Identifier column formats projectKey + number like the List rows do.
    expect(within(row).getByText('TAL-7')).toBeInTheDocument();
    // The description snippet is collapsed to one line.
    expect(
      within(row).getByText('Reported via GitHub. Second line.'),
    ).toBeInTheDocument();
  });

  it('Start moves the task to todo via the status mutation', async () => {
    const { user } = render(
      <TasksBacklog
        tasks={[makeTask({ title: 'Proposed A' })]}
        projectKey="TAL"
        canEdit
      />,
    );

    await user.click(
      within(backlogRow('Proposed A')).getByRole('button', { name: 'Start' }),
    );
    expect(updateStatusMutate).toHaveBeenCalledWith({
      taskId: 'task_Proposed A',
      status: 'todo',
    });
  });

  it('Close cancels the task via the status mutation and does not open it', async () => {
    const onOpenTask = vi.fn();
    const { user } = render(
      <TasksBacklog
        tasks={[makeTask({ title: 'Proposed B' })]}
        projectKey="TAL"
        canEdit
        onOpenTask={onOpenTask}
      />,
    );

    await user.click(
      within(backlogRow('Proposed B')).getByRole('button', { name: 'Close' }),
    );
    expect(updateStatusMutate).toHaveBeenCalledWith({
      taskId: 'task_Proposed B',
      status: 'cancelled',
    });
    // The verb click must not bubble into the row's open-task handler.
    expect(onOpenTask).not.toHaveBeenCalled();
  });

  it('row click opens the task detail (like the List)', async () => {
    const onOpenTask = vi.fn();
    const task = makeTask({ title: 'Proposed C' });
    const { user } = render(
      <TasksBacklog
        tasks={[task]}
        projectKey="TAL"
        canEdit
        onOpenTask={onOpenTask}
      />,
    );

    await user.click(within(backlogRow('Proposed C')).getByText('Proposed C'));
    expect(onOpenTask).toHaveBeenCalledWith(task);
  });

  it('hides the triage verbs for read-only viewers', () => {
    render(
      <TasksBacklog
        tasks={[makeTask({ title: 'Proposed D' })]}
        projectKey="TAL"
        canEdit={false}
      />,
    );

    expect(
      screen.queryByRole('button', { name: 'Start' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Close' }),
    ).not.toBeInTheDocument();
  });

  it('shows the localized proposed-tasks empty state', () => {
    render(<TasksBacklog tasks={[]} projectKey="TAL" canEdit />);

    expect(screen.getByText('No tasks to triage')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Tasks proposed by automations or teammates land here until you start or close them.',
      ),
    ).toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <TasksBacklog
        tasks={[
          makeTask({ title: 'Proposed E', description: 'From issue sync' }),
        ]}
        projectKey="TAL"
        canEdit
      />,
    );
    await checkAccessibility(container);
  });
});
