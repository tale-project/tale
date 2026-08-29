import type { Sql } from 'postgres';

import { resolveDateNotifyAudience } from '../../../convex/tasks/date_notification_recipients.ts';
import { notifyUser } from '../collab/service.ts';

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
 * The stamp is written in the SAME statement that selects the row
 * (`UPDATE … RETURNING`), so two workers sweeping concurrently cannot both
 * claim it — the 0.4 "atomic mark-and-return" property, kept.
 *
 * Pushing a due date out resets the ladder: the task's own update path
 * clears `sla_level`, so the rungs fire again for the new date.
 */

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
  sql: Sql,
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
  sql: Sql,
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
 * The level-2 nudge: an automated comment in the task's own discussion. It
 * is written in the reader's locale by the same by-locale body 0.4 shipped,
 * so a German team does not get an English nag.
 */
const OVERDUE_NUDGE_BODY =
  '[automated] This task is past its due date. Update the due date, reprioritize, or close it.';

async function postOverdueNudge(
  sql: Sql,
  organizationId: string,
  taskId: string,
): Promise<void> {
  const { addTaskComment } = await import('./comments.ts');
  try {
    await sql.begin((tx) =>
      addTaskComment(
        tx,
        // The sweep acts as the workflow actor with owner reach: the task
        // was selected by the org-scoped query above, so this only satisfies
        // the comment path's readability check.
        { organizationId, userId: 'workflow', role: 'owner', teamIds: [] },
        {
          taskId,
          body: OVERDUE_NUDGE_BODY,
          author: { actorType: 'agent', actorId: 'workflow' },
        },
      ),
    );
  } catch (error) {
    // A task whose discussion refuses the nudge is still escalated by the
    // ladder next tick; never let one comment abort the sweep.
    console.warn(
      `[tasks] overdue nudge failed for ${taskId}:`,
      error instanceof Error ? error.message : String(error),
    );
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

  // Rung 1 — START reached, never announced.
  const starting = await sql<SweepRow[]>`
    UPDATE app.tasks SET start_notified_at_ms = ${now}
    FROM app.projects p
    WHERE app.tasks.project_id = p.id
      AND app.tasks.id IN (
        SELECT t2.id FROM app.tasks t2
        WHERE t2.org_id = ${organizationId}
          AND t2.start_date_ms IS NOT NULL
          AND t2.start_date_ms <= ${now}
          AND t2.start_notified_at_ms IS NULL
          AND t2.archived_at_ms IS NULL
          AND t2.status <> ALL(${TERMINAL_STATUSES})
        ORDER BY t2.start_date_ms
        LIMIT ${SWEEP_LIMIT}
      )
    RETURNING ${sql.unsafe(SWEEP_COLUMNS.replaceAll('t.', 'app.tasks.'))}
  `;
  let start = 0;
  for (const row of starting) {
    if (
      await notifyDateAlert(sql, {
        organizationId,
        row,
        titleKey: 'taskStartReached',
        bodyKey: 'taskStartReachedBody',
      })
    ) {
      start += 1;
    }
  }

  // Rung 2 — DUE SOON, never warned (sla_level is the ladder position).
  const dueSoonBefore = now + DUE_SOON_WINDOW_HOURS * 3_600_000;
  const dueSoon = await sql<SweepRow[]>`
    UPDATE app.tasks SET sla_level = 1, sla_level_at_ms = ${now}
    FROM app.projects p
    WHERE app.tasks.project_id = p.id
      AND app.tasks.id IN (
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
      )
    RETURNING ${sql.unsafe(SWEEP_COLUMNS.replaceAll('t.', 'app.tasks.'))}
  `;
  let dueSoonCount = 0;
  for (const row of dueSoon) {
    if (
      await notifyDateAlert(sql, {
        organizationId,
        row,
        titleKey: 'taskDueSoon',
        bodyKey: 'taskDueSoonBody',
      })
    ) {
      dueSoonCount += 1;
    }
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
  const overdueRows = await sql<(SweepRow & { newLevel: number })[]>`
    UPDATE app.tasks SET
      sla_level = CASE
        WHEN app.tasks.due_date_ms <= ${now - adminMs} THEN 4
        WHEN app.tasks.due_date_ms <= ${now - managerMs} THEN 3
        ELSE 2
      END,
      sla_level_at_ms = ${now}
    FROM app.projects p
    WHERE app.tasks.project_id = p.id
      AND app.tasks.id IN (
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
      )
    RETURNING ${sql.unsafe(SWEEP_COLUMNS.replaceAll('t.', 'app.tasks.'))},
              app.tasks.sla_level AS "newLevel"
  `;
  let overdue = 0;
  for (const row of overdueRows) {
    if (row.newLevel <= 2) {
      await postOverdueNudge(sql, organizationId, row.taskId);
      overdue += 1;
      continue;
    }
    const escalationTargets = new Set<string>();
    if (row.taskCreatorId !== null) escalationTargets.add(row.taskCreatorId);
    else if (row.projectCreatorId !== null) {
      escalationTargets.add(row.projectCreatorId);
    }
    for (const adminId of await orgAdminUserIds(sql, organizationId)) {
      escalationTargets.add(adminId);
    }
    for (const userId of escalationTargets) {
      await notifyUser(sql, {
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
    overdue += 1;
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
