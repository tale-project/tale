import type {
  Active,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
  Over,
} from '@dnd-kit/core';
import { AppShell } from '@tale/ui/app-shell';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';
import { AppError } from '@/lib/shared/errors/app-error';

import type { TaskRow } from '../components/task-card';
import type { TaskStatus } from '../lib/display';
import { useTaskBoardDnd, type TaskColumns } from './use-task-board-dnd';

type Outcome = 'move' | 'handled' | 'blocked';

// The drop's write runs through the real `useMoveTask`, `useBackendMutation`
// and React Query; only its door, the toast sink and the hooks that reach
// other reads are stubbed.
const mocks = vi.hoisted(() => ({
  move: vi.fn(),
  toast: vi.fn(),
  nextTask: vi.fn(),
  choreograph: vi.fn(async (): Promise<Outcome> => 'move'),
}));
vi.mock('@/app/lib/backend/adapters', () => ({
  WRITE_ADAPTERS: { 'tasks/mutations:moveTask': { run: mocks.move } },
  activeOrganizationId: () => 'org-test',
  runAdapted: (run: () => Promise<unknown>) => run(),
}));
vi.mock('@tale/ui/use-toast', () => ({ toast: mocks.toast }));
vi.mock('./use-next-task-toast', () => ({
  useNextTaskToast: () => mocks.nextTask,
}));
vi.mock('./use-task-status-choreography', () => ({
  useTaskStatusChoreography: () => mocks.choreograph,
}));

const FIRST = 'task-first';
const SECOND = 'task-second';
const PARENT = 'task-parent';
const REVIEWED = 'task-reviewed';
const SHIPPED = 'task-shipped';

function makeTask(
  id: string,
  status: TaskStatus,
  rank: string,
  number: number,
): TaskRow {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- fixture: the drag reads id, title, status, rank and number only
  return {
    _id: id,
    _creationTime: 0,
    organizationId: 'org-test',
    projectId: 'project-1',
    title: id,
    status,
    rank,
    number,
    createdBy: 'user-1',
    createdByType: 'user',
    createdAt: 0,
    updatedAt: 0,
  } as TaskRow;
}

const TASKS = [
  makeTask(FIRST, 'todo', 'a0', 1),
  makeTask(SECOND, 'todo', 'a1', 2),
  makeTask(PARENT, 'in_progress', 'a2', 3),
  makeTask(REVIEWED, 'in_progress', 'a3', 4),
  makeTask(SHIPPED, 'done', 'a4', 5),
];

/** `TASKS` as the server answers once other writes left `rows` so. */
function servedAfter(...rows: TaskRow[]): TaskRow[] {
  return TASKS.map((task) => rows.find((row) => row._id === task._id) ?? task);
}

function lanes(cols: Partial<TaskColumns>): TaskColumns {
  return {
    backlog: [],
    todo: [],
    in_progress: [],
    in_review: [],
    done: [],
    cancelled: [],
    ...cols,
  };
}

/** Where the server keeps every task of `TASKS`. */
const AS_SERVED = lanes({
  todo: [FIRST, SECOND],
  in_progress: [PARENT, REVIEWED],
  done: [SHIPPED],
});

const OPEN_SUBTASKS = new AppError({
  code: 'TASK_HAS_OPEN_SUBTASKS',
  message: 'Open subtasks remain',
});

const active = (id: string): Active => ({
  id,
  data: { current: undefined },
  rect: { current: { initial: null, translated: null } },
});
const over = (id: string): Over => ({
  id,
  rect: { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 },
  disabled: false,
  data: { current: undefined },
});
const dragEvent = (
  activeId: string,
  overId: string,
): DragOverEvent & DragEndEvent => ({
  activatorEvent: new KeyboardEvent('keydown', { code: 'Space' }),
  active: active(activeId),
  over: over(overId),
  collisions: null,
  delta: { x: 0, y: 0 },
});

function renderBoard(tasks: TaskRow[]) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  const view = renderHook(
    ({ rows }: { rows: TaskRow[] }) => useTaskBoardDnd(rows),
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <AppShell i18n={i18n} locale={{ mode: 'client' }}>
          <QueryClientProvider client={client}>{children}</QueryClientProvider>
        </AppShell>
      ),
      initialProps: { rows: tasks },
    },
  );
  const dnd = () => view.result.current;
  return {
    view,
    columns: () => dnd().columns,
    /** Pick `id` up and drop it over `overId` (a status or a task), the
     * way dnd-kit drives the handlers. */
    drag(id: string, overId: string) {
      const start: DragStartEvent = {
        activatorEvent: new KeyboardEvent('keydown', { code: 'Space' }),
        active: active(id),
      };
      act(() => dnd().onDragStart(start));
      act(() => dnd().onDragOver(dragEvent(id, overId)));
      act(() => dnd().onDragEnd(dragEvent(id, overId)));
    },
  };
}

afterEach(() => {
  mocks.move.mockReset();
  mocks.toast.mockReset();
  mocks.nextTask.mockReset();
  mocks.choreograph.mockClear();
});

