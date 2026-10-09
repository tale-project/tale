// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import type { TaskDoc, TaskStatus } from '../lib/display';
import { useTaskBoardContext } from './task-board-context';
import type { TaskRow } from './task-card';
import { BlockedIndicator } from './task-indicators';
import { TasksWorkspace } from './tasks-workspace';

/**
 * The project's Tasks page under the task rule: every reader of an active
 * project gets the create action, and the board is told, task by task, which
 * cards the viewer may work — a member their own, an editor every one.
 */

const state = vi.hoisted(() => ({
  canEdit: false,
  canCreate: true,
  archived: false,
  tasks: [] as TaskDoc[],
  blockerResolved: false,
}));

const task = (id: string, overrides: Partial<TaskDoc> = {}): TaskDoc => ({
  _id: id,
  _creationTime: 0,
  organizationId: 'org-1',
  projectId: 'project-1',
  title: `Task ${id}`,
  status: 'todo',
  rank: 'a0',
  createdBy: 'u-editor',
  createdByType: 'user',
  createdAt: 0,
  updatedAt: 0,
  ...overrides,
});

vi.mock('../hooks/queries', () => {
  // Every read answered; `tasks-workspace.read-state.test.tsx` owns the rest.
  const answered = {
    read: { kind: 'ready', updating: false },
    retry: () => {},
  };
  const board = (
    _projectId: unknown,
    options?: { query?: string; assigneeId?: string },
  ) => ({
    tasks: state.tasks.filter(
      (row) =>
        (!options?.query || row.title.includes(options.query)) &&
        (!options?.assigneeId || row.assigneeId === options.assigneeId),
    ),
    truncated: false,
    canEdit: state.canEdit,
    canCreate: state.canCreate,
    isLoading: false,
    ...answered,
  });
  const ops = {
    runningTaskIds: [],
    askingTaskIds: [],
    pendingReviews: [],
    ...answered,
  };
  return {
    useTasksByProject: board,
    useTasksAcrossProjects: board,
    useProjectDependencies: () => ({
      edges: [
        {
          blockerTaskId: 'blocker',
          blockedTaskId: 'target',
          blockerResolved: state.blockerResolved,
        },
      ],
      isLoading: false,
      ...answered,
    }),
    useTaskOpsIndicators: () => ops,
    useTaskOpsIndicatorsAcrossProjects: () => ops,
  };
});
vi.mock('@/app/features/projects/hooks/queries', () => ({
  useProject: () => ({
    project: {
      key: 'CON',
      canEdit: state.canEdit,
      ...(state.archived ? { archivedAt: 1 } : {}),
    },
    isLoading: false,
  }),
}));
vi.mock('@/app/hooks/use-backend-query', () => ({
  useBackendQuery: () => ({ data: undefined, isLoading: false }),
}));
vi.mock('@/app/hooks/use-current-member-context', () => ({
  useCurrentMemberContext: () => ({ data: { userId: 'u-member' } }),
}));
vi.mock('../hooks/use-actor-directory', () => ({
  useProvidedActorDirectory: () => undefined,
  ActorDirectoryProvider: ({ children }: { children?: unknown }) => children,
  useActorDirectory: () => ({
    members: [],
    agents: [],
    currentUserId: 'u-member',
  }),
}));
// The board and the sheet have suites of their own; here they only report
// what the workspace decided for each card.
vi.mock('./kanban-board', () => ({
  KanbanBoard: ({
    tasks,
    canWorkTask,
    collapsedLanes,
    onLaneCollapsedChange,
  }: {
    tasks: TaskRow[];
    canWorkTask: (task: TaskRow) => boolean;
    collapsedLanes?: ReadonlySet<TaskStatus>;
    onLaneCollapsedChange?: (status: TaskStatus, collapsed: boolean) => void;
  }) => {
    const { isBlocked } = useTaskBoardContext();
    return (
      <ul
        data-testid="board"
        data-folded={[...(collapsedLanes ?? [])].join(',')}
      >
        <li>
          <button onClick={() => onLaneCollapsedChange?.('done', true)}>
            Fold test lane
          </button>
        </li>
        {tasks.map((row) => (
          <li key={row._id}>
            {row.title}: {canWorkTask(row) ? 'workable' : 'read-only'}
            <BlockedIndicator blocked={isBlocked(row._id)} />
          </li>
        ))}
      </ul>
    );
  },
}));
vi.mock('./task-modal', () => ({ TaskModal: () => null }));

function renderWorkspace() {
  return render(
    <TasksWorkspace
      organizationId="org-1"
      projectId="project-1"
      view="board"
      onViewChange={vi.fn()}
    />,
  );
}

beforeEach(() => {
  state.canEdit = false;
  state.canCreate = true;
  state.archived = false;
  state.blockerResolved = false;
  state.tasks = [
    task('own', { createdBy: 'u-member' }),
    task('assigned', { assigneeType: 'user', assigneeId: 'u-member' }),
    task('others'),
  ];
});

