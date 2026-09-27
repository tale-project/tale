import type { Sql } from 'postgres';

import {
  DAY_MS,
  dailyKeys,
  utcDateKey,
  utcDayStart,
} from '../../../lib/shared/metrics-window.ts';
import {
  loadProjectOrThrow,
  type ProjectAuthContext,
} from '../projects/service.ts';
import { assertTaskReadable } from './service.ts';

/**
 * Per-project task metrics for the project metrics page — the 0.3
 * `taskMetricsDaily` rollup re-derived AT READ TIME from the 0.5 rows, the
 * way the automation and external-turn folds read theirs: one bounded
 * newest-first page per source (`PROJECT_METRICS_MAX_SCAN`), no rollup
 * table, no cron. The window and the equal-length window before it (the
 * page's period-over-period deltas) come back as one row per UTC day in the
 * rollup row's own shape, so the charts and the KPI pairing (outcome +
 * intervention + cost travel together) read it unchanged.
 *
 * What each figure is, and where it comes from:
 * - created / completed / cancelled — the task's `created` and
 *   `status.changed` activity rows, on the day they happened.
 * - agent vs human completions — the completed task's assignee type.
 * - lead time — completion minus the task's creation; cycle time —
 *   completion minus the FIRST move into In progress (or the claim, when
 *   that came first). A task that reached Done without ever being in
 *   progress has a lead time and no cycle time.
 * - end-of-day flow (status counts, WIP, overdue, stale) — the task table
 *   replayed backwards through the window's status changes from its
 *   current state: exact for every day the scan covers, where the 0.3 cron
 *   could only snapshot its own day.
 * - agent runs started / failed, spend — `project_agent_runs` by start day;
 *   the spend is the run's sandbox op row (`spent_cents`), the same figure
 *   the external-turn metrics count.
 * - reviews passed — task reviews (`app.approvals`) that closed approved;
 *   changes requested — a person moving a task out of In review back to an
 *   open status, which is how the 0.5 review gate records "send it back".
 * - escalations — the questions agents asked people (`automation_human_asks`)
 *   on this project's runs, the source of the `agent_escalation` bell.
 * - capped — some source had more rows in the scan range than one page
 *   holds; the newest page was folded and the numbers are lower bounds.
 */

export const PROJECT_METRICS_MAX_SCAN = 5000;
const STALE_EOD_MS = 24 * 60 * 60 * 1000;

export type ProjectMetricsPeriodDays = 7 | 30 | 90;

const OPEN_STATUSES = ['backlog', 'todo', 'in_progress', 'in_review'] as const;
type OpenStatus = (typeof OPEN_STATUSES)[number];

function isOpenStatus(value: string | null | undefined): value is OpenStatus {
  return (
    value === 'backlog' ||
    value === 'todo' ||
    value === 'in_progress' ||
    value === 'in_review'
  );
}

export interface ProjectMetricsDay {
  dateKey: string;
  tasksCreated: number;
  tasksCompleted: number;
  tasksCancelled: number;
  cycleTimeSumMs: number;
  cycleTimeCount: number;
  leadTimeSumMs: number;
  leadTimeCount: number;
  statusCountsEod: Record<OpenStatus, number>;
  wipEod: number;
  overdueEod: number;
  staleEod: number;
  agentCompleted: number;
  humanCompleted: number;
  agentRunsStarted: number;
  agentRunsFailed: number;
  totalCostCents: number;
  reviewsPassed: number;
  reviewsChangesRequested: number;
  escalations: number;
  capped: boolean;
}

export interface ProjectTaskMetrics {
  /** One row per UTC day of the window, oldest first, today last. */
  daily: ProjectMetricsDay[];
  /** The equal-length window before `daily`, oldest first. */
  previousDaily: ProjectMetricsDay[];
}

/** A task as the fold reads it (every project task, newest first). */
export interface MetricsTaskRow {
  id: string;
  status: string;
  assigneeType: string | null;
  createdAt: number;
  claimedAt: number | null;
  dueDate: number | null;
  statusChangedAt: number | null;
  archivedAt: number | null;
}

/** A lifecycle activity row (`created` / `status.changed`) in scan range. */
export interface MetricsActivityRow {
  taskId: string;
  action: string;
  fromValue: string | null;
  toValue: string | null;
  actorType: string;
  createdAt: number;
}

/** A project-agent run in scan range with its op row's spend, if settled. */
export interface MetricsRunRow {
  status: string;
  startedAt: number;
  spentCents: number | null;
}

