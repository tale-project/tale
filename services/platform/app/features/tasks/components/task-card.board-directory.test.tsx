// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import {
  useActorDirectory,
  useAssignableActors,
} from '../hooks/use-actor-directory';
import type { TaskCreatorType, TaskDoc } from '../lib/display';
import { KanbanBoard } from './kanban-board';
import {
  type BoardActorDirectory,
  TaskBoardProvider,
} from './task-board-context';

// #4062: a 2,000-card board read two actor directories per card and mounted
// every closed assignee list (17 react-query observers a card). These cases
// hold the board to one directory and to lists that mount on first use.

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

const ownResolve = (type: TaskCreatorType, id: string) => ({
  type,
  id,
  name: `own ${id}`,
  isAgent: type === 'agent',
});

vi.mock('../hooks/use-actor-directory', () => ({
  useActorDirectory: vi.fn(() => ({
    currentUserId: 'user_1',
    resolveActor: ownResolve,
  })),
  useAssignableActors: vi.fn(() => ({
    assignableMembers: [{ type: 'user', id: 'user_1', name: 'Me' }],
    assignableAgents: [],
    agentsLoading: false,
    currentUserId: 'user_1',
    resolveActor: ownResolve,
    canAddAgents: false,
    projectResolved: true,
    standardAgentAvailable: false,
  })),
}));

// The contract/choreography hooks reach the backend; the cards' names are
// what these cases read, so stub them at the module seam.
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

function makeTask(
  title: string,
  status: TaskDoc['status'],
  overrides: Partial<TaskDoc> = {},
): TaskDoc {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- minimal fixture; the card reads title/status/actors only
  return {
    _id: `task_${title}`,
    _creationTime: 0,
    organizationId: 'org_test',
    projectId: 'project_1',
    title,
    status,
    rank: `a${title.length}`,
    number: 1,
    createdBy: 'user_1',
    createdByType: 'user',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  } as unknown as TaskDoc;
}

function boardDirectory(
  names: Record<string, string>,
  projectId = 'project_1',
): BoardActorDirectory {
  return {
    projectId,
    currentUserId: 'user_1',
    resolveActor: (type, id) => ({
      type,
      id,
      name: names[id] ?? id,
      isAgent: type === 'agent',
    }),
  };
}

function Board({
  tasks,
  actors,
}: {
  tasks: TaskDoc[];
  actors?: BoardActorDirectory;
}) {
  return (
    <TaskBoardProvider tasks={tasks} dependencyEdges={[]} actors={actors}>
      <KanbanBoard tasks={tasks} canWorkTask={() => true} />
    </TaskBoardProvider>
  );
}

const reviewed = makeTask('Review me', 'in_review', {
  assigneeType: 'user',
  assigneeId: 'user_3',
  reviewerUserId: 'user_2',
});

describe('TaskCard on a project board', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('names its reviewer and assignee from the board’s directory and reads none of its own', () => {
    render(
      <Board
        tasks={[reviewed, makeTask('Plain', 'todo')]}
        actors={boardDirectory({ user_2: 'Bo Board', user_3: 'Cy Board' })}
      />,
    );

    expect(screen.getByLabelText('Waiting on Bo Board')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Cy Board' })).toBeInTheDocument();
    expect(useActorDirectory).not.toHaveBeenCalled();
    // No assignee list is mounted before someone opens one.
    expect(useAssignableActors).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('renames every card when the board’s directory changes', () => {
    const view = render(
      <Board
        tasks={[reviewed]}
        actors={boardDirectory({ user_2: 'Bo Board', user_3: 'Cy Board' })}
      />,
    );
    view.rerender(
      <Board
        tasks={[reviewed]}
        actors={boardDirectory({ user_2: 'Bo Renamed', user_3: 'Cy Renamed' })}
      />,
    );

    expect(screen.getByLabelText('Waiting on Bo Renamed')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Cy Renamed' })).toBeInTheDocument();
  });

  it('reads its own project’s directory when the board’s covers another project', () => {
    render(
      <Board
        tasks={[{ ...reviewed, projectId: 'project_2' }]}
        actors={boardDirectory({ user_2: 'Bo Board' })}
      />,
    );

    expect(screen.getByLabelText('Waiting on own user_2')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'own user_3' })).toBeInTheDocument();
    expect(useActorDirectory).toHaveBeenCalled();
    for (const call of vi.mocked(useActorDirectory).mock.calls) {
      expect(call).toEqual(['org_test', 'project_2']);
    }
  });

  it('reads its own directory on a board that spans projects', () => {
    render(<Board tasks={[reviewed]} />);

    expect(screen.getByLabelText('Waiting on own user_2')).toBeInTheDocument();
    expect(useActorDirectory).toHaveBeenCalledWith('org_test', 'project_1');
  });

  it('mounts one card’s assignee list on first use, and hands focus back on close', async () => {
    const { user } = render(
      <Board
        tasks={[reviewed, makeTask('Plain', 'todo')]}
        actors={boardDirectory({ user_2: 'Bo Board', user_3: 'Cy Board' })}
      />,
    );
    const [first, second] = screen.getAllByRole('button', { name: 'Assign' });
    if (first === undefined || second === undefined) {
      throw new Error('expected two assign triggers');
    }
    // Closed, a trigger reads as the popup button it is.
    expect(first).toHaveAttribute('aria-haspopup', 'dialog');
    expect(first).toHaveAttribute('aria-expanded', 'false');

    await user.click(first);

    expect(await screen.findByRole('listbox')).toBeInTheDocument();
    expect(useAssignableActors).toHaveBeenCalledWith('org_test', 'project_1');
    // The list is a modal layer: the board behind it is hidden from
    // assistive technology while it is open.
    const opened = screen.getAllByRole('button', {
      name: 'Assign',
      hidden: true,
    });
    expect(opened[0]).toHaveAttribute('aria-expanded', 'true');
    // The other card's list stays unmounted.
    expect(opened[1]).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getAllByRole('listbox')).toHaveLength(1);

    await user.keyboard('{Escape}');

    await vi.waitFor(() =>
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument(),
    );
    expect(screen.getAllByRole('button', { name: 'Assign' })[0]).toHaveFocus();
  });
});
