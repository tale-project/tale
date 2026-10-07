import '@testing-library/jest-dom/vitest';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { cleanup, render, screen } from '@/tests/utils/render';

import { KanbanBoard } from './kanban-board';
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
    assignableMembers: [
      {
        id: 'user-2',
        name: 'Alice Reviewer',
        email: 'alice@example.com',
        role: 'editor',
      },
    ],
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
  id: string,
  title: string,
  rank: string,
  parentTaskId?: string,
  overrides: Partial<TaskRow> = {},
): TaskRow {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- component fixture: unused backend fields are omitted
  return {
    _id: id,
    _creationTime: 0,
    organizationId: 'org-test',
    projectId: 'project-1',
    title,
    status: 'todo',
    rank,
    number: 1,
    projectKey: 'TAL',
    parentTaskId,
    createdBy: 'user-1',
    createdByType: 'user',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  } as TaskRow;
}

const first = makeTask(
  'task-1',
  'Check the quarterly invoice and its complete delivery details',
  'a0',
);
const second = makeTask('task-2', 'Send the receipt', 'a1');
const child = makeTask('child-1', 'Confirm the total', 'a0', first._id);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.removeItem('tale.platform.tasks.all.collapsedStatuses');
  localStorage.removeItem('user-locale');
  document.documentElement.classList.remove('dark');
});

describe.each([400, 1280])('TasksList at %ipx (real Chromium)', (width) => {
  it.each(['light', 'dark'])(
    'opens titles with visible keyboard focus and keeps pointer controls separate in %s mode',
    async (theme) => {
      await page.viewport(width, 900);
      document.documentElement.classList.toggle('dark', theme === 'dark');
      const onOpenTask = vi.fn();
      const { container } = render(
        <div className="bg-background text-foreground h-160 w-full">
          <TasksList
            tasks={[first, second, child]}
            canWorkTask={() => true}
            onOpenTask={onOpenTask}
          />
        </div>,
      );
      screen.getByRole('button', { name: 'To do 2' }).focus();
      await userEvent.keyboard('{Tab}');
      expect(screen.getByRole('button', { name: 'Subtasks' })).toHaveFocus();
      await userEvent.keyboard('{Tab}');
      expect(
        screen.getAllByRole('button', { name: 'Priority' })[0],
      ).toHaveFocus();
      await userEvent.keyboard('{Tab}');
      const title = screen.getByRole('button', { name: first.title });
      expect(title).toHaveFocus();
      expect(getComputedStyle(title, '::after').boxShadow).not.toBe('none');
      expect(title.getBoundingClientRect().width).toBeGreaterThan(0);
      await userEvent.keyboard('{Enter}');
      expect(onOpenTask).toHaveBeenCalledExactlyOnceWith(first);

      // The title's hit layer covers otherwise blank row padding in Chromium.
      const row = title.parentElement;
      expect(row).not.toBeNull();
      if (!row) throw new Error('The task title has no row');
      await page
        .elementLocator(row)
        .click({ position: { x: 4, y: row.clientHeight / 2 } });
      expect(onOpenTask).toHaveBeenCalledTimes(2);

      await page.getByRole('button', { name: 'Priority' }).first().click();
      await expect.element(page.getByRole('listbox')).toBeVisible();
      await page.getByRole('option', { name: /Urgent/ }).click();
      expect(mutations.update).toHaveBeenCalledWith({
        taskId: first._id,
        priority: 'p0',
      });
      await page.getByRole('button', { name: 'Assign' }).first().click();
      await expect.element(page.getByRole('listbox')).toBeVisible();
      await page.getByRole('option', { name: /Alice Reviewer/ }).click();
      expect(mutations.assign).toHaveBeenCalledWith({
        taskId: first._id,
        assigneeType: 'user',
        assigneeId: 'user-2',
      });
      await page.getByRole('button', { name: 'Subtasks' }).click();
      expect(onOpenTask).toHaveBeenCalledTimes(2);

      screen.getByRole('button', { name: child.title }).focus();
      await userEvent.keyboard(' ');
      expect(onOpenTask).toHaveBeenCalledTimes(3);
      expect(onOpenTask).toHaveBeenLastCalledWith(child);
      expect(mutations.move).not.toHaveBeenCalled();
      expect(container.scrollWidth).toBeLessThanOrEqual(width);
      const audit = await axe.run(container, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
      });
      expect(audit.violations).toEqual([]);
    },
  );
});

