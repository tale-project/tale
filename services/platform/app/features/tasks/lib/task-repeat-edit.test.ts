import { describe, expect, it } from 'vitest';

import { startOfCalendarDate, type TaskRepeat } from '@/lib/shared/task-repeat';

import {
  canTaskRepeat,
  taskAutomationOwned,
  taskRepeatFieldState,
  taskRepeatPatch,
  taskRepeatReference,
  taskRepeatReferenceDay,
} from './task-repeat-edit';

const ZURICH = 'Europe/Zurich';

/** Midnight of an ISO day in Zurich. */
function day(iso: string): number {
  const [year, month, date] = iso.split('-').map(Number);
  return startOfCalendarDate(
    { year: year ?? 0, month: month ?? 0, day: date ?? 0 },
    ZURICH,
  );
}

/** Wednesday, September 30 2026, mid-afternoon in Zurich. */
const NOW = day('2026-09-30') + 15 * 3_600_000;

const daily: TaskRepeat = { frequency: 'daily', interval: 1, timezone: ZURICH };
const mondays: TaskRepeat = {
  frequency: 'weekly',
  interval: 1,
  weekdays: [1],
  timezone: ZURICH,
};

describe('taskRepeatPatch', () => {
  it('dates a task with no due date on the rule’s first day from today', () => {
    expect(taskRepeatPatch(daily, {}, NOW)).toEqual({
      repeat: daily,
      dueDate: day('2026-09-30'),
    });
    expect(taskRepeatPatch(mondays, {}, NOW)).toEqual({
      repeat: mondays,
      dueDate: day('2026-10-05'),
    });
  });

  it('never dates it before a later start date', () => {
    // Start Monday October 5, picked on Wednesday: the first day is the
    // start itself, not today, so the schedule stays in order.
    const patch = taskRepeatPatch(daily, { startDate: day('2026-10-05') }, NOW);
    expect(patch).toEqual({ repeat: daily, dueDate: day('2026-10-05') });
    // Weekly on Monday from a Tuesday start: the Monday after it.
    expect(
      taskRepeatPatch(mondays, { startDate: day('2026-10-06') }, NOW),
    ).toEqual({ repeat: mondays, dueDate: day('2026-10-12') });
  });

  it('reads a start date already past as today', () => {
    expect(
      taskRepeatPatch(daily, { startDate: day('2026-09-01') }, NOW),
    ).toEqual({ repeat: daily, dueDate: day('2026-09-30') });
  });

  it('leaves a due date already set alone', () => {
    const patch = taskRepeatPatch(
      mondays,
      { dueDate: day('2026-10-02'), startDate: day('2026-10-01') },
      NOW,
    );
    expect(patch).toEqual({ repeat: mondays });
    expect('dueDate' in patch).toBe(false);
  });

  it('stops the series without touching the dates', () => {
    expect(taskRepeatPatch(null, {}, NOW)).toEqual({ repeat: null });
    expect(
      taskRepeatPatch(null, { startDate: day('2026-10-05') }, NOW),
    ).toEqual({ repeat: null });
  });
});

describe('taskRepeatReference', () => {
  it('reads the due date first', () => {
    expect(
      taskRepeatReference(
        { dueDate: day('2026-10-02'), startDate: day('2026-10-09') },
        NOW,
        ZURICH,
      ),
    ).toBe(day('2026-10-02'));
  });

  it('falls back to a start date still ahead', () => {
    expect(
      taskRepeatReference({ startDate: day('2026-10-05') }, NOW, ZURICH),
    ).toBe(day('2026-10-05'));
  });

  it('otherwise reads today’s midnight, never the current instant', () => {
    expect(taskRepeatReference({}, NOW, ZURICH)).toBe(day('2026-09-30'));
    expect(
      taskRepeatReference({ startDate: day('2026-09-30') }, NOW, ZURICH),
    ).toBe(day('2026-09-30'));
    expect(
      taskRepeatReference({ startDate: day('2026-09-01') }, NOW, ZURICH),
    ).toBe(day('2026-09-30'));
  });
});

