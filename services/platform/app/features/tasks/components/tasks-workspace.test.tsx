// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import type { TaskDoc } from '../lib/display';
import type { TaskRow } from './task-card';
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
  const board = () => ({
    tasks: state.tasks,
    truncated: false,
    canEdit: state.canEdit,
    canCreate: state.canCreate,
    isLoading: false,
  });
  const ops = { runningTaskIds: [], askingTaskIds: [], pendingReviews: [] };
  return {
    useTasksByProject: board,
    useTasksAcrossProjects: board,
    useProjectDependencies: () => ({ edges: [], isLoading: false }),
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
  }: {
    tasks: TaskRow[];
    canWorkTask: (task: TaskRow) => boolean;
  }) => (
    <ul>
      {tasks.map((row) => (
        <li key={row._id}>
          {row.title}: {canWorkTask(row) ? 'workable' : 'read-only'}
        </li>
      ))}
    </ul>
  ),
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