describe('useTaskBoardDnd refused moves', () => {
  it('puts a parent the server refuses to close back in its column and says why', async () => {
    mocks.move.mockRejectedValueOnce(OPEN_SUBTASKS);
    const board = renderBoard(TASKS);
    board.drag(PARENT, 'done');
    // The drop shows at once, before the server answers.
    expect(board.columns().done).toEqual([SHIPPED, PARENT]);

    await waitFor(() => expect(board.columns()).toEqual(AS_SERVED));
    expect(mocks.move).toHaveBeenCalledExactlyOnceWith(
      {
        taskId: PARENT,
        status: 'done',
        beforeTaskId: SHIPPED,
        afterTaskId: undefined,
      },
      { organizationId: 'org-test' },
    );
    expect(mocks.toast).toHaveBeenCalledExactlyOnceWith({
      title: "Couldn't finish that action",
      description: 'Finish all subtasks before closing this task.',
      variant: 'destructive',
    });
  });

  it('puts a reorder an archived project refuses back in place and says why', async () => {
    mocks.move.mockRejectedValueOnce(
      new AppError({
        code: 'PROJECT_ARCHIVED',
        message: 'Project is archived',
      }),
    );
    const board = renderBoard(TASKS);
    board.drag(FIRST, SECOND);
    expect(board.columns().todo).toEqual([SECOND, FIRST]);

    await waitFor(() => expect(board.columns()).toEqual(AS_SERVED));
    // A reorder within a status is a plain write, never a choreography.
    expect(mocks.choreograph).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledExactlyOnceWith({
      title: "Couldn't finish that action",
      description: 'This project is archived. Restore it to change its tasks.',
      variant: 'destructive',
    });
  });

  it('puts the card back when the write gets no answer', async () => {
    mocks.move.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const board = renderBoard(TASKS);
    board.drag(REVIEWED, 'in_review');
    expect(board.columns().in_review).toEqual([REVIEWED]);

    await waitFor(() => expect(board.columns()).toEqual(AS_SERVED));
    expect(mocks.toast).toHaveBeenCalledExactlyOnceWith({
      title: "Couldn't finish that action",
      description: 'Try again.',
      variant: 'destructive',
    });
  });

  it('keeps a move the server accepts where it was dropped', async () => {
    mocks.move.mockResolvedValueOnce({});
    const board = renderBoard(TASKS);
    board.drag(REVIEWED, 'done');

    await waitFor(() => expect(mocks.nextTask).toHaveBeenCalledTimes(1));
    expect(board.columns()).toEqual(
      lanes({
        todo: [FIRST, SECOND],
        in_progress: [PARENT],
        done: [SHIPPED, REVIEWED],
      }),
    );
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it('puts the first card back when its refusal lands after a second drop', async () => {
    // A callback handed to `mutate` itself would be dropped here: React
    // Query keeps only the latest call's.
    const refused = Promise.withResolvers<unknown>();
    mocks.move.mockReturnValueOnce(refused.promise).mockResolvedValueOnce({});
    const board = renderBoard(TASKS);
    board.drag(PARENT, 'done');
    await waitFor(() => expect(mocks.move).toHaveBeenCalledTimes(1));
    board.drag(FIRST, SECOND);
    await waitFor(() => expect(mocks.move).toHaveBeenCalledTimes(2));

    await act(async () => refused.reject(OPEN_SUBTASKS));
    await waitFor(() => expect(board.columns().done).toEqual([SHIPPED]));
    expect(board.columns().in_progress).toEqual([PARENT, REVIEWED]);
    expect(mocks.toast).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        description: 'Finish all subtasks before closing this task.',
      }),
    );
  });

  it('keeps a list that changed while the refused write was out', async () => {
    const refused = Promise.withResolvers<unknown>();
    mocks.move.mockReturnValueOnce(refused.promise).mockResolvedValueOnce({});
    const board = renderBoard(TASKS);
    board.drag(PARENT, 'done');
    await waitFor(() => expect(mocks.move).toHaveBeenCalledTimes(1));
    // Before the refusal lands, a later drop is saved and another session
    // sends REVIEWED to In review; the list comes back with both.
    board.drag(FIRST, SECOND);
    await waitFor(() => expect(mocks.nextTask).toHaveBeenCalledTimes(1));
    board.view.rerender({
      rows: servedAfter(
        makeTask(FIRST, 'todo', 'a1x', 1),
        makeTask(REVIEWED, 'in_review', 'a3', 4),
      ),
    });

    await act(async () => refused.reject(OPEN_SUBTASKS));
    expect(mocks.toast).toHaveBeenCalledTimes(1);
    expect(board.columns()).toEqual(
      lanes({
        todo: [SECOND, FIRST],
        in_progress: [PARENT],
        in_review: [REVIEWED],
        done: [SHIPPED],
      }),
    );
  });

  it('keeps a list that changed while a choreography it blocked was running', async () => {
    const blocked = Promise.withResolvers<Outcome>();
    mocks.choreograph.mockReturnValueOnce(blocked.promise);
    const board = renderBoard(TASKS);
    board.drag(PARENT, 'done');
    await waitFor(() => expect(mocks.choreograph).toHaveBeenCalledTimes(1));
    board.view.rerender({
      rows: servedAfter(makeTask(REVIEWED, 'in_review', 'a3', 4)),
    });

    await act(async () => blocked.resolve('blocked'));
    expect(board.columns()).toEqual(
      lanes({
        todo: [FIRST, SECOND],
        in_progress: [PARENT],
        in_review: [REVIEWED],
        done: [SHIPPED],
      }),
    );
    expect(mocks.move).not.toHaveBeenCalled();
  });
});