describe('canTaskRepeat', () => {
  it('lets a top-level task a person or agent works on repeat', () => {
    expect(canTaskRepeat({ createdByType: 'user' })).toBe(true);
    expect(
      canTaskRepeat({
        createdByType: 'user',
        assigneeType: 'agent',
      }),
    ).toBe(true);
    // An automation created it, but a person took it over.
    expect(
      canTaskRepeat({
        createdByType: 'app',
        assigneeType: 'user',
        assigneeId: 'user_1',
      }),
    ).toBe(true);
  });

  it('refuses a subtask', () => {
    expect(
      canTaskRepeat({ createdByType: 'user', parentTaskId: 'task_parent' }),
    ).toBe(false);
  });

  it('refuses a task an automation owns', () => {
    expect(canTaskRepeat({ createdByType: 'user', assigneeType: 'app' })).toBe(
      false,
    );
    expect(canTaskRepeat({ createdByType: 'app' })).toBe(false);
    // Half an assignee is no assignee: the automation that filed it owns it.
    expect(canTaskRepeat({ createdByType: 'app', assigneeType: 'user' })).toBe(
      false,
    );
  });
});

describe('taskAutomationOwned', () => {
  it('names a task assigned to an automation, or filed by one and unassigned', () => {
    expect(taskAutomationOwned({ assigneeType: 'app' })).toBe(true);
    expect(taskAutomationOwned({ createdByType: 'app' })).toBe(true);
    expect(
      taskAutomationOwned({ createdByType: 'app', assigneeType: 'user' }),
    ).toBe(true);
  });

  it('leaves a task a person or agent carries alone', () => {
    expect(taskAutomationOwned({ createdByType: 'user' })).toBe(false);
    expect(
      taskAutomationOwned({
        createdByType: 'app',
        assigneeType: 'agent',
        assigneeId: 'agent_1',
      }),
    ).toBe(false);
  });
});

describe('taskRepeatReferenceDay', () => {
  it('reads the due date’s calendar day and weekday in the rule’s zone', () => {
    // Friday October 2 at Zurich midnight.
    expect(
      taskRepeatReferenceDay({ dueDate: day('2026-10-02') }, NOW, ZURICH),
    ).toEqual({ year: 2026, month: 10, day: 2, weekday: 5 });
  });

  // Zurich's Monday midnight is still Sunday afternoon in Los Angeles, and
  // Monday morning in Tokyo: read at its nearest midnight, a rule set in
  // either zone still names the Monday the due date means.
  it.each(['America/Los_Angeles', 'Asia/Tokyo'])(
    'names the day a date picked in Zurich means, read in %s',
    (zone) => {
      expect(
        taskRepeatReferenceDay({ dueDate: day('2026-09-28') }, NOW, zone),
      ).toEqual({ year: 2026, month: 9, day: 28, weekday: 1 });
    },
  );

  it('falls back to today in the zone, never the current instant', () => {
    // 15:00 on Wednesday in Zurich is already Thursday in Auckland.
    expect(taskRepeatReferenceDay({}, NOW, ZURICH)).toEqual({
      year: 2026,
      month: 9,
      day: 30,
      weekday: 3,
    });
    expect(taskRepeatReferenceDay({}, NOW, 'Pacific/Auckland')).toEqual({
      year: 2026,
      month: 10,
      day: 1,
      weekday: 4,
    });
  });
});