export interface ProjectMetricsSources {
  tasks: MetricsTaskRow[];
  activity: MetricsActivityRow[];
  /** First move into In progress per task id — the cycle-time clock start. */
  firstInProgressAt: ReadonlyMap<string, number>;
  runs: MetricsRunRow[];
  /** When each task review closed approved. */
  reviewsPassedAt: number[];
  /** When each agent question to a person was raised. */
  escalationsAt: number[];
  /** Some source overflowed its page: the figures are lower bounds. */
  capped: boolean;
}

function emptyDay(dateKey: string, capped: boolean): ProjectMetricsDay {
  return {
    dateKey,
    tasksCreated: 0,
    tasksCompleted: 0,
    tasksCancelled: 0,
    cycleTimeSumMs: 0,
    cycleTimeCount: 0,
    leadTimeSumMs: 0,
    leadTimeCount: 0,
    statusCountsEod: { backlog: 0, todo: 0, in_progress: 0, in_review: 0 },
    wipEod: 0,
    overdueEod: 0,
    staleEod: 0,
    agentCompleted: 0,
    humanCompleted: 0,
    agentRunsStarted: 0,
    agentRunsFailed: 0,
    totalCostCents: 0,
    reviewsPassed: 0,
    reviewsChangesRequested: 0,
    escalations: 0,
    capped,
  };
}

/** The UTC day-start of a `YYYY-MM-DD` key. */
function dayStartOfKey(dateKey: string): number {
  return Date.parse(`${dateKey}T00:00:00Z`);
}

/** The earliest move into In progress: the first status change there, or
 *  the claim when it came first. */
function cycleStartOf(
  task: MetricsTaskRow,
  firstInProgressAt: ReadonlyMap<string, number>,
): number | undefined {
  const moved = firstInProgressAt.get(task.id);
  const claimed = task.claimedAt ?? undefined;
  if (moved === undefined) return claimed;
  if (claimed === undefined) return moved;
  return Math.min(moved, claimed);
}

/**
 * Fold the loaded sources into the window's day rows. Pure: `now` and the
 * period are arguments, so the fold is testable without a clock or a
 * database. Rows outside the two windows (a page reaching further back than
 * the scan start, an op row with no start) are ignored, never mis-bucketed.
 */