it('reorders with Space, ArrowDown, Space without opening the task', async () => {
  await page.viewport(1280, 900);
  const onOpenTask = vi.fn();
  render(
    <TasksList
      tasks={[first, second]}
      canWorkTask={() => true}
      onOpenTask={onOpenTask}
    />,
  );
  screen.getByRole('button', { name: first.title }).focus();
  await userEvent.keyboard(' ');
  await expect
    .poll(() => screen.getAllByRole('button', { name: first.title }).length)
    .toBe(2);
  await userEvent.keyboard('{ArrowDown}');
  await userEvent.keyboard(' ');
  await expect.poll(() => mutations.move.mock.calls.length).toBe(1);
  expect(mutations.move).toHaveBeenCalledWith({
    taskId: first._id,
    status: 'todo',
    beforeTaskId: second._id,
    afterTaskId: undefined,
  });
  expect(onOpenTask).not.toHaveBeenCalled();
});

it('opens read-only parent and nested tasks with Space without a drag affordance', async () => {
  await page.viewport(400, 900);
  const onOpenTask = vi.fn();
  render(<TasksList tasks={[first, child]} onOpenTask={onOpenTask} />);
  const parentTitle = screen.getByRole('button', { name: first.title });
  parentTitle.focus();
  await userEvent.keyboard(' ');
  expect(onOpenTask).toHaveBeenCalledExactlyOnceWith(first);
  expect(parentTitle).not.toHaveAttribute('aria-disabled');
  expect(parentTitle).not.toHaveAttribute('aria-roledescription');
  await page.getByRole('button', { name: 'Subtasks' }).click();
  screen.getByRole('button', { name: child.title }).focus();
  await userEvent.keyboard(' ');
  expect(onOpenTask).toHaveBeenCalledTimes(2);
  expect(onOpenTask).toHaveBeenLastCalledWith(child);
  expect(mutations.move).not.toHaveBeenCalled();
});

it.each([400, 1280])(
  'keeps Board title opening and sibling controls intact at %ipx',
  async (width) => {
    await page.viewport(width, 900);
    const onOpenTask = vi.fn();
    render(
      <KanbanBoard
        tasks={[first]}
        canWorkTask={() => true}
        onOpenTask={onOpenTask}
      />,
    );
    const title = screen.getByRole('button', { name: first.title });
    title.focus();
    await userEvent.keyboard('{Enter}');
    expect(onOpenTask).toHaveBeenCalledExactlyOnceWith(first);
    expect(getComputedStyle(title, '::after').boxShadow).not.toBe('none');
    await page.getByRole('button', { name: 'Priority' }).click();
    await expect.element(page.getByRole('listbox')).toBeVisible();
    expect(onOpenTask).toHaveBeenCalledTimes(1);
  },
);

