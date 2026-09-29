import type {
  Active,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
  Over,
} from '@dnd-kit/core';
import { AppShell } from '@tale/ui/app-shell';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';

import type { TaskRow } from '../components/task-card';
import type { TaskStatus } from '../lib/display';
import { useTaskBoardDnd } from './use-task-board-dnd';

const { move, choreograph } = vi.hoisted(() => ({
  move: vi.fn(),
  choreograph: vi.fn(
    async (): Promise<'move' | 'handled' | 'blocked'> => 'move',
  ),
}));
vi.mock('./mutations', () => ({
  useMoveTask: () => ({ mutate: move, isPending: false }),
}));
vi.mock('./use-task-status-choreography', () => ({
  useTaskStatusChoreography: () => choreograph,
}));

// Real ids are UUIDs; an announcement must never read one out (#3561).
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const WELCOME = '064d7f56-a6e7-4131-9078-b4d86022cdf0';
const OVERVIEW = '5f877e73-3645-440a-93c4-1fe75819b223';
const CHECKLIST = '856b7e51-238c-473d-8985-d3d09a892793';

function makeTask(
  id: string,
  title: string,
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
    title,
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
  makeTask(WELCOME, 'Welcome — meet your assistant', 'todo', 'a0', 1),
  makeTask(OVERVIEW, 'Draft a company overview', 'todo', 'a1', 2),
  makeTask(CHECKLIST, 'Draft the onboarding checklist', 'in_progress', 'a2', 3),
];

function wrapper({ children }: { children: ReactNode }) {
  return (
    <AppShell i18n={i18n} locale={{ mode: 'client' }}>
      {children}
    </AppShell>
  );
}

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
const moveEvent = (
  activeId: string,
  overId: string | null,
): DragOverEvent & DragEndEvent => ({
  activatorEvent: new KeyboardEvent('keydown', { code: 'Space' }),
  active: active(activeId),
  over: overId === null ? null : over(overId),
  collisions: null,
  delta: { x: 0, y: 0 },
});

const INSTRUCTIONS = {
  'en-US':
    'Enter opens the task. Space picks it up; then the arrow keys move it, Space drops it and Escape cancels.',
  'de-DE':
    'Enter öffnet die Aufgabe. Die Leertaste nimmt sie auf; danach verschieben die Pfeiltasten sie, die Leertaste legt sie ab und Escape bricht ab.',
  'fr-FR':
    'Entrée ouvre la tâche. Espace la saisit\u00a0; ensuite, les touches fléchées la déplacent, Espace la dépose et Échap annule.',
} as const;

/**
 * Render the shared hook and drive it the way dnd-kit does: the
 * `DndContext` handler first, then the announcer. Every spoken line is kept
 * so a test can assert that none of them leaks an id.
 */
async function renderDrag(
  tasks: TaskRow[],
  {
    locale = 'en-US',
    projectKey = 'GS',
  }: {
    locale?: keyof typeof INSTRUCTIONS;
    projectKey?: string | null;
  } = {},
) {
  localStorage.setItem('user-locale', locale);
  const view = renderHook(
    ({ rows }: { rows: TaskRow[] }) => useTaskBoardDnd(rows, { projectKey }),
    { wrapper, initialProps: { rows: tasks } },
  );
  await waitFor(() =>
    expect(
      view.result.current.accessibility.screenReaderInstructions.draggable,
    ).toBe(INSTRUCTIONS[locale]),
  );
  const spoken: string[] = [];
  const say = (line: string | undefined) => {
    if (line !== undefined) spoken.push(line);
    return line;
  };
  const dnd = () => view.result.current;
  return {
    view,
    spoken,
    pickUp(id: string) {
      const event: DragStartEvent = {
        activatorEvent: new KeyboardEvent('keydown', { code: 'Space' }),
        active: active(id),
      };
      act(() => dnd().onDragStart(event));
      return say(
        dnd().accessibility.announcements.onDragStart({ active: active(id) }),
      );
    },
    moveOver(id: string, overId: string | null) {
      act(() => dnd().onDragOver(moveEvent(id, overId)));
      return say(
        dnd().accessibility.announcements.onDragOver(moveEvent(id, overId)),
      );
    },
    drop(id: string, overId: string | null) {
      act(() => dnd().onDragEnd(moveEvent(id, overId)));
      return say(
        dnd().accessibility.announcements.onDragEnd(moveEvent(id, overId)),
      );
    },
    cancel(id: string) {
      act(() => dnd().onDragCancel());
      return say(
        dnd().accessibility.announcements.onDragCancel(moveEvent(id, null)),
      );
    },
  };
}

