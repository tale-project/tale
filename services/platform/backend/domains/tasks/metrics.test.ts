import type { TaskAgentReviewReceipt } from '@tale/shared/schemas/task-review';
import { describe, expect, it } from 'vitest';

import {
  foldProjectTaskMetrics,
  type MetricsActivityRow,
  type MetricsTaskRow,
  type ProjectMetricsDay,
  type ProjectMetricsSources,
  projectMetricsScanStart,
} from './metrics.ts';

/**
 * The read-time fold behind the project metrics page: every figure derives
 * from the rows as the 0.3 rollup defined it, and the end-of-day flow is a
 * backwards replay of the status changes — exact for every day, not a
 * snapshot of the compute day. Pinned here on a hand-built week so a change
 * to the bucketing, the cycle-time clock, or the replay shows up as a number.
 */

const T = (month: number, day: number, hour = 0): number =>
  Date.UTC(2026, month - 1, day, hour);
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = T(9, 27, 12);

function task(
  overrides: Partial<MetricsTaskRow> & { id: string },
): MetricsTaskRow {
  return {
    status: 'todo',
    assigneeType: null,
    createdAt: T(9, 1),
    claimedAt: null,
    dueDate: null,
    statusChangedAt: null,
    archivedAt: null,
    ...overrides,
  };
}

function moved(
  taskId: string,
  from: string,
  to: string,
  at: number,
  actorType: 'user' | 'agent' = 'user',
): MetricsActivityRow {
  return {
    taskId,
    action: 'status.changed',
    fromValue: from,
    toValue: to,
    actorType,
    createdAt: at,
  };
}

function created(taskId: string, at: number): MetricsActivityRow {
  return {
    taskId,
    action: 'created',
    fromValue: null,
    toValue: 'todo',
    actorType: 'user',
    createdAt: at,
  };
}

const agentChangesReceipt: TaskAgentReviewReceipt = {
  taskId: 't-a',
  approvalId: 'approval-1',
  runId: 'implementation-run',
  reviewer: { kind: 'agent', agentId: 'independent-reviewer' },
  issuerRunId: 'reviewer-run',
  evidenceRevision: 'a'.repeat(64),
  decision: 'request_changes',
  status: 'todo',
  feedbackCommentId: 'feedback-1',
  evidence: {
    checks: [{ name: 'Focus', outcome: 'failed', details: 'Focus is lost.' }],
    pullRequests: [],
  },
  decidedAt: T(9, 23, 12),
};

function agentChanges(
  overrides: Partial<MetricsActivityRow> = {},
): MetricsActivityRow {
  return {
    taskId: agentChangesReceipt.taskId,
    action: 'review.responded',
    fromValue: null,
    toValue: JSON.stringify(agentChangesReceipt),
    actorType: 'agent',
    createdAt: agentChangesReceipt.decidedAt,
    ...overrides,
  };
}

/** A week on one board: an agent task sent back once and then approved, a
 *  long-overdue human task nobody touches, a task archived the day it was
 *  filed, a task done straight from Todo, and a claimed task. */
