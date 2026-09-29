// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import type { TaskDoc } from '../lib/display';
import type { TaskView } from '../lib/view';
import { TasksWorkspace } from './tasks-workspace';

/**
 * Opening a task from the board, and closing it, used to re-render every
 * card twice: once for the workspace's own open state and once for the route
 * handing new props when `?task=` changed. On a 2,000-task board that was
 * the whole cost of an open (#3939). The real board and list render here;
 * each card's title button counts the renders.
 */

const { renders, tasks } = vi.hoisted(() => {
  const task = (id: string, overrides: Partial<TaskDoc> = {}): TaskDoc => ({
    _id: id,
    _creationTime: 0,
    organizationId: 'org-1',
    projectId: 'project-1',
    title: `Task ${id}`,
    status: 'todo',
    rank: `a${id}`,
    number: 1,
    createdBy: 'u-member',
    createdByType: 'user',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  });
  return {
    renders: new Map<string, number>(),
    tasks: [
      task('a'),
      task('b', { status: 'in_progress' }),
      task('c', { status: 'in_review', reviewerUserId: 'u-member' }),
      task('d', { status: 'backlog' }),
    ],
  };
});

vi.mock('../hooks/queries', () => {
  const answered = {
    read: { kind: 'ready', updating: false },
    retry: () => {},
  };
  const board = {
    tasks,
    truncated: false,
    canEdit: true,
    canCreate: true,
    isLoading: false,
    ...answered,
  };
  // A pending review keeps the board context's review refs non-empty: a new
  // array of them per render would re-render every card through the context.
  const ops = {
    runningTaskIds: ['b'],
    askingTaskIds: [],
    pendingReviews: [{ taskId: 'c', requestedFor: 'u-member' }],
    ...answered,
  };
  const dependencies = { edges: [], isLoading: false, ...answered };
  return {
    useTasksByProject: () => board,
    useTasksAcrossProjects: () => board,
    useProjectDependencies: () => dependencies,
    useTaskOpsIndicators: () => ops,
    useTaskOpsIndicatorsAcrossProjects: () => ops,
  };
});
vi.mock('@/app/features/projects/hooks/queries', () => ({
  useProject: () => ({ project: { key: 'CON', canEdit: true } }),
}));
vi.mock('@/app/hooks/use-backend-query', () => ({
  useBackendQuery: () => ({ data: undefined, isLoading: false }),
}));
vi.mock('@/app/hooks/use-current-member-context', () => {
  const member = { data: { userId: 'u-member' } };
  return { useCurrentMemberContext: () => member };
});
vi.mock('../hooks/use-actor-directory', () => {
  const directory = {
    members: [],
    agents: [],
    currentUserId: 'u-member',
    resolveActor: () => ({ name: 'Member' }),
  };
  return { useActorDirectory: () => directory };
});
vi.mock('../hooks/mutations', () => ({
  useMoveTask: () => ({ mutate: vi.fn(), isPending: false }),
  useAssignTask: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateTask: () => ({ mutate: vi.fn(), isPending: false }),
  useCancelTaskAgentRun: () => ({ mutateAsync: vi.fn() }),
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
vi.mock('./assignee-picker', () => ({ AssigneePicker: () => null }));
vi.mock('./task-title-button', () => ({
  TaskTitleButton: ({
    title,
    onOpen,
  }: {
    title: string;
    onOpen: () => void;
  }) => {
    renders.set(title, (renders.get(title) ?? 0) + 1);
    return (
      <button type="button" onClick={onOpen}>
        {title}
      </button>
    );
  },
}));
// The dialog has suites of its own; here it only says whether it is open.
vi.mock('./task-modal', () => ({
  TaskModal: ({
    taskId,
    open,
    onOpenChange,
  }: {
    taskId?: string | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }) =>
    taskId === undefined ? null : (
      <section aria-label={open ? `Open ${taskId}` : 'No open task'}>
        {open && (
          <button type="button" onClick={() => onOpenChange(false)}>
            Close task
          </button>
        )}
      </section>
    ),
}));

/** The route's side: `?task=` round-trips, and every render hands the
 *  workspace new callbacks, as TasksBoardPage does. */
function Route({ view }: { view: TaskView }) {
  const [taskParam, setTaskParam] = useState<string>();
  return (
    <TasksWorkspace
      organizationId="org-1"
      projectId="project-1"
      view={view}
      onViewChange={() => {}}
      openTaskParam={taskParam}
      onOpenTaskParamChange={(taskId) => setTaskParam(taskId ?? undefined)}
    />
  );
}

beforeEach(() => {
  renders.clear();
});

describe.each(['board', 'list'] as const)(
  'TasksWorkspace — a task dialog over the %s',
  (view) => {
    it('opens and closes a task without re-rendering the cards', async () => {
      const user = userEvent.setup();
      render(<Route view={view} />);
      const before = new Map(renders);
      expect(before.get('Task a')).toBeGreaterThan(0);

      await user.click(screen.getByRole('button', { name: 'Task b' }));
      expect(
        await screen.findByRole('region', { name: 'Open b' }),
      ).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Close task' }));
      expect(
        await screen.findByRole('region', { name: 'No open task' }),
      ).toBeInTheDocument();

      // The opened card may answer its own press; no other card renders.
      for (const title of ['Task a', 'Task c', 'Task d']) {
        expect(renders.get(title), title).toBe(before.get(title));
      }
    });
  },
);