export function foldProjectTaskMetrics(
  sources: ProjectMetricsSources,
  args: { periodDays: ProjectMetricsPeriodDays; now: number },
): ProjectTaskMetrics {
  const currentKeys = dailyKeys(args.periodDays, args.now);
  const previousKeys = dailyKeys(
    args.periodDays,
    args.now - args.periodDays * DAY_MS,
  );
  const days = new Map<string, ProjectMetricsDay>();
  for (const key of [...previousKeys, ...currentKeys]) {
    days.set(key, emptyDay(key, sources.capped));
  }
  const dayOf = (ts: number): ProjectMetricsDay | undefined =>
    days.get(utcDateKey(ts));

  const tasks = new Map(sources.tasks.map((task) => [task.id, task]));

  // ---- lifecycle: created / completed / cancelled / sent back ------------
  for (const row of sources.activity) {
    const day = dayOf(row.createdAt);
    if (day === undefined) continue;
    if (row.action === 'created') {
      day.tasksCreated += 1;
      continue;
    }
    if (row.action !== 'status.changed') continue;
    if (row.toValue === 'done') {
      day.tasksCompleted += 1;
      const task = tasks.get(row.taskId);
      if (task !== undefined) {
        day.leadTimeSumMs += Math.max(0, row.createdAt - task.createdAt);
        day.leadTimeCount += 1;
        if (task.assigneeType === 'agent') day.agentCompleted += 1;
        else day.humanCompleted += 1;
        const cycleStart = cycleStartOf(task, sources.firstInProgressAt);
        if (cycleStart !== undefined && cycleStart <= row.createdAt) {
          day.cycleTimeSumMs += row.createdAt - cycleStart;
          day.cycleTimeCount += 1;
        }
      }
    } else if (row.toValue === 'cancelled') {
      day.tasksCancelled += 1;
    }
    if (
      row.fromValue === 'in_review' &&
      row.actorType === 'user' &&
      isOpenStatus(row.toValue) &&
      row.toValue !== 'in_review'
    ) {
      day.reviewsChangesRequested += 1;
    }
  }

  // ---- agent runs: starts, failures, spend (start-day attribution) -------
  const costByDay = new Map<string, number>();
  for (const run of sources.runs) {
    const day = dayOf(run.startedAt);
    if (day === undefined) continue;
    day.agentRunsStarted += 1;
    if (run.status === 'failed') day.agentRunsFailed += 1;
    if (run.spentCents !== null && Number.isFinite(run.spentCents)) {
      costByDay.set(
        day.dateKey,
        (costByDay.get(day.dateKey) ?? 0) + run.spentCents,
      );
    }
  }
  for (const [dateKey, cents] of costByDay) {
    const day = days.get(dateKey);
    if (day !== undefined) day.totalCostCents = Math.round(cents);
  }

  for (const at of sources.reviewsPassedAt) {
    const day = dayOf(at);
    if (day !== undefined) day.reviewsPassed += 1;
  }
  for (const at of sources.escalationsAt) {
    const day = dayOf(at);
    if (day !== undefined) day.escalations += 1;
  }

  // ---- end-of-day flow: replay the status changes backwards ---------------
  // Newest first: walking the days from today back, every change stamped at
  // or after a day's end is undone (the task returns to its `from` status)
  // before that day is counted.
  const changes = sources.activity
    .filter((row) => row.action === 'status.changed')
    .sort((a, b) => b.createdAt - a.createdAt);
  const changesByTask = new Map<string, MetricsActivityRow[]>();
  for (let i = changes.length - 1; i >= 0; i--) {
    const change = changes[i];
    if (change === undefined) continue;
    const own = changesByTask.get(change.taskId);
    if (own === undefined) changesByTask.set(change.taskId, [change]);
    else own.push(change);
  }
  const state = new Map<string, string>();
  for (const task of sources.tasks) state.set(task.id, task.status);
  const undone = new Map<string, number>();
  let cursor = 0;
  const keysNewestFirst = [...currentKeys, ...previousKeys].sort((a, b) =>
    b.localeCompare(a),
  );
  for (const key of keysNewestFirst) {
    const day = days.get(key);
    if (day === undefined) continue;
    const end = dayStartOfKey(key) + DAY_MS;
    while (cursor < changes.length) {
      const change = changes[cursor];
      if (change === undefined || change.createdAt < end) break;
      cursor += 1;
      if (change.fromValue !== null) state.set(change.taskId, change.fromValue);
      undone.set(change.taskId, (undone.get(change.taskId) ?? 0) + 1);
    }
    for (const task of sources.tasks) {
      if (task.createdAt >= end) continue;
      if (task.archivedAt !== null && task.archivedAt < end) continue;
      const status = state.get(task.id);
      if (!isOpenStatus(status)) continue;
      day.statusCountsEod[status] += 1;
      if (status === 'in_progress' || status === 'in_review') day.wipEod += 1;
      if (task.dueDate !== null && task.dueDate < end) day.overdueEod += 1;
      if (status === 'in_progress') {
        const own = changesByTask.get(task.id) ?? [];
        const kept = own.length - (undone.get(task.id) ?? 0);
        const lastKept = kept > 0 ? own[kept - 1] : undefined;
        // No scanned change on the task: the row's own stamp is exact. Every
        // scanned change undone: the real last move predates the scan, and
        // the creation is a lower bound that answers "stale" the same way.
        const lastMove =
          lastKept !== undefined
            ? lastKept.createdAt
            : own.length === 0
              ? (task.statusChangedAt ?? task.createdAt)
              : task.createdAt;
        if (lastMove < end - STALE_EOD_MS) day.staleEod += 1;
      }
    }
  }

  const pick = (keys: string[]): ProjectMetricsDay[] =>
    keys.flatMap((key) => {
      const day = days.get(key);
      return day === undefined ? [] : [day];
    });
  return { daily: pick(currentKeys), previousDaily: pick(previousKeys) };
}

/** The scan range start: the first UTC day of the previous window. */
export function projectMetricsScanStart(
  periodDays: ProjectMetricsPeriodDays,
  now: number,
): number {
  return utcDayStart(now) - (2 * periodDays - 1) * DAY_MS;
}

