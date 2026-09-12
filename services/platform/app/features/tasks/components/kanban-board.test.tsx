import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import type { TaskDoc } from '../lib/display';
import { KanbanBoard } from './kanban-board';

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

// The contract/choreography hooks reach Convex (provider-backed); the board
// render tests care about lanes and rows, so stub them at the module seam —
// the pure helpers (plannedTransitionKind, resolveTaskOwnership, …) stay real.
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
  status: TaskRow['status'],
  rank: string,
  overrides: Partial<TaskRow> = {},
): TaskRow {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- minimal fixture; the board renders title/status/rank only
  return {
    _id: `task_${title}`,
    _creationTime: 0,
    organizationId: 'org_test',
    projectId: 'project_1',
    title,
    status,
    rank,
    number: 1,
    createdBy: 'user_1',
    createdByType: 'user',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  } as unknown as TaskRow;
}

describe('KanbanBoard backlog lane', () => {
  it('renders every status lane including backlog and its cards', () => {
    render(
      <KanbanBoard
        tasks={[
          makeTask('Triaged task', 'todo', 'a0'),
          makeTask('Proposed task', 'backlog', 'a1'),
        ]}
      />,
    );

    for (const lane of [
      'Backlog',
      'To do',
      'In progress',
      'In review',
      'Done',
      'Cancelled',
    ]) {
      expect(screen.getByText(lane)).toBeInTheDocument();
    }
    expect(screen.getByText('Triaged task')).toBeInTheDocument();
    expect(screen.getByText('Proposed task')).toBeInTheDocument();
  });
});

// An archived card used to be signalled by `opacity-70` alone, which makes
// colour the sole carrier of the meaning (WCAG 2.1 AA 1.4.1).
describe('KanbanBoard archived cards', () => {
  // Both fixtures carry a `projectKey`. Without one `formatTaskIdentifier`
  // returns null, the identifier row is skipped entirely, and the negative
  // case would pass even with the badge hard-coded to always render.
  it('gives an archived card the Archived badge', () => {
    render(
      <KanbanBoard
        projectKey="TAL"
        tasks={[makeTask('Retired task', 'todo', 'a0', { archivedAt: 123 })]}
      />,
    );
    expect(screen.getByText('TAL-1')).toBeInTheDocument();
    expect(screen.getByText('Archived')).toBeInTheDocument();
  });

  it('leaves a live card without one', () => {
    render(
      <KanbanBoard
        projectKey="TAL"
        tasks={[makeTask('Live task', 'todo', 'a0')]}
      />,
    );
    expect(screen.getByText('TAL-1')).toBeInTheDocument();
    expect(screen.queryByText('Archived')).not.toBeInTheDocument();
  });
});
