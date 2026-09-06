import type { Sql, TransactionSql } from 'postgres';

import { resolveDateNotifyAudience } from '../../core/tasks/date_notification_recipients.ts';
import { notifyUser } from '../collab/service.ts';
import { addTaskComment, lockTaskCommentQueue } from './comments.ts';

/**
 * Task date enforcement — the 0.5 twin of 0.4's
 * `enforceTaskDateNotifications` hourly cron.
 *
 * Three rungs, each with its own dedup stamp so a task is announced exactly
 * once per rung no matter how often the sweep runs:
 *
 *  1. START reached  → `start_notified_at_ms` (one-shot);
 *  2. DUE SOON       → `sla_level = 1`;
 *  3. OVERDUE ladder → `sla_level` 2 (nudge), 3 (creator), 4 (admins),
 *     climbing only after the escalation delays.
 *
 * Each rung lists its candidates once, then claims and announces EVERY ROW
 * IN ITS OWN TRANSACTION: the stamp is written by an `UPDATE … RETURNING`
 * that re-checks the rung's predicate (two workers cannot both take a row —
 * the 0.4 "atomic mark-and-return" property, kept), and the bell or nudge
 * rides the same transaction, so a fan-out that throws rolls that row's
 * stamp back and the next tick claims it again. Before, the batch was
 * stamped first on the root handle and announced after: a throw on row k
 * left rows k..n stamped and never announced — "exactly once" was really
 * at-most-once with a silent, permanent miss. Row-scoped rather than
 * batch-scoped on purpose: one task whose bell keeps failing must not hold
 * the whole rung of its org hostage.
 *
 * Pushing a due date out resets the ladder: the task's own update path
 * (`updateTask`) clears `sla_level` when the due date changes and
 * `start_notified_at_ms` when the start date changes, so the rungs fire
 * again for the new dates.
 */

type Db = Sql | TransactionSql;

const DUE_SOON_WINDOW_HOURS = 24;
const MANAGER_ESCALATION_HOURS = 24;
const ADMIN_ESCALATION_HOURS = 72;
const SWEEP_LIMIT = 50;

/** Statuses that end a task — a closed task is never chased about dates. */
const TERMINAL_STATUSES = ['done', 'cancelled', 'archived'] as const;

interface SweepRow {
  taskId: string;
  projectId: string;
  title: string;
  assigneeType: string | null;
  assigneeId: string | null;
  taskCreatorId: string | null;
  projectCreatorId: string | null;
}

const SWEEP_COLUMNS = `
  t.id AS "taskId", t.project_id AS "projectId", t.title,
  t.assignee_type AS "assigneeType", t.assignee_id AS "assigneeId",
  CASE WHEN t.created_by_type = 'user' THEN t.created_by END
    AS "taskCreatorId",
  p.created_by AS "projectCreatorId"
`;

/**
 * Who hears about a task's dates: the assignee if a person holds it, else
 * the human who filed it, else the project's creator. An agent-assigned task
 * with no human anywhere notifies nobody — a bell no person can act on is
 * noise (the REUSED 0.4 resolver decides this).
 */
async function notifyDateAlert(
  sql: Db,
  args: {
    organizationId: string;
    row: SweepRow;
    titleKey: string;
    bodyKey: string;
  },
): Promise<boolean> {
  const audience = resolveDateNotifyAudience({
    ...(args.row.assigneeType !== null
      ? { assigneeType: args.row.assigneeType }
      : {}),
    ...(args.row.assigneeId !== null
      ? { assigneeId: args.row.assigneeId }
      : {}),
    ...(args.row.taskCreatorId !== null
      ? { taskCreatorId: args.row.taskCreatorId }
      : {}),
    ...(args.row.projectCreatorId !== null
      ? { projectCreatorId: args.row.projectCreatorId }
      : {}),
  });
  if (audience === null) return false;
  const userId =
    audience === 'task_assignee'
      ? args.row.assigneeId
      : audience === 'task_creator'
        ? args.row.taskCreatorId
        : args.row.projectCreatorId;
  if (userId === null) return false;
  await notifyUser(sql, {
    userId,
    organizationId: args.organizationId,
    type: 'task_deadline',
    titleKey: args.titleKey,
    bodyKey: args.bodyKey,
    params: { title: args.row.title },
    resourceType: 'task',
    resourceId: args.row.taskId,
    taskId: args.row.taskId,
    actorType: 'system',
  });
  return true;
}