describe.each(['Board', 'List'])('%s with thousands of tasks', (layout) => {
  it('retains an open picker draft, focus and scroll position at the actual windowed-to-native fallback', async () => {
    await page.viewport(1280, 900);
    const nativeCount = UNWINDOWED_LANE_MAX_CARDS - 1;
    const windowedCount = WINDOWED_LANE_MIN_CARDS + 1;
    const tasks = Array.from({ length: windowedCount }, (_, index) =>
      makeTask(
        `fallback-${index}`,
        `Fallback task ${index}`,
        `a${String(index).padStart(6, '0')}`,
      ),
    );
    const board = (count: number) => (
      <div className="h-150 w-full">
        {layout === 'Board' ? (
          <KanbanBoard tasks={tasks.slice(0, count)} canWorkTask={() => true} />
        ) : (
          <TasksList tasks={tasks.slice(0, count)} canWorkTask={() => true} />
        )}
      </div>
    );
    const view = render(board(nativeCount));
    const title = screen.getByRole('button', {
      name: `Fallback task ${nativeCount - 1}`,
    });
    const trigger = title
      .closest('[data-task-id]')
      ?.querySelector<HTMLButtonElement>('button[aria-label="Priority"]');
    if (trigger === undefined || trigger === null)
      throw new Error('The retained row has no priority picker');
    await page.elementLocator(trigger).click();
    await expect.element(page.getByRole('listbox')).toBeVisible();
    const picker = screen.getByRole('listbox');
    const input = screen.getByRole('combobox', { name: 'Priority' });
    await page.elementLocator(input).fill('Urgent');
    const scroller = title.closest('.overflow-y-auto, .overflow-auto');
    if (!(scroller instanceof HTMLElement))
      throw new Error('The fallback fixture has no task scrollport');
    const scrollTop = scroller.scrollTop;
    const titleTop = title.getBoundingClientRect().top;
    expect(scrollTop).toBeGreaterThan(0);

    view.rerender(board(windowedCount));
    expect(
      screen.queryAllByRole('button', { name: /^Fallback task \d+$/ }).length,
    ).toBeLessThan(windowedCount);
    expect(title.isConnected).toBe(true);
    expect(screen.getByRole('listbox')).toBe(picker);
    expect(input).toHaveFocus();
    expect(input).toHaveValue('Urgent');
    await expect.poll(() => scroller.scrollTop).toBeCloseTo(scrollTop, 0);
    expect(title.getBoundingClientRect().top).toBeCloseTo(titleTop, 0);

    view.rerender(board(nativeCount));
    expect(
      screen.queryAllByRole('button', { name: /^Fallback task \d+$/ }),
    ).toHaveLength(nativeCount);
    expect(title.isConnected).toBe(true);
    expect(screen.getByRole('listbox')).toBe(picker);
    expect(input).toHaveFocus();
    expect(input).toHaveValue('Urgent');
    await expect.poll(() => scroller.scrollTop).toBeCloseTo(scrollTop, 0);
    expect(title.getBoundingClientRect().top).toBeCloseTo(titleTop, 0);
  });

  it('keeps an open picker and its focused search when live rows cross the virtual threshold', async () => {
    await page.viewport(1280, 900);
    const tasks = Array.from(
      { length: WINDOWED_LANE_MIN_CARDS + 1 },
      (_, index) =>
        makeTask(
          `threshold-${index}`,
          `Threshold task ${index}`,
          `a${String(index).padStart(6, '0')}`,
        ),
    );
    const board = (count: number) => (
      <div className="h-150 w-full">
        {layout === 'Board' ? (
          <KanbanBoard tasks={tasks.slice(0, count)} canWorkTask={() => true} />
        ) : (
          <TasksList tasks={tasks.slice(0, count)} canWorkTask={() => true} />
        )}
      </div>
    );
    const view = render(board(WINDOWED_LANE_MIN_CARDS));
    const title = screen.getByRole('button', {
      name: `Threshold task ${WINDOWED_LANE_MIN_CARDS - 1}`,
    });
    const trigger = title
      .closest('[data-task-id]')
      ?.querySelector<HTMLButtonElement>('button[aria-label="Priority"]');
    if (trigger === undefined || trigger === null)
      throw new Error('The last row has no priority picker');
    await page.elementLocator(trigger).click();
    await expect.element(page.getByRole('listbox')).toBeVisible();
    const picker = screen.getByRole('listbox');
    const input = screen.getByRole('combobox', { name: 'Priority' });
    await page.elementLocator(input).fill('Urgent');
    const scroller = title.closest('.overflow-y-auto, .overflow-auto');
    if (!(scroller instanceof HTMLElement))
      throw new Error('The threshold fixture has no task scrollport');
    const scrollTop = scroller.scrollTop;
    const titleTop = title.getBoundingClientRect().top;
    expect(scrollTop).toBeGreaterThan(0);
    view.rerender(board(WINDOWED_LANE_MIN_CARDS + 1));
    expect(picker.isConnected).toBe(true);
    expect(input).toHaveFocus();
    expect(input).toHaveValue('Urgent');
    expect(screen.getByRole('listbox')).toBe(picker);
    await expect.poll(() => scroller.scrollTop).toBeCloseTo(scrollTop, 0);
    expect(title.getBoundingClientRect().top).toBeCloseTo(titleTop, 0);
    view.rerender(board(WINDOWED_LANE_MIN_CARDS));
    expect(screen.getByRole('listbox')).toBe(picker);
    expect(input).toHaveFocus();
    expect(input).toHaveValue('Urgent');
    await expect.poll(() => scroller.scrollTop).toBeCloseTo(scrollTop, 0);
    expect(title.getBoundingClientRect().top).toBeCloseTo(titleTop, 0);
  });

  it('bounds mounted controls, reaches the final task and preserves a focused row across scrolling', async () => {
    await page.viewport(1280, 900);
    const tasks = Array.from({ length: 2_000 }, (_, index) =>
      makeTask(
        `large-${index}`,
        `Large task ${index}`,
        `a${String(index).padStart(6, '0')}`,
      ),
    );
    const onOpenTask = vi.fn();
    const { container } = render(
      <div className="h-150 w-full">
        {layout === 'Board' ? (
          <KanbanBoard
            tasks={tasks}
            canWorkTask={() => true}
            onOpenTask={onOpenTask}
          />
        ) : (
          <TasksList
            tasks={tasks}
            canWorkTask={() => true}
            onOpenTask={onOpenTask}
          />
        )}
      </div>,
    );
    await expect
      .poll(() => screen.getAllByRole('button', { name: /^Large task/ }).length)
      .toBeLessThan(80);
    const firstTitle = screen.getByRole('button', {
      name: 'Large task 0',
    });
    const scroller =
      layout === 'Board'
        ? firstTitle
            .closest('section')
            ?.querySelector<HTMLDivElement>('.overflow-y-auto')
        : container.querySelector<HTMLDivElement>('.overflow-auto');
    if (!scroller)
      throw new Error('The large task collection has no scrollport');
    scroller.scrollTop = scroller.scrollHeight;
    const last = page.getByRole('button', {
      name: 'Large task 1999',
    });
    await expect.element(last).toBeVisible();
    screen.getByRole('button', { name: 'Large task 1999' }).focus();
    await userEvent.keyboard('{Enter}');
    expect(onOpenTask).toHaveBeenCalledExactlyOnceWith(tasks.at(-1));

    // Virtual rows leave the DOM as they scroll out. Focused controls stay,
    // including their neighbours so native Tab never skips a task.
    scroller.scrollTop = 0;
    await expect
      .element(page.getByRole('button', { name: 'Large task 0' }))
      .toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Large task 1999' }),
    ).toHaveFocus();
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
    expect(
      screen.getByRole('button', { name: 'Large task 1998' }),
    ).toHaveFocus();
    expect(
      screen.getAllByRole('button', { name: /^Large task/ }).length,
    ).toBeLessThan(80);
  });

  it('keeps keyboard rank placement correct at the end of a virtual lane', async () => {
    await page.viewport(1280, 900);
    const tasks = Array.from({ length: 150 }, (_, index) =>
      makeTask(
        `drag-large-${index}`,
        `Draggable large task ${index}`,
        `a${String(index).padStart(6, '0')}`,
      ),
    );
    const onOpenTask = vi.fn();
    const { container } = render(
      <div className="h-100 w-full">
        {layout === 'Board' ? (
          <KanbanBoard
            tasks={tasks}
            canWorkTask={() => true}
            onOpenTask={onOpenTask}
          />
        ) : (
          <TasksList
            tasks={tasks}
            canWorkTask={() => true}
            onOpenTask={onOpenTask}
          />
        )}
      </div>,
    );
    const firstTitle = screen.getByRole('button', {
      name: 'Draggable large task 0',
    });
    const scroller =
      layout === 'Board'
        ? firstTitle
            .closest('section')
            ?.querySelector<HTMLDivElement>('.overflow-y-auto')
        : container.querySelector<HTMLDivElement>('.overflow-auto');
    if (!scroller)
      throw new Error('The large task collection has no scrollport');
    scroller.scrollTop = scroller.scrollHeight;
    await expect
      .element(
        page.getByRole('button', {
          name: 'Draggable large task 149',
        }),
      )
      .toBeVisible();
    screen.getByRole('button', { name: 'Draggable large task 149' }).focus();
    await userEvent.keyboard(' ');
    await expect
      .poll(
        () =>
          screen.getAllByRole('button', {
            name: 'Draggable large task 149',
          }).length,
      )
      .toBe(2);
    await userEvent.keyboard('{ArrowUp}');
    await expect
      .poll(() => document.querySelector('[id^="DndLiveRegion"]')?.textContent)
      .toContain('position 149 of 150');
    await userEvent.keyboard(' ');
    await expect.poll(() => mutations.move.mock.calls.length).toBe(1);
    expect(mutations.move).toHaveBeenCalledWith({
      taskId: 'drag-large-149',
      status: 'todo',
      beforeTaskId: 'drag-large-147',
      afterTaskId: 'drag-large-148',
    });
    expect(onOpenTask).not.toHaveBeenCalled();
  });
});

