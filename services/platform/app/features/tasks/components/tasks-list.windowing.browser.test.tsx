import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { cleanup, render, screen } from '@/tests/utils/render';

import type { TaskRow } from './task-card';
import { TasksList } from './tasks-list';
import {
  UNWINDOWED_LANE_MAX_CARDS,
  WINDOWED_LANE_MIN_CARDS,
} from './windowed-task-rows';

import '@/app/globals.css';

const mutations = vi.hoisted(() => ({
  move: vi.fn(),
  update: vi.fn(),
  assign: vi.fn(),
}));
vi.mock('../hooks/mutations', () => ({
  useMoveTask: () => ({ mutate: mutations.move, isPending: false }),
  useAssignTask: () => ({ mutate: mutations.assign, isPending: false }),
  useUpdateTask: () => ({ mutate: mutations.update, isPending: false }),
  useCancelTaskAgentRun: () => ({ mutateAsync: vi.fn() }),
  useCreateTask: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('@tanstack/react-router', async (original) => ({
  ...(await original<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
}));
vi.mock('@/app/hooks/use-backend-client', () => ({
  useBackendClient: () => ({ query: vi.fn(async () => null) }),
}));
vi.mock('@/app/hooks/use-backend-action', () => ({
  useBackendAction: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('../hooks/use-actor-directory', () => ({
  useProvidedActorDirectory: () => undefined,
  ActorDirectoryProvider: ({ children }: { children?: unknown }) => children,
  useActorDirectory: () => ({
    members: [],
    agents: [],
    currentUserId: null,
    resolveActor: () => null,
  }),
  useAssignableActors: () => ({
    subjectEntries: [],
    assignableMembers: [],
    assignableAgents: [],
    agents: [],
    currentUserId: null,
    resolveActor: () => null,
  }),
}));
vi.mock('../hooks/use-task-status-choreography', () => ({
  plannedTransitionKind: () => 'move',
  useTaskStatusChoreography: () => async () => 'move' as const,
}));
vi.mock('../hooks/use-task-subject-contract', () => ({
  resolveTaskOwnership: () => ({ kind: 'human' }),
  taskSubjectEntries: () => [],
  resolveTaskSubjectContract: () => null,
  useTaskSubjectContract: () => null,
  useTaskContractAutomations: () => [],
}));

function makeTask(
  index: number,
  status: TaskRow['status'] = 'todo',
  title = `List task ${index}`,
): TaskRow {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- component fixture: unused backend fields are omitted
  return {
    _id: `${status}-${index}`,
    _creationTime: 0,
    organizationId: 'org-test',
    projectId: 'project-1',
    title,
    status,
    rank: `a${String(index).padStart(4, '0')}`,
    number: index + 1,
    projectKey: 'TAL',
    createdBy: 'user-1',
    createdByType: 'user',
    createdAt: 0,
    updatedAt: 0,
  } as TaskRow;
}

const LONG = 300;
const todo = Array.from({ length: LONG }, (_, index) => makeTask(index));
const done = Array.from({ length: LONG }, (_, index) =>
  makeTask(index, 'done', `Done task ${index}`),
);

function titles(pattern: RegExp): string[] {
  return screen
    .queryAllByRole('button', { name: pattern })
    .map((button) => button.textContent ?? '');
}

function scroller(): HTMLElement {
  const element = screen
    .getByRole('button', { name: 'List task 0' })
    .closest('.overflow-auto');
  if (!(element instanceof HTMLElement)) {
    throw new Error('The list has no scrollport');
  }
  return element;
}

const nextFrame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.removeItem('tale.platform.tasks.all.collapsedStatuses');
});

describe('a long list section (real Chromium)', () => {
  it('mounts only the rows near the view and still counts every task', async () => {
    await page.viewport(1280, 900);
    render(
      <div className="h-[600px] w-full">
        <TasksList tasks={todo} canWorkTask={() => true} />
      </div>,
    );
    expect(titles(/^List task \d+$/).length).toBeGreaterThan(5);
    expect(titles(/^List task \d+$/).length).toBeLessThan(45);
    expect(
      screen.getByRole('button', { name: `To do ${LONG}` }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: `List task ${LONG - 1}` }),
    ).not.toBeInTheDocument();
  });

  it('places a long section below another one where the scroll reaches it', async () => {
    await page.viewport(1280, 900);
    render(
      <div className="h-[600px] w-full">
        <TasksList tasks={[...todo, ...done]} canWorkTask={() => true} />
      </div>,
    );
    const list = scroller();
    list.scrollTop = list.scrollHeight;
    const last = page.getByRole('button', {
      name: `Done task ${LONG - 1}`,
      exact: true,
    });
    await expect.element(last).toBeInTheDocument();
    await nextFrame();
    // Mounted is not enough: the row must sit inside the visible list,
    // where the Done section's own offset in the shared scrollport puts it.
    const view = list.getBoundingClientRect();
    const row = last.element().getBoundingClientRect();
    expect(row.top).toBeGreaterThanOrEqual(view.top);
    expect(row.bottom).toBeLessThanOrEqual(view.bottom + 1);
    // The To do section, scrolled out of view, keeps only its last few rows.
    expect(titles(/^List task \d+$/).length).toBeLessThan(15);
  });

  it('updates group origins after status moves preserve the total scroll height', async () => {
    await page.viewport(1280, 900);
    const canWorkTask = () => true;
    const { rerender } = render(
      <div className="h-[600px] w-full">
        <TasksList tasks={[...todo, ...done]} canWorkTask={canWorkTask} />
      </div>,
    );
    const list = scroller();
    list.scrollTop = list.scrollHeight;
    const finalRowIsInView = () => {
      const row = screen.queryByRole('button', {
        name: `Done task ${LONG - 1}`,
      });
      if (row === null) return false;
      const viewport = list.getBoundingClientRect();
      const bounds = row.getBoundingClientRect();
      return bounds.top >= viewport.top && bounds.bottom <= viewport.bottom + 1;
    };
    await expect.poll(finalRowIsInView).toBe(true);
    await nextFrame();
    await nextFrame();
    const previousHeight = list.scrollHeight;
    const previousTop = list.scrollTop;
    // Moving enough equally sized rows to outrun overscan changes each
    // section's origin while leaving their aggregate height unchanged.
    const movedCount = 60;
    const updatedTodo = todo.map((task, index): TaskRow =>
      index < movedCount ? { ...task, status: 'done' } : task,
    );
    rerender(
      <div className="h-[600px] w-full">
        <TasksList
          tasks={[...updatedTodo, ...done]}
          canWorkTask={canWorkTask}
        />
      </div>,
    );
    await expect
      .element(page.getByRole('button', { name: `To do ${LONG - movedCount}` }))
      .toBeInTheDocument();
    await expect
      .element(page.getByRole('button', { name: `Done ${LONG + movedCount}` }))
      .toBeInTheDocument();
    await expect.poll(() => list.scrollHeight).toBe(previousHeight);
    await expect.poll(finalRowIsInView).toBe(true);
    expect(list.scrollTop).toBe(previousTop);
    expect(list.querySelectorAll('[data-index]').length).toBeLessThan(90);
  });

  it('walks every row in order with Tab, past the first window', async () => {
    await page.viewport(1280, 900);
    render(
      <div className="h-[600px] w-full">
        {/* Read-only rows: the title is each row's one tab stop. */}
        <TasksList tasks={todo} />
      </div>,
    );
    screen.getByRole('button', { name: 'List task 0' }).focus();
    // About two dozen rows are mounted at first: 35 steps leave that window.
    expect(titles(/^List task \d+$/)).not.toContain('List task 35');
    const steps = 35;
    for (let step = 0; step < steps; step += 1) {
      await userEvent.keyboard('{Tab}');
      await nextFrame();
    }
    expect(document.activeElement?.textContent).toBe(`List task ${steps}`);
  }, 30_000);

  it('keeps the focused row mounted and focused while the list scrolls away', async () => {
    await page.viewport(1280, 900);
    render(
      <div className="h-[600px] w-full">
        <TasksList tasks={todo} canWorkTask={() => true} />
      </div>,
    );
    const first = screen.getByRole('button', { name: 'List task 0' });
    first.focus();
    const list = scroller();
    list.scrollTop = list.scrollHeight;
    await expect
      .element(
        page.getByRole('button', {
          name: `List task ${LONG - 1}`,
          exact: true,
        }),
      )
      .toBeInTheDocument();
    expect(first).toBeInTheDocument();
    expect(document.activeElement).toBe(first);
  });

  it('moves a row down a long section from the keyboard and writes its new neighbours', async () => {
    await page.viewport(1280, 900);
    render(
      <div className="h-[600px] w-full">
        <TasksList tasks={todo} canWorkTask={() => true} />
      </div>,
    );
    screen.getByRole('button', { name: 'List task 0' }).focus();
    await userEvent.keyboard(' ');
    await nextFrame();
    await userEvent.keyboard('{ArrowDown}');
    await nextFrame();
    await userEvent.keyboard('{ArrowDown}');
    await nextFrame();
    await userEvent.keyboard(' ');
    await expect.poll(() => mutations.move.mock.calls.length).toBe(1);
    expect(mutations.move).toHaveBeenCalledWith({
      taskId: 'todo-0',
      status: 'todo',
      beforeTaskId: 'todo-2',
      afterTaskId: 'todo-3',
    });
  });

  it(`mounts every row of a section of ${WINDOWED_LANE_MIN_CARDS}`, async () => {
    await page.viewport(1280, 900);
    render(
      <div className="h-[600px] w-full">
        <TasksList
          tasks={todo.slice(0, WINDOWED_LANE_MIN_CARDS)}
          canWorkTask={() => true}
        />
      </div>,
    );
    expect(titles(/^List task \d+$/)).toHaveLength(WINDOWED_LANE_MIN_CARDS);
  });

  it('retains focused rows and windowing through the lane threshold buffer', async () => {
    await page.viewport(1280, 900);
    const { rerender } = render(
      <div className="h-[600px] w-full">
        <TasksList tasks={todo.slice(0, WINDOWED_LANE_MIN_CARDS + 1)} />
      </div>,
    );
    const first = screen.getByRole('button', { name: 'List task 0' });
    first.focus();
    expect(titles(/^List task \d+$/).length).toBeLessThan(
      WINDOWED_LANE_MIN_CARDS,
    );

    rerender(
      <div className="h-[600px] w-full">
        <TasksList tasks={todo.slice(0, WINDOWED_LANE_MIN_CARDS)} />
      </div>,
    );
    expect(first).toHaveFocus();
    expect(screen.getByRole('button', { name: 'List task 0' })).toBe(first);
    expect(titles(/^List task \d+$/).length).toBeLessThan(
      WINDOWED_LANE_MIN_CARDS,
    );

    rerender(
      <div className="h-[600px] w-full">
        <TasksList tasks={todo.slice(0, UNWINDOWED_LANE_MAX_CARDS - 1)} />
      </div>,
    );
    expect(titles(/^List task \d+$/)).toHaveLength(
      UNWINDOWED_LANE_MAX_CARDS - 1,
    );
    expect(screen.getByRole('button', { name: 'List task 0' })).toBe(first);
    expect(first).toHaveFocus();
  });
});
