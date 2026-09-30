// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { BOARD_TASK_STATUSES, type TaskDoc } from '../lib/display';
import { TaskDependencies } from './task-dependencies';

/**
 * A dependency is the blocked task's record, so the server holds it to that
 * task's work gate. On someone else's task a member may still record that it
 * blocks one of their own tasks — the Blocks group offers exactly those —
 * while its Blocked by group, which changes the task on screen, stays shut.
 */

const state = vi.hoisted(() => ({
  canEdit: false,
  tasks: [] as TaskDoc[],
  add: vi.fn(),
  boardRead: vi.fn(),
}));

const task = (id: string, overrides: Partial<TaskDoc> = {}): TaskDoc => ({
  _id: id,
  _creationTime: 0,
  organizationId: 'org-1',
  projectId: 'project-1',
  title: `Task ${id}`,
  status: 'todo',
  rank: 'a0',
  number: 1,
  createdBy: 'u-editor',
  createdByType: 'user',
  createdAt: 0,
  updatedAt: 0,
  ...overrides,
});

vi.mock('../hooks/queries', () => ({
  useTaskDependencies: () => ({ blockedBy: [], blocks: [] }),
  useTasksByProject: (...args: unknown[]) => {
    state.boardRead(...args);
    return {
      tasks: state.tasks,
      canEdit: state.canEdit,
      canCreate: true,
      truncated: false,
      isLoading: false,
    };
  },
}));
vi.mock('../hooks/mutations', () => ({
  useAddTaskDependency: () => ({ mutateAsync: state.add }),
  useRemoveTaskDependency: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('@/app/hooks/use-current-member-context', () => ({
  useCurrentMemberContext: () => ({ data: { userId: 'u-member' } }),
}));

const others = task('others');

beforeEach(() => {
  state.canEdit = false;
  state.add.mockReset().mockResolvedValue(null);
  state.boardRead.mockReset();
  state.tasks = [
    others,
    task('mine', { createdBy: 'u-member', number: 2 }),
    task('theirs', { number: 3 }),
  ];
});

describe("TaskDependencies on someone else's task", () => {
  it('lets a member mark one of their own tasks as blocked by it', async () => {
    const user = userEvent.setup();
    render(<TaskDependencies task={others} canEdit={false} />);

    // "Blocked by" would change the task on screen: nothing to add there.
    expect(screen.getAllByRole('button', { name: 'Add' })).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(
      await screen.findByRole('option', { name: /Task mine/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Task theirs/ })).toBeNull();

    await user.click(screen.getByRole('option', { name: /Task mine/ }));
    expect(state.add).toHaveBeenCalledWith({
      blockerTaskId: 'others',
      blockedTaskId: 'mine',
    });
  });

  it('offers nothing to a member with no task of their own to mark', () => {
    state.tasks = [others, task('theirs', { number: 3 })];
    render(<TaskDependencies task={others} canEdit={false} />);

    expect(screen.queryByRole('button', { name: 'Add' })).toBeNull();
  });
});

// A task opened from its board lists the project's tasks as candidates: read
// under the unfiltered board's own key, those are the rows the board already
// holds, not a second read of the whole project (#3939).
describe('TaskDependencies candidates', () => {
  it("reads the project's tasks as the unfiltered board does", () => {
    render(<TaskDependencies task={others} canEdit />);

    expect(state.boardRead).toHaveBeenCalled();
    for (const call of state.boardRead.mock.calls) {
      expect(call).toEqual(['project-1', { statuses: BOARD_TASK_STATUSES }]);
    }
  });
});