it.each([400, 1280])(
  'keeps the sticky status header above scrolled row controls at %ipx',
  async (width) => {
    await page.viewport(width, 900);
    const tasks = Array.from({ length: 25 }, (_, index) =>
      makeTask(
        `scroll-${index}`,
        `Task ${index}`,
        `a${String(index).padStart(2, '0')}`,
      ),
    );
    const onOpenTask = vi.fn();
    render(
      <div className="h-60 w-full max-w-3xl">
        <TasksList
          tasks={tasks}
          canWorkTask={() => true}
          onOpenTask={onOpenTask}
        />
      </div>,
    );
    const heading = screen.getByRole('button', { name: 'To do 25' });
    const header = heading.parentElement;
    const scroller = header?.parentElement?.parentElement;
    const priority = screen.getAllByRole('button', { name: 'Priority' })[2];
    const assignee = screen.getAllByRole('button', { name: 'Assign' })[2];
    if (!header || !scroller || !priority || !assignee) {
      throw new Error('The scrollable task list is missing its controls');
    }
    // Place a row's inline controls directly underneath the sticky header.
    scroller.scrollTop +=
      priority.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top -
      8;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
    for (const control of [priority, assignee]) {
      const bounds = control.getBoundingClientRect();
      const hit = document.elementFromPoint(
        bounds.left + bounds.width / 2,
        bounds.top + bounds.height / 2,
      );
      expect(header.contains(hit)).toBe(true);
    }
    const controlBounds = priority.getBoundingClientRect();
    const headingBounds = heading.getBoundingClientRect();
    await page.elementLocator(heading).click({
      position: {
        x: controlBounds.left + controlBounds.width / 2 - headingBounds.left,
        y: controlBounds.top + controlBounds.height / 2 - headingBounds.top,
      },
    });
    expect(heading).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(onOpenTask).not.toHaveBeenCalled();
  },
);