afterEach(() => {
  localStorage.removeItem('user-locale');
  move.mockReset();
  choreograph.mockClear();
});

describe('useTaskBoardDnd announcements', () => {
  it('names the task, its status and its position through a reorder, never its id', async () => {
    const drag = await renderDrag(TASKS);
    expect(drag.pickUp(WELCOME)).toBe(
      'Picked up GS-1, Welcome — meet your assistant. Status To do, position 1 of 2. Move it with the arrow keys, drop it with Space or cancel with Escape.',
    );
    // dnd-kit reports the task over itself right after the pickup: silent,
    // so the pickup line is not overwritten.
    expect(drag.moveOver(WELCOME, WELCOME)).toBeUndefined();
    expect(drag.moveOver(WELCOME, OVERVIEW)).toBe(
      'Status To do, position 2 of 2.',
    );
    expect(drag.drop(WELCOME, OVERVIEW)).toBe(
      'Dropped GS-1 in status To do, position 2 of 2.',
    );
    expect(move).toHaveBeenCalledExactlyOnceWith({
      taskId: WELCOME,
      status: 'todo',
      beforeTaskId: OVERVIEW,
      afterTaskId: undefined,
    });
    expect(drag.spoken.join('\n')).not.toMatch(UUID);
  });

  it('announces an empty status as a target and a cancel that restores the start', async () => {
    const drag = await renderDrag(TASKS);
    drag.pickUp(WELCOME);
    expect(drag.moveOver(WELCOME, 'in_review')).toBe(
      'Status In review, position 1 of 1.',
    );
    // After the lane change dnd-kit finds the task over itself again.
    expect(drag.moveOver(WELCOME, WELCOME)).toBeUndefined();
    expect(drag.cancel(WELCOME)).toBe(
      'Cancelled moving GS-1. It stays in status To do, position 1 of 2.',
    );
    expect(move).not.toHaveBeenCalled();
    expect(drag.spoken.join('\n')).not.toMatch(UUID);
  });

  it('appends a drop on a populated status and describes it as a drop, not a status change', async () => {
    const drag = await renderDrag(TASKS);
    drag.pickUp(WELCOME);
    expect(drag.moveOver(WELCOME, 'in_progress')).toBe(
      'Status In progress, position 2 of 2.',
    );
    expect(drag.drop(WELCOME, 'in_progress')).toBe(
      'Dropped GS-1 in status In progress, position 2 of 2.',
    );
    await waitFor(() =>
      expect(move).toHaveBeenCalledExactlyOnceWith({
        taskId: WELCOME,
        status: 'in_progress',
        beforeTaskId: CHECKLIST,
        afterTaskId: undefined,
      }),
    );
  });

  it('says a drop back where the task started changes nothing', async () => {
    const drag = await renderDrag(TASKS);
    drag.pickUp(WELCOME);
    drag.moveOver(WELCOME, OVERVIEW);
    expect(drag.moveOver(WELCOME, WELCOME)).toBe(
      'Status To do, position 1 of 2.',
    );
    expect(drag.drop(WELCOME, WELCOME)).toBe(
      'Dropped GS-1 where it started, in status To do, position 1 of 2.',
    );
    expect(move).not.toHaveBeenCalled();
  });

  it('covers a drag over no status and a drop outside every status', async () => {
    const drag = await renderDrag(TASKS);
    drag.pickUp(WELCOME);
    expect(drag.moveOver(WELCOME, null)).toBe(
      'Not over a status. Dropping here changes nothing.',
    );
    expect(drag.drop(WELCOME, null)).toBe(
      'Dropped GS-1 outside the statuses. It stays in status To do, position 1 of 2.',
    );
    expect(move).not.toHaveBeenCalled();
  });

  it('falls back to the title without a key, and never to the id when the task is gone', async () => {
    const drag = await renderDrag(TASKS, { projectKey: null });
    expect(drag.pickUp(OVERVIEW)).toBe(
      'Picked up Draft a company overview. Status To do, position 2 of 2. Move it with the arrow keys, drop it with Space or cancel with Escape.',
    );
    expect(drag.moveOver(OVERVIEW, WELCOME)).toBe(
      'Status To do, position 1 of 2.',
    );
    // Deleted or archived elsewhere while it was held.
    drag.view.rerender({ rows: TASKS.filter((row) => row._id !== OVERVIEW) });
    expect(drag.drop(OVERVIEW, WELCOME)).toBe(
      'The task is no longer here, so it was not moved.',
    );
    drag.pickUp(WELCOME);
    drag.view.rerender({ rows: TASKS.filter((row) => row._id !== WELCOME) });
    expect(drag.cancel(WELCOME)).toBe(
      'The task is no longer here, so it was not moved.',
    );
    expect(move).not.toHaveBeenCalled();
    expect(drag.spoken.join('\n')).not.toMatch(UUID);
  });

  it.each([
    {
      locale: 'de-DE' as const,
      pickedUp:
        'Aufgenommen: GS-1, Welcome — meet your assistant. Status Zu erledigen, Position 1 von 2. Verschieben mit den Pfeiltasten, ablegen mit der Leertaste, abbrechen mit Escape.',
      moved: 'Status In Prüfung, Position 1 von 1.',
      dropped: 'Abgelegt: GS-1 im Status In Prüfung, Position 1 von 1.',
      cancelled:
        'Verschieben abgebrochen: GS-1 bleibt im Status Zu erledigen, Position 1 von 2.',
    },
    {
      locale: 'fr-FR' as const,
      pickedUp:
        'Tu as saisi GS-1, Welcome — meet your assistant. Statut À faire, position 1 sur 2. Déplace-la avec les touches fléchées, dépose-la avec Espace ou annule avec Échap.',
      moved: 'Statut En revue, position 1 sur 1.',
      dropped: 'Tu as déposé GS-1 dans le statut En revue, position 1 sur 1.',
      cancelled:
        'Déplacement annulé\u00a0: GS-1 reste dans le statut À faire, position 1 sur 2.',
    },
  ])(
    'speaks $locale on pickup, move, drop and cancel',
    async ({ locale, pickedUp, moved, dropped, cancelled }) => {
      const drag = await renderDrag(TASKS, { locale });
      expect(drag.pickUp(WELCOME)).toBe(pickedUp);
      expect(drag.moveOver(WELCOME, 'in_review')).toBe(moved);
      expect(drag.drop(WELCOME, 'in_review')).toBe(dropped);
      drag.pickUp(WELCOME);
      expect(drag.cancel(WELCOME)).toBe(cancelled);
      expect(drag.spoken.join('\n')).not.toMatch(UUID);
    },
  );
});

describe('useTaskBoardDnd cross-status drops', () => {
  it('hands the choreography the drop position, and writes nothing more when it lands the card itself', async () => {
    // A live run's stop moves the card in its own write (`'handled'`).
    choreograph.mockResolvedValueOnce('handled');
    const drag = await renderDrag(TASKS);
    drag.pickUp(WELCOME);
    drag.moveOver(WELCOME, 'in_progress');
    drag.drop(WELCOME, 'in_progress');

    await waitFor(() => expect(choreograph).toHaveBeenCalledTimes(1));
    expect(choreograph).toHaveBeenCalledWith(
      expect.objectContaining({ _id: WELCOME }),
      'in_progress',
      { beforeTaskId: CHECKLIST, afterTaskId: undefined },
    );
    expect(move).not.toHaveBeenCalled();
  });
});