function week(): ProjectMetricsSources {
  return {
    tasks: [
      task({
        id: 't-a',
        status: 'done',
        assigneeType: 'agent',
        createdAt: T(9, 20, 9),
        statusChangedAt: T(9, 25, 12),
      }),
      task({
        id: 't-b',
        status: 'in_progress',
        assigneeType: 'user',
        createdAt: T(9, 10),
        dueDate: T(9, 15),
        statusChangedAt: T(9, 10, 8),
      }),
      task({
        id: 't-c',
        status: 'backlog',
        createdAt: T(9, 26, 8),
        archivedAt: T(9, 26, 20),
      }),
      task({
        id: 't-d',
        status: 'done',
        assigneeType: 'user',
        createdAt: T(9, 22, 8),
        statusChangedAt: T(9, 22, 9),
      }),
      task({
        id: 't-e',
        status: 'done',
        assigneeType: 'user',
        createdAt: T(9, 21, 8),
        claimedAt: T(9, 21, 9),
        statusChangedAt: T(9, 21, 12),
      }),
    ],
    activity: [
      created('t-a', T(9, 20, 9)),
      moved('t-a', 'todo', 'in_progress', T(9, 21, 10)),
      moved('t-a', 'in_progress', 'in_review', T(9, 22, 10), 'agent'),
      moved('t-a', 'in_review', 'in_progress', T(9, 23, 10)),
      moved('t-a', 'in_progress', 'in_review', T(9, 24, 10), 'agent'),
      moved('t-a', 'in_review', 'done', T(9, 25, 12)),
      created('t-c', T(9, 26, 8)),
      created('t-d', T(9, 22, 8)),
      moved('t-d', 'todo', 'done', T(9, 22, 9)),
      created('t-e', T(9, 21, 8)),
      moved('t-e', 'todo', 'in_progress', T(9, 21, 10)),
      moved('t-e', 'in_progress', 'done', T(9, 21, 12)),
    ],
    firstInProgressAt: new Map([
      ['t-a', T(9, 21, 10)],
      ['t-e', T(9, 21, 10)],
    ]),
    runs: [
      { status: 'settled', startedAt: T(9, 25, 13), spentCents: 2.6 },
      { status: 'failed', startedAt: T(9, 25, 14), spentCents: 1.2 },
      { status: 'settled', startedAt: T(9, 1), spentCents: 99 },
    ],
    reviewsPassedAt: [T(9, 25, 12)],
    escalationsAt: [T(9, 24, 11)],
    capped: false,
  };
}

function byKey(days: ProjectMetricsDay[]): Map<string, ProjectMetricsDay> {
  return new Map(days.map((day) => [day.dateKey, day]));
}