// A keyboard drag speaks through dnd-kit's live region. Real task ids are
// UUIDs, and none may ever be read out (#3561): the fixtures below use them.
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const welcome = makeTask(
  '064d7f56-a6e7-4131-9078-b4d86022cdf0',
  'Welcome — meet your assistant',
  'a0',
  undefined,
  { projectKey: undefined, number: 1 },
);
const overview = makeTask(
  '5f877e73-3645-440a-93c4-1fe75819b223',
  'Draft a company overview',
  'a1',
  undefined,
  { projectKey: undefined, number: 2 },
);
const checklist = makeTask(
  '856b7e51-238c-473d-8985-d3d09a892793',
  'Draft the onboarding checklist',
  'a2',
  undefined,
  { projectKey: undefined, number: 3, status: 'in_progress' },
);

/** Every distinct text the live region shows, as Chromium exposes it. */
function recordAnnouncements() {
  const lines: string[] = [];
  const observer = new MutationObserver(() => {
    const text =
      document.querySelector('[id^="DndLiveRegion"]')?.textContent ?? '';
    if (text !== '' && lines.at(-1) !== text) lines.push(text);
  });
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
  });
  return {
    lines,
    stop: () => observer.disconnect(),
    /** Resolves once the region says `line` (its latest text). */
    said: (line: string) => expect.poll(() => lines.at(-1)).toBe(line),
  };
}

function instructionsOf(title: HTMLElement): string | null | undefined {
  const id = title.getAttribute('aria-describedby');
  return id === null ? null : document.getElementById(id)?.textContent;
}