/** Org admins — the last rung's audience (the 0.4 `org_admins` fan-out). */
async function orgAdminUserIds(
  sql: Db,
  organizationId: string,
): Promise<string[]> {
  const rows = await sql<{ userId: string }[]>`
    SELECT "userId" FROM "member"
    WHERE "organizationId" = ${organizationId}
      AND lower("role") IN ('owner', 'admin')
  `;
  return rows.map((row) => row.userId);
}

/**
 * The level-2 nudge body — one narrator per language, picked by the reader's
 * locale from the comment's `bodyByLocale` (the same by-locale lane the
 * workflow `task.comment` native writes); `en` doubles as the stored `body`.
 */
export const OVERDUE_NUDGE_BODY = {
  en: '[automated] This task is past its due date. Update the due date, reprioritize, or close it.',
  de: '[automatisch] Diese Aufgabe hat ihr Fälligkeitsdatum überschritten. Verschiebe das Fälligkeitsdatum, priorisiere neu oder schließe sie.',
  fr: '[automatique] Cette tâche a dépassé sa date d’échéance. Décale la date d’échéance, change la priorité ou ferme-la.',
} as const;

/**
 * The level-2 nudge: an automated comment in the task's own discussion,
 * posted INSIDE the row's claim transaction — a refused nudge rolls the
 * level-2 stamp back, so the next tick nudges again instead of silently
 * skipping to the 24h escalation.
 */
async function postOverdueNudge(
  tx: TransactionSql,
  organizationId: string,
  taskId: string,
): Promise<void> {
  await addTaskComment(
    tx,
    // The sweep acts as the workflow actor with owner reach: the task was
    // selected by the org-scoped query above, so this only satisfies the
    // comment path's readability check.
    { organizationId, userId: 'workflow', role: 'owner', teamIds: [] },
    {
      taskId,
      body: OVERDUE_NUDGE_BODY.en,
      bodyByLocale: OVERDUE_NUDGE_BODY,
      author: { actorType: 'agent', actorId: 'workflow' },
    },
  );
}

/**
 * Claim one candidate row and announce it in ONE transaction. The claim is
 * the rung's own `UPDATE … RETURNING` with its predicate re-checked, so a
 * row another worker took (or that moved out of the rung since the listing)
 * answers no row and is skipped; a throw in the announce rolls the stamp
 * back — logged, never silent — and the next tick re-claims the row.
 */
async function claimAndAnnounce<Row>(
  sql: Sql,
  taskId: string,
  claim: (tx: TransactionSql) => Promise<Row[]>,
  announce: (tx: TransactionSql, row: Row) => Promise<boolean>,
): Promise<boolean> {
  try {
    return await sql.begin(async (tx) => {
      const row = (await claim(tx))[0];
      if (row === undefined) return false;
      return announce(tx, row);
    });
  } catch (error) {
    console.warn(
      `[tasks] date rung for task ${taskId} rolled back (claimed again next tick):`,
      error instanceof Error ? error.message : String(error),
    );
    return false;
  }
}

export interface DateSweepCounts {
  orgs: number;
  start: number;
  dueSoon: number;
  overdue: number;
  failedOrgs: number;
}

