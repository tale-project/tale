import { describe, expect, it, vi } from 'vitest';

import type { Doc } from '@/convex/_generated/dataModel';
import { render, screen } from '@/tests/utils/render';

import { TasksList } from './tasks-list';

type TaskRow = Doc<'tasks'>;

vi.mock('../hooks/mutations', () => ({
  useMoveTask: () => ({ mutate: vi.fn(), isPending: false }),
  useAssignTask: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateTask: () => ({ mutate: vi.fn(), isPending: false }),
  useCancelTaskAgentRun: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('@/app/hooks/use-convex-client', () => ({
  useConvexClient: () => ({ query: vi.fn(async () => null) }),
}));
vi.mock('@/app/hooks/use-convex-action', () => ({
  useConvexAction: () => ({ mutateAsync: vi.fn() }),
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
// the pure helpers stay real via importOriginal.
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
): TaskRow {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- minimal fixture; the list renders title/status/rank only
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
  } as unknown as TaskRow;
}

describe('TasksList backlog section', () => {
  it('renders every status section including backlog and its rows', () => {
    render(
      <TasksList
        tasks={[
          makeTask('Triaged task', 'todo', 'a0'),
          makeTask('Proposed task', 'backlog', 'a1'),
        ]}
      />,
    );

    for (const section of [
      'Backlog',
      'To do',
      'In progress',
      'In review',
      'Done',
      'Cancelled',
    ]) {
      expect(screen.getByText(section)).toBeInTheDocument();
    }
    expect(screen.getByText('Triaged task')).toBeInTheDocument();
    expect(screen.getByText('Proposed task')).toBeInTheDocument();
  });
});