describe('keyboard drag announcements (real Chromium)', () => {
  it.each([
    { layout: 'List', keys: [' ', '{ArrowDown}', '{ArrowDown}', '{Escape}'] },
    { layout: 'Board', keys: [' ', '{ArrowRight}', '{Escape}'] },
  ])(
    'never reads a task id aloud while dragging in the $layout',
    async ({ layout, keys }) => {
      await page.viewport(1280, 900);
      const tasks = [welcome, overview, checklist];
      render(
        layout === 'List' ? (
          <TasksList tasks={tasks} projectKey="GS" canWorkTask={() => true} />
        ) : (
          <KanbanBoard tasks={tasks} projectKey="GS" canWorkTask={() => true} />
        ),
      );
      const said = recordAnnouncements();
      screen.getByRole('button', { name: welcome.title }).focus();
      for (const key of keys) {
        const before = said.lines.length;
        await userEvent.keyboard(key);
        await expect.poll(() => said.lines.length).toBeGreaterThan(before);
      }
      said.stop();
      const spoken = said.lines.join('\n');
      expect(spoken).not.toMatch(UUID);
      for (const task of tasks) expect(spoken).not.toContain(task._id);
    },
  );

  it('names the List task, its status and position, and restores focus on Escape', async () => {
    await page.viewport(1280, 900);
    render(
      <TasksList
        tasks={[welcome, overview]}
        projectKey="GS"
        canWorkTask={() => true}
      />,
    );
    const said = recordAnnouncements();
    const title = screen.getByRole('button', { name: welcome.title });
    expect(instructionsOf(title)).toBe(
      'Enter opens the task. Space picks it up; then the arrow keys move it, Space drops it and Escape cancels.',
    );
    title.focus();
    await userEvent.keyboard(' ');
    await said.said(
      'Picked up GS-1, Welcome — meet your assistant. Status To do, position 1 of 2. Move it with the arrow keys, drop it with Space or cancel with Escape.',
    );
    await userEvent.keyboard('{ArrowDown}');
    await said.said('Status To do, position 2 of 2.');
    // Past the last row: the next status, empty.
    await userEvent.keyboard('{ArrowDown}');
    await said.said('Status In progress, position 1 of 1.');
    await userEvent.keyboard('{Escape}');
    await said.said(
      'Cancelled moving GS-1. It stays in status To do, position 1 of 2.',
    );
    await expect
      .poll(() => document.activeElement?.textContent)
      .toBe(welcome.title);
    expect(mutations.move).not.toHaveBeenCalled();
    said.stop();
    for (const line of said.lines) {
      expect(line).not.toMatch(UUID);
    }
  });

  it('speaks German on the Board, drops into an empty status and keeps focus on the moved title', async () => {
    await page.viewport(1280, 900);
    localStorage.setItem('user-locale', 'de-DE');
    render(
      <KanbanBoard
        tasks={[welcome, overview, checklist]}
        projectKey="GS"
        canWorkTask={() => true}
      />,
    );
    const title = await screen.findByRole('button', { name: welcome.title });
    await expect
      .poll(() => instructionsOf(title))
      .toBe(
        'Enter öffnet die Aufgabe. Die Leertaste nimmt sie auf; danach verschieben die Pfeiltasten sie, die Leertaste legt sie ab und Escape bricht ab.',
      );
    const said = recordAnnouncements();
    title.focus();
    await userEvent.keyboard(' ');
    await said.said(
      'Aufgenommen: GS-1, Welcome — meet your assistant. Status Zu erledigen, Position 1 von 2. Verschieben mit den Pfeiltasten, ablegen mit der Leertaste, abbrechen mit Escape.',
    );
    // The first press already crosses into the next status: the tilted
    // drag card is not what dnd-kit measures.
    await userEvent.keyboard('{ArrowRight}');
    await said.said('Status In Bearbeitung, Position 1 von 2.');
    await userEvent.keyboard('{ArrowRight}');
    await said.said('Status In Prüfung, Position 1 von 1.');
    await userEvent.keyboard(' ');
    await said.said('Abgelegt: GS-1 im Status In Prüfung, Position 1 von 1.');
    await expect.poll(() => mutations.move.mock.calls.length).toBe(1);
    expect(mutations.move).toHaveBeenCalledWith({
      taskId: welcome._id,
      status: 'in_review',
      beforeTaskId: undefined,
      afterTaskId: undefined,
    });
    await expect
      .poll(() => document.activeElement?.textContent)
      .toBe(welcome.title);
    said.stop();
    for (const line of said.lines) {
      expect(line).not.toMatch(UUID);
    }
  });

  it('names a task without a key by its title and never falls back to its id once it is gone (French)', async () => {
    await page.viewport(400, 900);
    localStorage.setItem('user-locale', 'fr-FR');
    const view = render(
      <TasksList tasks={[welcome, overview]} canWorkTask={() => true} />,
    );
    const title = await screen.findByRole('button', { name: overview.title });
    await expect
      .poll(() => instructionsOf(title))
      .toBe(
        'Entrée ouvre la tâche. Espace la saisit\u00a0; ensuite, les touches fléchées la déplacent, Espace la dépose et Échap annule.',
      );
    const said = recordAnnouncements();
    title.focus();
    await userEvent.keyboard(' ');
    await said.said(
      'Tu as saisi Draft a company overview. Statut À faire, position 2 sur 2. Déplace-la avec les touches fléchées, dépose-la avec Espace ou annule avec Échap.',
    );
    // Deleted or archived elsewhere while it is held.
    view.rerender(<TasksList tasks={[welcome]} canWorkTask={() => true} />);
    await userEvent.keyboard('{Escape}');
    await said.said(
      "Cette tâche n'est plus affichée ici\u00a0: elle n'a pas été déplacée.",
    );
    expect(mutations.move).not.toHaveBeenCalled();
    said.stop();
    for (const line of said.lines) {
      expect(line).not.toMatch(UUID);
    }
  });
});
