import '@testing-library/jest-dom/vitest';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { cleanup, render, screen } from '@/tests/utils/render';

import { KanbanBoard } from './kanban-board';
import type { TaskRow } from './task-card';
import { TasksList } from './tasks-list';

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
  useTaskSubjectContract: () => null,
  useTaskContractAutomations: () => [],
}));

function makeTask(
  id: string,
  title: string,
  rank: string,
  parentTaskId?: string,
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
            canEdit
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

      await page
        .getByRole('button', { name: 'Priority', exact: true })
        .first()
        .click();
      await expect.element(page.getByRole('listbox')).toBeVisible();
      await page.getByRole('option', { name: /Urgent/ }).click();
      expect(mutations.update).toHaveBeenCalledWith({
        taskId: first._id,
        priority: 'p0',
      });
      await page
        .getByRole('button', { name: 'Assign', exact: true })
        .first()
        .click();
      await expect.element(page.getByRole('listbox')).toBeVisible();
      await page.getByRole('option', { name: /Alice Reviewer/ }).click();
      expect(mutations.assign).toHaveBeenCalledWith({
        taskId: first._id,
        assigneeType: 'user',
        assigneeId: 'user-2',
      });
      await page.getByRole('button', { name: 'Subtasks', exact: true }).click();
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
  render(<TasksList tasks={[first, second]} canEdit onOpenTask={onOpenTask} />);
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
  await page.getByRole('button', { name: 'Subtasks', exact: true }).click();
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
    render(<KanbanBoard tasks={[first]} canEdit onOpenTask={onOpenTask} />);
    const title = screen.getByRole('button', { name: first.title });
    title.focus();
    await userEvent.keyboard('{Enter}');
    expect(onOpenTask).toHaveBeenCalledExactlyOnceWith(first);
    expect(getComputedStyle(title, '::after').boxShadow).not.toBe('none');
    await page.getByRole('button', { name: 'Priority', exact: true }).click();
    await expect.element(page.getByRole('listbox')).toBeVisible();
    expect(onOpenTask).toHaveBeenCalledTimes(1);
  },
);

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
        <TasksList tasks={tasks} canEdit onOpenTask={onOpenTask} />
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
