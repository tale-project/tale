import '@testing-library/jest-dom/vitest';
import { useCallback, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { cleanup, render, screen } from '@/tests/utils/render';

import type { TaskStatus } from '../lib/display';
import { KanbanBoard } from './kanban-board';
import type { TaskRow } from './task-card';
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

function makeTask(index: number): TaskRow {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- component fixture: unused backend fields are omitted
  return {
    _id: `task-${index}`,
    _creationTime: 0,
    organizationId: 'org-test',
    projectId: 'project-1',
    title: `Lane task ${index}`,
    status: 'todo',
    rank: `a${String(index).padStart(4, '0')}`,
    number: index + 1,
    projectKey: 'TAL',
    createdBy: 'user-1',
    createdByType: 'user',
    createdAt: 0,
    updatedAt: 0,
  } as TaskRow;
}

const LONG_LANE = 300;
const longLane = Array.from({ length: LONG_LANE }, (_, index) =>
  makeTask(index),
);

function laneTitles(): string[] {
  return screen
    .queryAllByRole('button', { name: /^Lane task \d+$/ })
    .map((button) => button.textContent ?? '');
}

function laneScroller(): HTMLElement {
  const scroller = screen
    .getByRole('button', { name: 'Lane task 0' })
    .closest('.overflow-y-auto');
  if (!(scroller instanceof HTMLElement)) {
    throw new Error('The lane has no scrollport');
  }
  return scroller;
}

const nextFrame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('a long board lane (real Chromium)', () => {
  it('mounts only the cards near its scrollport and still counts every task', async () => {
    await page.viewport(1280, 900);
    render(
      <div className="h-[600px] w-full">
        <KanbanBoard tasks={longLane} canWorkTask={() => true} />
      </div>,
    );
    expect(
      screen.getByRole('button', { name: 'Lane task 0' }),
    ).toBeInTheDocument();
    expect(laneTitles().length).toBeGreaterThan(3);
    expect(laneTitles().length).toBeLessThan(30);
    expect(
      screen.queryByRole('button', { name: `Lane task ${LONG_LANE - 1}` }),
    ).not.toBeInTheDocument();
    // The header still counts the whole lane.
    const header = laneScroller()
      .closest('section')
      ?.querySelector('span.tabular-nums');
    expect(header?.textContent).toBe(String(LONG_LANE));
  });

  it('mounts the cards a scroll reaches and lets go of the ones it left', async () => {
    await page.viewport(1280, 900);
    render(
      <div className="h-[600px] w-full">
        <KanbanBoard tasks={longLane} canWorkTask={() => true} />
      </div>,
    );
    const scroller = laneScroller();
    scroller.scrollTop = scroller.scrollHeight;
    await expect
      .element(
        page.getByRole('button', {
          name: `Lane task ${LONG_LANE - 1}`,
          exact: true,
        }),
      )
      .toBeInTheDocument();
    await expect.poll(() => laneTitles().includes('Lane task 0')).toBe(false);
    expect(laneTitles().length).toBeLessThan(30);
  });

  it('walks every card in order with Tab, past the first window', async () => {
    await page.viewport(1280, 900);
    render(
      <div className="h-[600px] w-full">
        {/* Read-only cards: the title is each card's one tab stop. */}
        <KanbanBoard tasks={longLane} />
      </div>,
    );
    screen.getByRole('button', { name: 'Lane task 0' }).focus();
    // About a dozen cards are mounted at first: 25 steps leave that window.
    expect(laneTitles()).not.toContain('Lane task 25');
    const steps = 25;
    for (let step = 0; step < steps; step += 1) {
      await userEvent.keyboard('{Tab}');
      await nextFrame();
    }
    expect(document.activeElement?.textContent).toBe(`Lane task ${steps}`);
  }, 30_000);

  it('keeps the focused card mounted and focused while the lane scrolls away', async () => {
    await page.viewport(1280, 900);
    render(
      <div className="h-[600px] w-full">
        <KanbanBoard tasks={longLane} canWorkTask={() => true} />
      </div>,
    );
    const first = screen.getByRole('button', { name: 'Lane task 0' });
    first.focus();
    const scroller = laneScroller();
    scroller.scrollTop = scroller.scrollHeight;
    await expect
      .element(
        page.getByRole('button', {
          name: `Lane task ${LONG_LANE - 1}`,
          exact: true,
        }),
      )
      .toBeInTheDocument();
    expect(first).toBeInTheDocument();
    expect(document.activeElement).toBe(first);
  });

  it('moves a card down a long lane from the keyboard and writes its new neighbours', async () => {
    await page.viewport(1280, 900);
    render(
      <div className="h-[600px] w-full">
        <KanbanBoard tasks={longLane} canWorkTask={() => true} />
      </div>,
    );
    screen.getByRole('button', { name: 'Lane task 0' }).focus();
    await userEvent.keyboard(' ');
    await nextFrame();
    await userEvent.keyboard('{ArrowDown}');
    await nextFrame();
    await userEvent.keyboard('{ArrowDown}');
    await nextFrame();
    await userEvent.keyboard(' ');
    await expect.poll(() => mutations.move.mock.calls.length).toBe(1);
    expect(mutations.move).toHaveBeenCalledWith({
      taskId: 'task-0',
      status: 'todo',
      beforeTaskId: 'task-2',
      afterTaskId: 'task-3',
    });
  });

  it(`mounts every card of a lane of ${WINDOWED_LANE_MIN_CARDS}`, async () => {
    await page.viewport(1280, 900);
    render(
      <div className="h-[600px] w-full">
        <KanbanBoard
          tasks={longLane.slice(0, WINDOWED_LANE_MIN_CARDS)}
          canWorkTask={() => true}
        />
      </div>,
    );
    expect(laneTitles()).toHaveLength(WINDOWED_LANE_MIN_CARDS);
  });

  it('keeps the focus in a card its lane scrolled away from while Tab moves through its controls', async () => {
    await page.viewport(1280, 900);
    render(
      <div className="h-[600px] w-full">
        <KanbanBoard tasks={longLane} canWorkTask={() => true} />
      </div>,
    );
    const title = screen.getByRole('button', { name: 'Lane task 0' });
    title.focus();
    const scroller = laneScroller();
    scroller.scrollTop = scroller.scrollHeight;
    await expect
      .element(
        page.getByRole('button', {
          name: `Lane task ${LONG_LANE - 1}`,
          exact: true,
        }),
      )
      .toBeInTheDocument();
    // Card 0 is out of the window, mounted only for its focus: Tab moves
    // that focus to its own priority picker, and the card must stay.
    await userEvent.keyboard('{Tab}');
    await nextFrame();
    const card = title.closest('[data-index]');
    expect(card?.isConnected).toBe(true);
    expect(document.activeElement).not.toBe(document.body);
    expect(card?.contains(document.activeElement)).toBe(true);
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Priority');
  });

  it(`keeps its cards mounted when a windowed lane falls back to ${WINDOWED_LANE_MIN_CARDS}, and mounts them all below ${UNWINDOWED_LANE_MAX_CARDS}`, async () => {
    await page.viewport(1280, 900);
    const view = render(
      <div className="h-[600px] w-full">
        <KanbanBoard
          tasks={longLane.slice(0, WINDOWED_LANE_MIN_CARDS + 1)}
          canWorkTask={() => true}
        />
      </div>,
    );
    const first = screen.getByRole('button', { name: 'Lane task 0' });
    expect(laneTitles().length).toBeLessThan(WINDOWED_LANE_MIN_CARDS);
    const trigger = first
      .closest('[data-index]')
      ?.querySelector<HTMLButtonElement>('button[aria-label="Priority"]');
    if (trigger === null || trigger === undefined)
      throw new Error('The retained card has no priority picker');
    await page.elementLocator(trigger).click();
    await expect.element(page.getByRole('listbox')).toBeVisible();
    const picker = screen.getByRole('listbox');
    const input = screen.getByRole('combobox', { name: 'Priority' });
    await page.elementLocator(input).fill('Urgent');

    view.rerender(
      <div className="h-[600px] w-full">
        <KanbanBoard
          tasks={longLane.slice(0, WINDOWED_LANE_MIN_CARDS)}
          canWorkTask={() => true}
        />
      </div>,
    );
    // Still windowed: the same card nodes, nothing remounted.
    expect(first.isConnected).toBe(true);
    expect(laneTitles().length).toBeLessThan(WINDOWED_LANE_MIN_CARDS);
    expect(screen.getByRole('listbox')).toBe(picker);
    expect(input).toHaveFocus();
    expect(input).toHaveValue('Urgent');

    view.rerender(
      <div className="h-[600px] w-full">
        <KanbanBoard
          tasks={longLane.slice(0, UNWINDOWED_LANE_MAX_CARDS - 1)}
          canWorkTask={() => true}
        />
      </div>,
    );
    expect(laneTitles()).toHaveLength(UNWINDOWED_LANE_MAX_CARDS - 1);
    // The lower threshold switches back to native flow without replacing
    // the retained card or its open, portaled picker.
    expect(first.isConnected).toBe(true);
    expect(screen.getByRole('listbox')).toBe(picker);
    expect(input).toHaveFocus();
    expect(input).toHaveValue('Urgent');
  });
});

/** The board as the workspace drives it: Done and Cancelled may fold. */
function FoldingBoard({ tasks }: { tasks: TaskRow[] }) {
  const [folded, setFolded] = useState<ReadonlySet<TaskStatus>>(new Set());
  const onLaneCollapsedChange = useCallback(
    (status: TaskStatus, collapse: boolean) =>
      setFolded((previous) => {
        const next = new Set(previous);
        if (collapse) next.add(status);
        else next.delete(status);
        return next;
      }),
    [],
  );
  return (
    <div className="h-[600px] w-full">
      <KanbanBoard
        tasks={tasks}
        canWorkTask={() => true}
        collapsedLanes={folded}
        onLaneCollapsedChange={onLaneCollapsedChange}
      />
    </div>
  );
}

describe('a folded lane (real Chromium)', () => {
  const tasks = [
    { ...makeTask(0), status: 'in_review' as const },
    { ...makeTask(1), status: 'done' as const },
    { ...makeTask(2), status: 'done' as const },
  ];

  it('folds Done to a rail and back, focus following the toggle', async () => {
    await page.viewport(1600, 900);
    render(<FoldingBoard tasks={tasks} />);
    expect(
      screen.queryByRole('button', { name: 'Collapse Backlog' }),
    ).not.toBeInTheDocument();

    screen.getByRole('button', { name: 'Collapse Done' }).focus();
    await userEvent.keyboard('{Enter}');
    const rail = await screen.findByRole('button', { name: 'Expand Done' });
    expect(rail).toHaveFocus();
    expect(rail).toHaveAttribute('aria-expanded', 'false');
    expect(rail).toHaveTextContent('2');
    expect(rail.getBoundingClientRect().width).toBeLessThanOrEqual(44);
    expect(
      screen.queryByRole('button', { name: 'Lane task 1' }),
    ).not.toBeInTheDocument();

    await userEvent.keyboard('{Enter}');
    const fold = await screen.findByRole('button', { name: 'Collapse Done' });
    expect(fold).toHaveFocus();
    expect(
      screen.getByRole('button', { name: 'Lane task 1' }),
    ).toBeInTheDocument();
  });

  it('takes a card dropped on the rail from the keyboard', async () => {
    await page.viewport(1600, 900);
    render(<FoldingBoard tasks={tasks} />);
    screen.getByRole('button', { name: 'Collapse Done' }).click();
    await screen.findByRole('button', { name: 'Expand Done' });

    screen.getByRole('button', { name: 'Lane task 0' }).focus();
    await userEvent.keyboard(' ');
    await nextFrame();
    await userEvent.keyboard('{ArrowRight}');
    await nextFrame();
    await userEvent.keyboard(' ');
    await expect.poll(() => mutations.move.mock.calls.length).toBe(1);
    expect(mutations.move).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-0', status: 'done' }),
    );
    // The card left with the drag; focus stays on the lane that took it.
    await expect
      .poll(() => document.activeElement)
      .toBe(screen.getByRole('button', { name: 'Expand Done' }));
  });

  it('reads the rail its count', async () => {
    await page.viewport(1600, 900);
    render(<FoldingBoard tasks={tasks} />);
    screen.getByRole('button', { name: 'Collapse Done' }).click();
    expect(
      await screen.findByRole('button', { name: 'Expand Done' }),
    ).toHaveAccessibleDescription('2 tasks');
  });

  // Done folded between In review and a Cancelled lane holding a card: the
  // card is nearer by corners than the narrow rail, on any board height.
  const withCancelled = [
    ...tasks,
    { ...makeTask(3), status: 'cancelled' as const },
  ];

  it.each([600, 1000])(
    'steps onto the rail, not past it, on a %ipx-tall board',
    async (height) => {
      await page.viewport(1600, height);
      render(<FoldingBoard tasks={withCancelled} />);
      screen.getByRole('button', { name: 'Collapse Done' }).click();
      await screen.findByRole('button', { name: 'Expand Done' });

      screen.getByRole('button', { name: 'Lane task 0' }).focus();
      await userEvent.keyboard(' ');
      await nextFrame();
      await userEvent.keyboard('{ArrowRight}');
      await nextFrame();
      await userEvent.keyboard(' ');
      await expect.poll(() => mutations.move.mock.calls.length).toBe(1);
      expect(mutations.move).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 'task-0', status: 'done' }),
      );
    },
  );

  it('walks across two rails, one lane per key', async () => {
    await page.viewport(1600, 900);
    render(<FoldingBoard tasks={withCancelled} />);
    screen.getByRole('button', { name: 'Collapse Done' }).click();
    screen.getByRole('button', { name: 'Collapse Cancelled' }).click();
    await screen.findByRole('button', { name: 'Expand Cancelled' });

    screen.getByRole('button', { name: 'Lane task 0' }).focus();
    await userEvent.keyboard(' ');
    await nextFrame();
    await userEvent.keyboard('{ArrowRight}');
    await nextFrame();
    await userEvent.keyboard('{ArrowRight}');
    await nextFrame();
    await userEvent.keyboard(' ');
    await expect.poll(() => mutations.move.mock.calls.length).toBe(1);
    expect(mutations.move).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-0', status: 'cancelled' }),
    );
  });

  it('steps back onto the rail from the lane after it', async () => {
    await page.viewport(1600, 900);
    render(<FoldingBoard tasks={withCancelled} />);
    screen.getByRole('button', { name: 'Collapse Done' }).click();
    await screen.findByRole('button', { name: 'Expand Done' });

    screen.getByRole('button', { name: 'Lane task 3' }).focus();
    await userEvent.keyboard(' ');
    await nextFrame();
    await userEvent.keyboard('{ArrowLeft}');
    await nextFrame();
    await userEvent.keyboard(' ');
    await expect.poll(() => mutations.move.mock.calls.length).toBe(1);
    expect(mutations.move).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-3', status: 'done' }),
    );
  });
});
