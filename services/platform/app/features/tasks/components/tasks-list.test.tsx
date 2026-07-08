import { describe, expect, it, vi } from 'vitest';

import type { Doc } from '@/convex/_generated/dataModel';
import { render, screen } from '@/tests/utils/render';

import { TasksList } from './tasks-list';

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

// Backlog tasks are PROPOSED work triaged on the Backlog tab — the list must
// render neither a Backlog section nor any backlog row, even if a backlog row
// somehow reaches it.
describe('TasksList backlog exclusion', () => {
  it('renders the triaged sections but no backlog section and no backlog row', () => {
    render(
      <TasksList
        tasks={[
          makeTask('Triaged task', 'todo', 'a0'),
          makeTask('Proposed task', 'backlog', 'a1'),
        ]}
      />,
    );

    // Every triaged section header is present…
    for (const section of [
      'To do',
      'In progress',
      'In review',
      'Done',
      'Cancelled',
    ]) {
      expect(screen.getByText(section)).toBeInTheDocument();
    }
    // …the Backlog section is not, and neither is the backlog task's row.
    expect(screen.queryByText('Backlog')).not.toBeInTheDocument();
    expect(screen.getByText('Triaged task')).toBeInTheDocument();
    expect(screen.queryByText('Proposed task')).not.toBeInTheDocument();
  });
});