describe('foldProjectTaskMetrics', () => {
  const result = foldProjectTaskMetrics(week(), { periodDays: 7, now: NOW });
  const daily = byKey(result.daily);
  const previous = byKey(result.previousDaily);
  const day = (key: string): ProjectMetricsDay => {
    const found = daily.get(key) ?? previous.get(key);
    if (found === undefined) throw new Error(`no day ${key}`);
    return found;
  };

  it('answers one row per UTC day of the window and of the window before', () => {
    expect(result.daily.map((d) => d.dateKey)).toEqual([
      '2026-09-21',
      '2026-09-22',
      '2026-09-23',
      '2026-09-24',
      '2026-09-25',
      '2026-09-26',
      '2026-09-27',
    ]);
    expect(result.previousDaily.map((d) => d.dateKey)).toEqual([
      '2026-09-14',
      '2026-09-15',
      '2026-09-16',
      '2026-09-17',
      '2026-09-18',
      '2026-09-19',
      '2026-09-20',
    ]);
  });

  it('counts creations and completions on the day they happened, by assignee kind', () => {
    expect(day('2026-09-20').tasksCreated).toBe(1);
    expect(day('2026-09-26').tasksCreated).toBe(1);
    expect(day('2026-09-25')).toMatchObject({
      tasksCompleted: 1,
      agentCompleted: 1,
      humanCompleted: 0,
    });
    expect(day('2026-09-22')).toMatchObject({
      tasksCreated: 1,
      tasksCompleted: 1,
      agentCompleted: 0,
      humanCompleted: 1,
    });
    expect(day('2026-09-21')).toMatchObject({
      tasksCreated: 1,
      tasksCompleted: 1,
      humanCompleted: 1,
    });
  });

  it('clocks cycle time from the first move into In progress, or the earlier claim', () => {
    // t-a: in progress 21st 10:00 → done 25th 12:00.
    expect(day('2026-09-25')).toMatchObject({
      cycleTimeCount: 1,
      cycleTimeSumMs: 4 * DAY + 2 * HOUR,
      leadTimeCount: 1,
      leadTimeSumMs: 5 * DAY + 3 * HOUR,
    });
    // t-e: claimed 09:00 beats the 10:00 move → 3h to done at 12:00.
    expect(day('2026-09-21')).toMatchObject({
      cycleTimeCount: 1,
      cycleTimeSumMs: 3 * HOUR,
      leadTimeSumMs: 4 * HOUR,
    });
    // t-d went Todo → Done: a lead time, no cycle time.
    expect(day('2026-09-22')).toMatchObject({
      cycleTimeCount: 0,
      cycleTimeSumMs: 0,
      leadTimeCount: 1,
      leadTimeSumMs: HOUR,
    });
  });

  it('reads a person sending a task back out of review as changes requested', () => {
    expect(day('2026-09-23').reviewsChangesRequested).toBe(1);
    // The agent's own moves into review are not interventions.
    expect(day('2026-09-22').reviewsChangesRequested).toBe(0);
    expect(day('2026-09-24').reviewsChangesRequested).toBe(0);
    expect(day('2026-09-25').reviewsPassed).toBe(1);
    expect(day('2026-09-24').escalations).toBe(1);
  });

  it('counts a native agent verdict once alongside a human send-back', () => {
    const counted = foldProjectTaskMetrics(
      {
        ...week(),
        activity: [
          moved('t-b', 'in_review', 'in_progress', T(9, 23, 9)),
          moved('t-a', 'in_review', 'todo', T(9, 23, 12), 'agent'),
          agentChanges(),
        ],
      },
      { periodDays: 7, now: NOW },
    );
    expect(
      counted.daily.find((row) => row.dateKey === '2026-09-23')
        ?.reviewsChangesRequested,
    ).toBe(2);
  });

  it.each<[string, MetricsActivityRow]>([
    [
      'agent withdrawal to To do',
      moved('t-a', 'in_review', 'todo', T(9, 23), 'agent'),
    ],
    [
      'agent restart',
      moved('t-a', 'in_review', 'in_progress', T(9, 23), 'agent'),
    ],
    [
      'agent submission',
      moved('t-a', 'in_progress', 'in_review', T(9, 23), 'agent'),
    ],
    ['human approval', moved('t-a', 'in_review', 'done', T(9, 23))],
    ['human cancellation', moved('t-a', 'in_review', 'cancelled', T(9, 23))],
    ['human no-op', moved('t-a', 'in_review', 'in_review', T(9, 23))],
    ['other task receipt', agentChanges({ taskId: 't-b' })],
    ['wrong action', agentChanges({ action: 'assignee.changed' })],
    ['wrong actor', agentChanges({ actorType: 'user' })],
    ['null receipt', agentChanges({ toValue: null })],
    ['malformed JSON', agentChanges({ toValue: '{' })],
    ['untyped prose', agentChanges({ toValue: 'Changes requested' })],
    [
      'incomplete receipt',
      agentChanges({
        toValue: JSON.stringify({ decision: 'request_changes' }),
      }),
    ],
    [
      'agent approval',
      agentChanges({
        toValue: JSON.stringify({
          ...agentChangesReceipt,
          decision: 'approve',
          status: 'done',
        }),
      }),
    ],
    [
      'mismatched status',
      agentChanges({
        toValue: JSON.stringify({ ...agentChangesReceipt, status: 'done' }),
      }),
    ],
  ])('does not count %s as requested changes', (_description, activity) => {
    const counted = foldProjectTaskMetrics(
      { ...week(), activity: [activity] },
      { periodDays: 7, now: NOW },
    );
    expect(
      counted.daily.reduce(
        (total, row) => total + row.reviewsChangesRequested,
        0,
      ),
    ).toBe(0);
  });

  it('attributes runs and their spend to the start day, rounded to cents', () => {
    expect(day('2026-09-25')).toMatchObject({
      agentRunsStarted: 2,
      agentRunsFailed: 1,
      totalCostCents: 4,
    });
    // The run from the 1st predates both windows: ignored, never mis-bucketed.
    const runsSeen = [...daily.values(), ...previous.values()].reduce(
      (sum, d) => sum + d.agentRunsStarted,
      0,
    );
    expect(runsSeen).toBe(2);
  });

  it('replays the status changes into exact end-of-day counts', () => {
    // 14th: only t-b exists, in progress since the 10th; its due date (15th
    // 00:00) has not passed at that day's end.
    expect(day('2026-09-14')).toMatchObject({
      statusCountsEod: { backlog: 0, todo: 0, in_progress: 1, in_review: 0 },
      wipEod: 1,
      overdueEod: 0,
      staleEod: 1,
    });
    expect(day('2026-09-15').overdueEod).toBe(1);
    // 20th: t-a filed (todo), t-b still in progress.
    expect(day('2026-09-20').statusCountsEod).toEqual({
      backlog: 0,
      todo: 1,
      in_progress: 1,
      in_review: 0,
    });
    // 21st: t-a moved into progress at 10:00 — not stale by that evening;
    // t-e is done by then and drops out.
    expect(day('2026-09-21')).toMatchObject({
      statusCountsEod: { backlog: 0, todo: 0, in_progress: 2, in_review: 0 },
      wipEod: 2,
      staleEod: 1,
    });
    // 22nd: t-a in review; t-d done the same morning never shows as open.
    expect(day('2026-09-22').statusCountsEod).toEqual({
      backlog: 0,
      todo: 0,
      in_progress: 1,
      in_review: 1,
    });
    // 23rd: sent back to In progress at 10:00 — moved that day, not stale.
    expect(day('2026-09-23')).toMatchObject({
      statusCountsEod: { backlog: 0, todo: 0, in_progress: 2, in_review: 0 },
      staleEod: 1,
    });
    expect(day('2026-09-24').statusCountsEod).toEqual({
      backlog: 0,
      todo: 0,
      in_progress: 1,
      in_review: 1,
    });
    // 25th on: t-a is done; 26th: t-c was archived before the day ended.
    expect(day('2026-09-25').statusCountsEod).toEqual({
      backlog: 0,
      todo: 0,
      in_progress: 1,
      in_review: 0,
    });
    expect(day('2026-09-26').statusCountsEod).toEqual({
      backlog: 0,
      todo: 0,
      in_progress: 1,
      in_review: 0,
    });
    expect(day('2026-09-27')).toMatchObject({
      wipEod: 1,
      overdueEod: 1,
      staleEod: 1,
    });
  });

  it('stamps every day capped when any source overflowed its page', () => {
    const capped = foldProjectTaskMetrics(
      { ...week(), capped: true },
      { periodDays: 7, now: NOW },
    );
    expect(capped.daily.every((d) => d.capped)).toBe(true);
    expect(capped.previousDaily.every((d) => d.capped)).toBe(true);
    expect(result.daily.some((d) => d.capped)).toBe(false);
  });

  it('answers an all-zero window for a project with no rows', () => {
    const empty = foldProjectTaskMetrics(
      {
        tasks: [],
        activity: [],
        firstInProgressAt: new Map(),
        runs: [],
        reviewsPassedAt: [],
        escalationsAt: [],
        capped: false,
      },
      { periodDays: 30, now: NOW },
    );
    expect(empty.daily).toHaveLength(30);
    expect(empty.previousDaily).toHaveLength(30);
    expect(
      empty.daily.every(
        (d) =>
          d.tasksCreated === 0 &&
          d.tasksCompleted === 0 &&
          d.wipEod === 0 &&
          d.totalCostCents === 0,
      ),
    ).toBe(true);
  });
});

describe('projectMetricsScanStart', () => {
  it('starts at the first UTC day of the previous window', () => {
    expect(projectMetricsScanStart(7, NOW)).toBe(T(9, 14));
    expect(projectMetricsScanStart(30, NOW)).toBe(T(9, 27) - 59 * DAY);
  });
});
