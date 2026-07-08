import { describe, expect, it, vi } from 'vitest';

import type { Doc } from '@/convex/_generated/dataModel';
import { render, screen } from '@/tests/utils/render';

import { KanbanBoard } from './kanban-board';

type TaskRow = Doc<'tasks'>;

vi.mock('../hooks/mutations', () => ({
  useMoveTask: () => ({ mutate: vi.fn(), isPending: false }),
  useAssignTask: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateTask: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('../hooks/use-actor-directory', () => ({
  useActorDirectory: () => ({
    members: [],
    agents: [],
    currentUserId: null,
    resolveActor: () => null,
  }),
}));

function makeTask(
  title: string,
  status: TaskRow['status'],
  rank: string,
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
  } as unknown as TaskRow;
}

// Backlog tasks are PROPOSED work triaged on the Backlog tab — the board must
// render neither a backlog lane nor any backlog card, even if a backlog row
// somehow reaches it.
describe('KanbanBoard backlog exclusion', () => {
  it('renders the triaged lanes but no backlog lane and no backlog card', () => {
    render(
      <KanbanBoard
        tasks={[
          makeTask('Triaged task', 'todo', 'a0'),
          makeTask('Proposed task', 'backlog', 'a1'),
        ]}
      />,
    );

    // Every triaged lane is present…
    for (const lane of [
      'To do',
      'In progress',
      'In review',
      'Done',
      'Cancelled',
    ]) {
      expect(screen.getByText(lane)).toBeInTheDocument();
    }
    // …the backlog lane is not, and neither is the backlog task's card.
    expect(screen.queryByText('Backlog')).not.toBeInTheDocument();
    expect(screen.getByText('Triaged task')).toBeInTheDocument();
    expect(screen.queryByText('Proposed task')).not.toBeInTheDocument();
  });
});
