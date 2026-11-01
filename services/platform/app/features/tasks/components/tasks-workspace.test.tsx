// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen, within } from '@/tests/utils/render';

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
  /** Every backend read the workspace asked for, with its args. */
  reads: [] as { name: string; args: unknown }[],
  /** The members `GET /members/search` holds, in the order they joined, and
   * how many a page of it holds. */
  people: [] as { userId: string; displayName: string; email: string }[],
  pageSize: 50,
  searchFails: false,
  /** The people the workspace looked up by user id. */
  asked: [] as unknown[],
  agents: [] as { type: 'agent'; id: string; name: string }[],
}));

/** What `GET /members/search` answers: the members whose name or email
 * holds the text, a page at a time. */
function searchAnswer(query: string) {
  if (state.searchFails) {
    return {
      data: undefined,
      isLoading: false,
      isError: true,
      isFetching: false,
      errorUpdateCount: 1,
    };
  }
  const typed = query.toLowerCase();
  const found = state.people.filter(
    (person) =>
      person.displayName.toLowerCase().includes(typed) ||
      person.email.toLowerCase().includes(typed),
  );
  return {
    data: {
      members: found.slice(0, state.pageSize).map((person, index) => ({
        _id: `member-${person.userId}`,
        userId: person.userId,
        displayName: person.displayName,
        email: person.email,
        role: 'member',
        createdAt: index,
      })),
      isDone: found.length <= state.pageSize,
    },
    isLoading: false,
    isError: false,
    isFetching: false,
    errorUpdateCount: 0,
  };
}

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
  useBackendQuery: (name: string, args: 'skip' | { query: string }) => {
    state.reads.push({ name, args });
    if (name === 'members/queries:searchMembers' && args !== 'skip') {
      return searchAnswer(args.query);
    }
    return { data: undefined, isLoading: false };
  },
}));
vi.mock('@/app/features/settings/organization/hooks/member-lookup', async () =>
  (await import('@/tests/utils/member-lookup-stand-in')).memberLookupStandIn(
    () => state.people,
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the stand-in pushes lookup targets onto it
    state.asked as never[],
  ),
);
vi.mock('@/app/hooks/use-current-member-context', () => ({
  useCurrentMemberContext: () => ({ data: { userId: 'u-member' } }),
}));
vi.mock('../hooks/use-actor-directory', () => ({
  useProvidedActorDirectory: () => undefined,
  ActorDirectoryProvider: ({ children }: { children?: unknown }) => children,
  useActorDirectory: () => ({
    members: [],
    agents: state.agents,
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
  state.reads = [];
  state.people = [];
  state.pageSize = 50;
  state.searchFails = false;
  state.asked.length = 0;
  state.agents = [];
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

describe('TasksWorkspace — the assignee filter', () => {
  const ADA = {
    userId: 'u-ada',
    displayName: 'Ada Lovelace',
    email: 'ada@example.com',
  };
  const GRACE = {
    userId: 'u-grace',
    displayName: 'Grace Hopper',
    email: 'grace@example.com',
  };
  const searches = () =>
    state.reads
      .filter((read) => read.name === 'members/queries:searchMembers')
      .map((read) => read.args);

  async function openAssignees() {
    const user = userEvent.setup();
    renderWorkspace();
    await user.click(screen.getByRole('button', { name: 'Filter' }));
    await user.click(screen.getByRole('button', { name: 'Assignee' }));
    return user;
  }

  async function search(
    user: ReturnType<typeof userEvent.setup>,
    text: string,
  ) {
    const box = screen.getByRole('textbox', { name: 'Search people' });
    // The box is read-only until it holds the focus (no autofill).
    await user.click(box);
    await user.clear(box);
    if (text !== '') await user.type(box, text);
    await vi.waitFor(() =>
      expect(searches().at(-1)).toEqual({
        organizationId: 'org-1',
        query: text,
      }),
    );
  }

  it('searches the people only once the filters are first opened, and never reads every member', async () => {
    const user = userEvent.setup();
    renderWorkspace();
    // A board that is only looked at names its people through the lookup.
    expect(searches().length).toBeGreaterThan(0);
    expect(searches()).toEqual(searches().map(() => 'skip'));

    await user.click(screen.getByRole('button', { name: 'Filter' }));

    // Every member may be filtered by, disabled ones too: no project, no
    // access.
    expect(searches().at(-1)).toEqual({ organizationId: 'org-1', query: '' });
    expect(state.reads.map((read) => read.name)).not.toContain(
      'members/queries:listByOrganization',
    );
  });

  it('offers the people the server found for what is typed, and the agents that hold it', async () => {
    state.people = [ADA, GRACE];
    state.agents = [{ type: 'agent', id: 'agent-1', name: 'Release agent' }];
    const user = await openAssignees();
    expect(screen.getByRole('radio', { name: 'You' })).toBeInTheDocument();
    expect(
      screen.getByRole('radio', { name: 'Ada Lovelace' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('radio', { name: 'Grace Hopper' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('radio', { name: 'Release agent' }),
    ).toBeInTheDocument();

    await search(user, 'gr');

    await vi.waitFor(() =>
      expect(screen.queryByRole('radio', { name: 'Ada Lovelace' })).toBeNull(),
    );
    expect(
      screen.getByRole('radio', { name: 'Grace Hopper' }),
    ).toBeInTheDocument();
    // The fixed choices stay; the agent that does not hold it goes.
    expect(screen.getByRole('radio', { name: 'You' })).toBeInTheDocument();
    expect(
      screen.getByRole('radio', { name: 'Unassigned' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Release agent' })).toBeNull();

    await search(user, 'release');
    await vi.waitFor(() =>
      expect(screen.getByText('Release agent')).toBeInTheDocument(),
    );
    expect(screen.queryByRole('radio', { name: 'Grace Hopper' })).toBeNull();
  });

  it('keeps the member it filters by offered when the page found does not hold them', async () => {
    state.people = [ADA, GRACE];
    state.pageSize = 1;
    const user = await openAssignees();
    await search(user, 'grace');
    await vi.waitFor(() =>
      expect(
        screen.getByRole('radio', { name: 'Grace Hopper' }),
      ).toBeInTheDocument(),
    );
    await user.click(screen.getByRole('radio', { name: 'Grace Hopper' }));
    expect(state.asked).toContainEqual({ userId: 'u-grace' });

    // The first page holds Ada alone: Grace stays, chosen, and the panel says
    // more people match.
    await search(user, '');
    await vi.waitFor(() =>
      expect(
        screen.getByRole('radio', { name: 'Ada Lovelace' }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole('radio', { name: 'Grace Hopper' })).toBeChecked();
    expect(
      screen.getByText('More people match — keep typing to narrow the list.'),
    ).toHaveAttribute('role', 'status');

    // A text she does not hold leaves her out.
    await search(user, 'ada');
    await vi.waitFor(() =>
      expect(screen.queryByRole('radio', { name: 'Grace Hopper' })).toBeNull(),
    );
    expect(
      screen.getByRole('radio', { name: 'Ada Lovelace' }),
    ).toBeInTheDocument();
  });

  it('says when nobody holds what is typed', async () => {
    state.people = [ADA];
    const user = await openAssignees();
    await search(user, 'zz');
    await vi.waitFor(() =>
      expect(screen.getByText('No results found')).toHaveAttribute(
        'role',
        'status',
      ),
    );
  });

  it('shows a search still running, and reads out only what it found', async () => {
    state.people = [ADA];
    const user = await openAssignees();
    const status = within(screen.getByRole('dialog')).getByRole('status');
    const box = screen.getByRole('textbox', { name: 'Search people' });
    await user.click(box);
    await user.type(box, 'zz');
    // Typed, not searched yet: seen, never read out.
    expect(screen.getByText('Loading...')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
    expect(status).not.toHaveTextContent('Loading');
    await vi.waitFor(() =>
      expect(status).toHaveTextContent('No results found'),
    );
    expect(screen.queryByText('Loading...')).toBeNull();
  });

  it('says when the people could not be searched', async () => {
    state.searchFails = true;
    await openAssignees();
    expect(
      screen.getByText(
        "People couldn't be searched — try again, or reload the page if it keeps happening.",
      ),
    ).toHaveAttribute('role', 'status');
  });
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