/** One org's three rungs. Exported for the probe; the cron sweeps the fleet. */
export async function enforceTaskDatesForOrg(
  sql: Sql,
  organizationId: string,
): Promise<{ start: number; dueSoon: number; overdue: number }> {
  const now = Date.now();

  const notTerminal = sql`
    app.tasks.archived_at_ms IS NULL
    AND app.tasks.status <> ALL(${TERMINAL_STATUSES})
  `;

  // Rung 1 — START reached, never announced.
  const starting = await sql<{ id: string }[]>`
    SELECT t2.id FROM app.tasks t2
    WHERE t2.org_id = ${organizationId}
      AND t2.start_date_ms IS NOT NULL
      AND t2.start_date_ms <= ${now}
      AND t2.start_notified_at_ms IS NULL
      AND t2.archived_at_ms IS NULL
      AND t2.status <> ALL(${TERMINAL_STATUSES})
    ORDER BY t2.start_date_ms
    LIMIT ${SWEEP_LIMIT}
  `;
  let start = 0;
  for (const { id } of starting) {
    const announced = await claimAndAnnounce(
      sql,
      id,
      (tx) => tx<SweepRow[]>`
        UPDATE app.tasks SET start_notified_at_ms = ${now}
        FROM app.projects p
        WHERE app.tasks.id = ${id} AND app.tasks.project_id = p.id
          AND app.tasks.start_date_ms IS NOT NULL
          AND app.tasks.start_date_ms <= ${now}
          AND app.tasks.start_notified_at_ms IS NULL
          AND ${notTerminal}
        RETURNING ${tx.unsafe(SWEEP_COLUMNS.replaceAll('t.', 'app.tasks.'))}
      `,
      (tx, row) =>
        notifyDateAlert(tx, {
          organizationId,
          row,
          titleKey: 'taskStartReached',
          bodyKey: 'taskStartReachedBody',
        }),
    );
    if (announced) start += 1;
  }

  // Rung 2 — DUE SOON, never warned (sla_level is the ladder position).
  const dueSoonBefore = now + DUE_SOON_WINDOW_HOURS * 3_600_000;
  const dueSoon = await sql<{ id: string }[]>`
    SELECT t2.id FROM app.tasks t2
    WHERE t2.org_id = ${organizationId}
      AND t2.due_date_ms IS NOT NULL
      AND t2.due_date_ms > ${now}
      AND t2.due_date_ms <= ${dueSoonBefore}
      AND coalesce(t2.sla_level, 0) < 1
      AND t2.archived_at_ms IS NULL
      AND t2.status <> ALL(${TERMINAL_STATUSES})
    ORDER BY t2.due_date_ms
    LIMIT ${SWEEP_LIMIT}
  `;
  let dueSoonCount = 0;
  for (const { id } of dueSoon) {
    const announced = await claimAndAnnounce(
      sql,
      id,
      (tx) => tx<SweepRow[]>`
        UPDATE app.tasks SET sla_level = 1, sla_level_at_ms = ${now}
        FROM app.projects p
        WHERE app.tasks.id = ${id} AND app.tasks.project_id = p.id
          AND app.tasks.due_date_ms IS NOT NULL
          AND app.tasks.due_date_ms > ${now}
          AND app.tasks.due_date_ms <= ${dueSoonBefore}
          AND coalesce(app.tasks.sla_level, 0) < 1
          AND ${notTerminal}
        RETURNING ${tx.unsafe(SWEEP_COLUMNS.replaceAll('t.', 'app.tasks.'))}
      `,
      (tx, row) =>
        notifyDateAlert(tx, {
          organizationId,
          row,
          titleKey: 'taskDueSoon',
          bodyKey: 'taskDueSoonBody',
        }),
    );
    if (announced) dueSoonCount += 1;
  }

  // Rung 3 — the OVERDUE ladder. The level is a function of HOW overdue the
  // task is (72h → admins, 24h → creator, else the nudge), and a row is
  // claimed whenever that target is ABOVE its current level — so a task that
  // sat unswept for days jumps straight to the right rung instead of
  // climbing one tick at a time (the 0.4 rule).
  //
  // What each level DOES is also 0.4's: level 2 posts an automated comment
  // on the task (a nudge in the place the work lives, not another bell),
  // and levels 3–4 escalate — the human who filed it, else the project's
  // creator, plus every org admin.
  const managerMs = MANAGER_ESCALATION_HOURS * 3_600_000;
  const adminMs = ADMIN_ESCALATION_HOURS * 3_600_000;
  const targetLevel = sql`
    CASE
      WHEN app.tasks.due_date_ms <= ${now - adminMs} THEN 4
      WHEN app.tasks.due_date_ms <= ${now - managerMs} THEN 3
      ELSE 2
    END
  `;
  const overdueRows = await sql<{ id: string }[]>`
    SELECT t2.id FROM app.tasks t2
    WHERE t2.org_id = ${organizationId}
      AND t2.due_date_ms IS NOT NULL
      AND t2.due_date_ms <= ${now}
      AND t2.archived_at_ms IS NULL
      AND t2.status <> ALL(${TERMINAL_STATUSES})
      AND (CASE
             WHEN t2.due_date_ms <= ${now - adminMs} THEN 4
             WHEN t2.due_date_ms <= ${now - managerMs} THEN 3
             ELSE 2
           END) > coalesce(t2.sla_level, 0)
    ORDER BY t2.due_date_ms
    LIMIT ${SWEEP_LIMIT}
  `;
  let overdue = 0;
  for (const { id } of overdueRows) {
    const announced = await claimAndAnnounce(
      sql,
      id,
      async (tx) => {
        // Level 2 comments on the task, and every commenter takes the
        // task's comment key BEFORE it writes the task row — take it first
        // here too, or this claim holds the row while a commenter holds the
        // key and the two deadlock.
        await lockTaskCommentQueue(tx, id);
        return tx<(SweepRow & { newLevel: number })[]>`
        UPDATE app.tasks SET
          sla_level = ${targetLevel}, sla_level_at_ms = ${now}
        FROM app.projects p
        WHERE app.tasks.id = ${id} AND app.tasks.project_id = p.id
          AND app.tasks.due_date_ms IS NOT NULL
          AND app.tasks.due_date_ms <= ${now}
          AND (${targetLevel}) > coalesce(app.tasks.sla_level, 0)
          AND ${notTerminal}
        RETURNING ${tx.unsafe(SWEEP_COLUMNS.replaceAll('t.', 'app.tasks.'))},
                  app.tasks.sla_level AS "newLevel"
      `;
      },
      async (tx, row) => {
        if (row.newLevel <= 2) {
          await postOverdueNudge(tx, organizationId, row.taskId);
          return true;
        }
        const escalationTargets = new Set<string>();
        if (row.taskCreatorId !== null) {
          escalationTargets.add(row.taskCreatorId);
        } else if (row.projectCreatorId !== null) {
          escalationTargets.add(row.projectCreatorId);
        }
        for (const adminId of await orgAdminUserIds(tx, organizationId)) {
          escalationTargets.add(adminId);
        }
        for (const userId of escalationTargets) {
          await notifyUser(tx, {
            userId,
            organizationId,
            type: 'task_deadline',
            titleKey: 'taskSlaEscalated',
            bodyKey: 'taskSlaEscalatedBody',
            params: { title: row.title },
            resourceType: 'task',
            resourceId: row.taskId,
            taskId: row.taskId,
            actorType: 'system',
          });
        }
        return true;
      },
    );
    if (announced) overdue += 1;
  }

  return { start, dueSoon: dueSoonCount, overdue };
}

/** The hourly cron: every org, one at a time; one org's fault never starves
 * the rest of the fleet. */
export async function enforceTaskDateNotifications(
  sql: Sql,
): Promise<DateSweepCounts> {
  const orgs = await sql<{ id: string }[]>`
    SELECT DISTINCT org_id AS id FROM app.tasks
    WHERE archived_at_ms IS NULL
      AND (start_date_ms IS NOT NULL OR due_date_ms IS NOT NULL)
  `;
  const counts: DateSweepCounts = {
    orgs: orgs.length,
    start: 0,
    dueSoon: 0,
    overdue: 0,
    failedOrgs: 0,
  };
  for (const org of orgs) {
    try {
      const result = await enforceTaskDatesForOrg(sql, org.id);
      counts.start += result.start;
      counts.dueSoon += result.dueSoon;
      counts.overdue += result.overdue;
    } catch (error) {
      counts.failedOrgs += 1;
      console.error(
        `[tasks] date enforcement failed for org ${org.id}:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  return counts;
}