describe('taskRepeatFieldState', () => {
  const open = {
    mode: 'details' as const,
    canMutate: true,
    status: 'todo' as const,
    automationOwned: false,
  };

  it('offers the picker on an open top-level task', () => {
    expect(taskRepeatFieldState(open)).toEqual({ kind: 'editable' });
    expect(
      taskRepeatFieldState({ ...open, mode: 'create', status: 'backlog' }),
    ).toEqual({ kind: 'editable' });
  });

  // A subtask has no rule of its own: it comes back with a repeating
  // parent, and says nothing while the parent does not repeat or loads.
  it('says a subtask comes back with a repeating parent, and hides otherwise', () => {
    const subtask = { ...open, parentTaskId: 'task_parent' };
    expect(
      taskRepeatFieldState({
        ...subtask,
        parentRepeats: true,
        parentLabel: 'OPS-3',
      }),
    ).toEqual({ kind: 'locked', reason: 'subtask', parent: 'OPS-3' });
    expect(
      taskRepeatFieldState({
        ...subtask,
        parentRepeats: false,
        parentLabel: 'OPS-3',
      }),
    ).toEqual({ kind: 'hidden' });
    expect(taskRepeatFieldState(subtask)).toEqual({ kind: 'hidden' });
  });

  // An archived subtask is left out of the parent's next task, so the row
  // would promise a copy that never comes.
  it('has no row on an archived subtask, even under a repeating parent', () => {
    expect(
      taskRepeatFieldState({
        ...open,
        canMutate: false,
        parentTaskId: 'task_parent',
        archived: true,
        parentRepeats: true,
        parentLabel: 'OPS-3',
      }),
    ).toEqual({ kind: 'hidden' });
  });

  it('shows the rule as text without the right to change it', () => {
    expect(taskRepeatFieldState({ ...open, canMutate: false })).toEqual({
      kind: 'readOnly',
    });
  });

  it('locks an automation’s task, a continued series and a closed task', () => {
    expect(taskRepeatFieldState({ ...open, automationOwned: true })).toEqual({
      kind: 'locked',
      reason: 'automation',
    });
    expect(
      taskRepeatFieldState({
        ...open,
        repeats: true,
        continued: true,
        nextTaskId: 'task_next',
        nextRepeats: true,
        nextTaskLabel: 'OPS-8',
      }),
    ).toEqual({ kind: 'locked', reason: 'continued', nextTask: 'OPS-8' });
    expect(taskRepeatFieldState({ ...open, status: 'done' })).toEqual({
      kind: 'locked',
      reason: 'closed',
    });
    expect(
      taskRepeatFieldState({ ...open, mode: 'create', status: 'cancelled' }),
    ).toEqual({ kind: 'locked', reason: 'notOpen' });
  });

  // Whether the task continued its series decides the lock, not whether
  // its next task still exists: deleting that task clears the pointer,
  // never the record that the series was handed on — this task never
  // continues it again, open or closed.
  it.each([
    [
      'continues on a next task while both carry a rule',
      {
        nextTaskId: 'task_next',
        nextRepeats: true,
        nextTaskLabel: 'OPS-8',
      },
      { kind: 'locked', reason: 'continued', nextTask: 'OPS-8' },
    ],
    [
      'continues, unnamed, while the next task loads',
      { nextTaskId: 'task_next' },
      { kind: 'locked', reason: 'continued' },
    ],
    [
      'has stopped once this task’s rule was cleared',
      {
        repeats: false,
        nextTaskId: 'task_next',
        nextRepeats: true,
        nextTaskLabel: 'OPS-8',
      },
      { kind: 'locked', reason: 'stopped' },
    ],
    [
      'has stopped, without waiting for the next task, once this task’s rule was cleared',
      { repeats: false, nextTaskId: 'task_next' },
      { kind: 'locked', reason: 'stopped' },
    ],
    [
      'has stopped once the next task’s rule was cleared',
      {
        nextTaskId: 'task_next',
        nextRepeats: false,
        nextTaskLabel: 'OPS-8',
      },
      { kind: 'locked', reason: 'stopped' },
    ],
    [
      'has ended once the next task was deleted',
      {},
      { kind: 'locked', reason: 'nextDeleted' },
    ],
    [
      // "Stop repeating" that took the next task back clears this task's
      // rule too: the person stopped the series, nobody deleted a task.
      'has stopped when its rule is gone along with the next task',
      { repeats: false },
      { kind: 'locked', reason: 'stopped' },
    ],
  ] as const)('a task that continued its series %s', (_name, fields, state) => {
    for (const status of ['todo', 'done'] as const) {
      expect(
        taskRepeatFieldState({
          ...open,
          status,
          repeats: true,
          continued: true,
          ...fields,
        }),
      ).toEqual(state);
    }
  });

  // When several reasons apply: subtask, then read-only, then automation,
  // then a continued series, then closed.
  it('lets the first reason in its order win', () => {
    const everything = {
      ...open,
      status: 'done' as const,
      canMutate: false,
      automationOwned: true,
      repeats: true,
      continued: true,
      nextTaskId: 'task_next',
      nextRepeats: true,
      nextTaskLabel: 'OPS-8',
    };
    expect(
      taskRepeatFieldState({
        ...everything,
        parentTaskId: 'task_parent',
        parentRepeats: true,
        parentLabel: 'OPS-3',
      }),
    ).toEqual({ kind: 'locked', reason: 'subtask', parent: 'OPS-3' });
    expect(taskRepeatFieldState(everything)).toEqual({ kind: 'readOnly' });
    expect(taskRepeatFieldState({ ...everything, canMutate: true })).toEqual({
      kind: 'locked',
      reason: 'automation',
    });
    expect(
      taskRepeatFieldState({
        ...everything,
        canMutate: true,
        automationOwned: false,
      }),
    ).toEqual({ kind: 'locked', reason: 'continued', nextTask: 'OPS-8' });
    expect(
      taskRepeatFieldState({
        ...everything,
        canMutate: true,
        automationOwned: false,
        continued: false,
        nextTaskId: undefined,
      }),
    ).toEqual({ kind: 'locked', reason: 'closed' });
  });
});