describe('TasksWorkspace — who creates and who works', () => {
  it('gives a member the create action and their own tasks to work', () => {
    renderWorkspace();

    expect(
      screen.getByRole('button', { name: 'Create task' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Task own: workable')).toBeInTheDocument();
    expect(screen.getByText('Task assigned: workable')).toBeInTheDocument();
    expect(screen.getByText('Task others: read-only')).toBeInTheDocument();
  });

  it('gives a member the subtasks an agent added under their own task', () => {
    state.tasks = [
      task('own', { createdBy: 'u-member' }),
      task('split', {
        parentTaskId: 'own',
        createdBy: 'agent-1',
        createdByType: 'agent',
      }),
      task('others'),
      task('theirs', {
        parentTaskId: 'others',
        createdBy: 'agent-1',
        createdByType: 'agent',
      }),
    ];
    renderWorkspace();

    expect(screen.getByText('Task split: workable')).toBeInTheDocument();
    expect(screen.getByText('Task theirs: read-only')).toBeInTheDocument();
  });

  it('gives an editor every task to work, as before', () => {
    state.canEdit = true;
    renderWorkspace();

    expect(
      screen.getByRole('button', { name: 'Create task' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Task others: workable')).toBeInTheDocument();
  });

  it('offers no create action on a project that takes no tasks', () => {
    // An archived project answers both flags false: it is read-only for
    // every role.
    state.canCreate = false;
    state.archived = true;
    renderWorkspace();

    expect(screen.queryByRole('button', { name: 'Create task' })).toBeNull();
    expect(screen.getByText('Task own: read-only')).toBeInTheDocument();
  });
});

afterEach(() => {
  for (const scope of ['project-1', 'all']) {
    window.localStorage.removeItem(
      `tale.platform.tasks.board.collapsedLanes.${scope}`,
    );
  }
});

describe('TasksWorkspace persisted lane handoff', () => {
  it.each([false, true])(
    'recovers invalid preferences with allProjects=%s',
    async (allProjects) => {
      const scope = allProjects ? 'all' : 'project-1';
      const key = `tale.platform.tasks.board.collapsedLanes.${scope}`;
      window.localStorage.setItem(key, '{}');
      const { user } = render(
        <TasksWorkspace
          organizationId="org-1"
          projectId="project-1"
          view="board"
          allProjects={allProjects}
          onViewChange={vi.fn()}
        />,
      );
      expect(screen.getByTestId('board')).toHaveAttribute('data-folded', '');
      await user.click(screen.getByRole('button', { name: 'Fold test lane' }));
      expect(screen.getByTestId('board')).toHaveAttribute(
        'data-folded',
        'done',
      );
      expect(window.localStorage.getItem(key)).toBe('["done"]');
    },
  );
});

describe('TasksWorkspace — filter-independent blockers', () => {
  beforeEach(() => {
    state.tasks = [
      task('blocker', { title: 'Live predecessor', priority: 'p3' }),
      task('target', {
        title: 'Filter blocked target',
        assigneeType: 'user',
        assigneeId: 'u-member',
        priority: 'p1',
        status: 'in_review',
        reviewerUserId: 'u-member',
      }),
    ];
  });

  it('keeps Blocked after search hides the live predecessor', async () => {
    const user = userEvent.setup();
    renderWorkspace();
    expect(screen.getByLabelText('Blocked')).toBeInTheDocument();
    await user.type(
      screen.getByRole('textbox', { name: 'Search tasks' }),
      'Filter blocked target',
    );
    await vi.waitFor(() =>
      expect(
        screen.queryByText('Live predecessor: read-only'),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByLabelText('Blocked')).toBeInTheDocument();
  });

  it.each([
    ['Assignee', 'You'],
    ['Priority', 'High'],
    ['Review', 'Needs my review'],
  ])(
    'keeps Blocked when the %s filter hides the live predecessor',
    async (filter, option) => {
      const user = userEvent.setup();
      renderWorkspace();
      await user.click(screen.getByRole('button', { name: 'Filter' }));
      await user.click(screen.getByRole('button', { name: filter }));
      await user.click(
        screen.getByRole(filter === 'Review' ? 'checkbox' : 'radio', {
          name: option,
        }),
      );
      expect(
        screen.queryByText('Live predecessor: read-only'),
      ).not.toBeInTheDocument();
      expect(screen.getByLabelText('Blocked')).toBeInTheDocument();
    },
  );

  it('removes Blocked when the server resolves a hidden predecessor', () => {
    state.tasks = state.tasks.filter((row) => row._id === 'target');
    const { rerender } = renderWorkspace();
    expect(screen.getByLabelText('Blocked')).toBeInTheDocument();
    state.blockerResolved = true;
    rerender(
      <TasksWorkspace
        organizationId="org-1"
        projectId="project-1"
        view="board"
        onViewChange={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText('Blocked')).not.toBeInTheDocument();
  });
});