async function loadProjectMetricsSources(
  sql: Sql,
  organizationId: string,
  projectId: string,
  scanStart: number,
): Promise<ProjectMetricsSources> {
  const pageSize = PROJECT_METRICS_MAX_SCAN + 1;
  let capped = false;
  const page = <T>(rows: T[]): T[] => {
    if (rows.length > PROJECT_METRICS_MAX_SCAN) capped = true;
    return rows.slice(0, PROJECT_METRICS_MAX_SCAN);
  };

  const tasks = page(
    await sql<MetricsTaskRow[]>`
      SELECT id, status, assignee_type AS "assigneeType",
             created_at_ms::float8 AS "createdAt",
             claimed_at_ms::float8 AS "claimedAt",
             due_date_ms::float8 AS "dueDate",
             status_changed_at_ms::float8 AS "statusChangedAt",
             archived_at_ms::float8 AS "archivedAt"
      FROM app.tasks
      WHERE org_id = ${organizationId} AND project_id = ${projectId}
      ORDER BY created_at_ms DESC
      LIMIT ${pageSize}
    `,
  );
  const activity = page(
    await sql<MetricsActivityRow[]>`
      SELECT task_id AS "taskId", action, from_value AS "fromValue",
             to_value AS "toValue", actor_type AS "actorType",
             created_at_ms::float8 AS "createdAt"
      FROM app.task_activity
      WHERE org_id = ${organizationId} AND project_id = ${projectId}
        AND created_at_ms >= ${scanStart}
        AND action IN ('created', 'status.changed')
      ORDER BY created_at_ms DESC
      LIMIT ${pageSize}
    `,
  );
  const completedIds = [
    ...new Set(
      activity
        .filter(
          (row) => row.action === 'status.changed' && row.toValue === 'done',
        )
        .map((row) => row.taskId),
    ),
  ];
  const firstInProgressAt = new Map<string, number>();
  if (completedIds.length > 0) {
    const starts = await sql<{ taskId: string; at: number }[]>`
      SELECT task_id AS "taskId", min(created_at_ms)::float8 AS "at"
      FROM app.task_activity
      WHERE task_id = ANY(${completedIds})
        AND action = 'status.changed' AND to_value = 'in_progress'
      GROUP BY task_id
    `;
    for (const row of starts) firstInProgressAt.set(row.taskId, row.at);
  }
  const runs = page(
    await sql<MetricsRunRow[]>`
      SELECT r.status, r.started_at_ms::float8 AS "startedAt",
             o.spent_cents::float8 AS "spentCents"
      FROM app.project_agent_runs r
      LEFT JOIN app.sandbox_session_ops o
        ON o.session_id = r.session_id AND o.exec_id = r.exec_id
      WHERE r.org_id = ${organizationId} AND r.project_id = ${projectId}
        AND r.started_at_ms >= ${scanStart}
      ORDER BY r.started_at_ms DESC
      LIMIT ${pageSize}
    `,
  );
  const reviewsPassed = page(
    await sql<{ at: number }[]>`
      SELECT a.reviewed_at_ms::float8 AS "at"
      FROM app.approvals a
      JOIN app.tasks t ON t.id = a.resource_id
      WHERE a.org_id = ${organizationId}
        AND a.resource_type = 'task_review' AND a.status = 'completed'
        AND t.project_id = ${projectId}
        AND a.reviewed_at_ms >= ${scanStart}
      ORDER BY a.reviewed_at_ms DESC
      LIMIT ${pageSize}
    `,
  );
  const escalations = page(
    await sql<{ at: number }[]>`
      SELECT a.created_at_ms::float8 AS "at"
      FROM app.automation_human_asks a
      JOIN app.automation_runs r ON r.id = a.run_id
      LEFT JOIN app.tasks t ON t.id = a.task_id
      WHERE a.org_id = ${organizationId}
        AND a.created_at_ms >= ${scanStart}
        AND (r.project_id = ${projectId} OR t.project_id = ${projectId})
      ORDER BY a.created_at_ms DESC
      LIMIT ${pageSize}
    `,
  );

  return {
    tasks,
    activity,
    firstInProgressAt,
    runs,
    reviewsPassedAt: reviewsPassed.map((row) => row.at),
    escalationsAt: escalations.map((row) => row.at),
    capped,
  };
}

/**
 * The project metrics page's read: the caller must be able to read the
 * project's tasks (`assertTaskReadable`), then the window folds from the
 * live rows. Throws the tasks/projects domain errors the route maps.
 */
export async function getProjectTaskMetrics(
  sql: Sql,
  auth: ProjectAuthContext,
  projectId: string,
  args: { periodDays: ProjectMetricsPeriodDays },
): Promise<ProjectTaskMetrics> {
  const project = await loadProjectOrThrow(sql, projectId);
  assertTaskReadable(project, auth);
  const now = Date.now();
  const sources = await loadProjectMetricsSources(
    sql,
    project.organizationId,
    projectId,
    projectMetricsScanStart(args.periodDays, now),
  );
  return foldProjectTaskMetrics(sources, { periodDays: args.periodDays, now });
}
