/** Real Postgres proof: a repeating task continues on exactly one copy when
 * it closes — dated to the rule's next day, carrying the rule — and never
 * twice, while deleting the copy clears the closed task's pointer but never
 * lets it continue again: deleting a copy in the middle of a series never
 * forks it, and deleting its newest task ends it. Only an
 * open top-level task no automation owns repeats: the doors refuse a rule
 * on a subtask, a close never continues one a subtask holds, handing a task
 * to an automation ends its series, and an agent's close audits its copy.
 * A rule that creates on the due date is continued by the scan exactly
 * once, as the system, while the task stays open; the copy brings the
 * subtasks back with the dependencies between them and the watchers; and
 * "Stop repeating" takes back a copy nobody touched but only ends the rule
 * of one somebody did. A task that continued reads so on its row even once
 * its copy is gone, and the edit door refuses it a rule again. */
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import { transactSerializable } from '@tale/shared/db/serializable';
import type { Sql } from 'postgres';

import {
  calendarDateIn,
  startOfCalendarDate,
  startOfTodayIn,
  type TaskRepeat,
  weekdayOf,
} from '../../../lib/shared/task-repeat.ts';
import { toJson } from '../../db/sql.ts';
import { TaskError } from './errors.ts';
import { createDueRepeatCopies } from './repeat-on-due.ts';
import { stopTaskRepeat } from './repeat.ts';
import {
  addTaskDependency,
  agentUpdateTaskStatusTrusted,
  assignTask,
  createTask,
  deleteTask,
  loadTaskOrThrow,
  updateTask,
  updateTaskStatus,
} from './service.ts';

export async function checkTaskRepeat(
  sql: Sql,
  ctx: { orgId: string; userId: string },
  record: (name: string, ok: boolean, detail: string) => void,
): Promise<void> {
  const { orgId, userId } = ctx;
  const auth = {
    organizationId: orgId,
    userId,
    role: 'owner',
    teamIds: [] as string[],
  };

  const columns = await sql<
    { name: string; type: string; deleteRule: string | null }[]
  >`
    SELECT c.column_name AS name, c.data_type AS type,
           rc.delete_rule AS "deleteRule"
    FROM information_schema.columns c
    LEFT JOIN information_schema.key_column_usage k
      ON k.table_schema = c.table_schema AND k.table_name = c.table_name
     AND k.column_name = c.column_name
    LEFT JOIN information_schema.referential_constraints rc
      ON rc.constraint_schema = k.constraint_schema
     AND rc.constraint_name = k.constraint_name
    WHERE c.table_schema = 'app' AND c.table_name = 'tasks'
      AND c.column_name IN (
        'repeat_rule', 'repeat_next_task_id', 'repeat_continued_at_ms'
      )
    ORDER BY c.column_name
  `;
  const shape = columns
    .map((column) => `${column.name}:${column.type}:${column.deleteRule}`)
    .join(', ');
  const onDueIndex = await sql<{ definition: string }[]>`
    SELECT indexdef AS definition FROM pg_indexes
    WHERE schemaname = 'app' AND indexname = 'tasks_repeat_on_due'
  `;
  const indexDefinition = onDueIndex[0]?.definition ?? '';
  record(
    'task repeat: 0130 adds the rule, the next-copy pointer (ON DELETE SET NULL), the continued stamp and the due-date scan’s partial index',
    shape ===
      'repeat_continued_at_ms:bigint:null, repeat_next_task_id:text:SET NULL, repeat_rule:jsonb:null' &&
      indexDefinition.includes('(due_date_ms, id)') &&
      indexDefinition.includes("'dueDate'") &&
      indexDefinition.includes('repeat_continued_at_ms IS NULL') &&
      !indexDefinition.includes('repeat_next_task_id'),
    `${shape}; ${indexDefinition}`,
  );

  const projectId = randomUUID();
  const key = `RP${randomUUID().slice(0, 4).toUpperCase()}`;
  const now = Date.now();
  await sql`
    INSERT INTO app.projects (id, org_id, name, key, created_by, created_at_ms,
      updated_at_ms)
    VALUES (${projectId}, ${orgId}, 'Repeating tasks', ${key}, ${userId},
      ${now}, ${now})
  `;
  // A due date far enough ahead that the next occurrence is simply the
  // following Monday, whenever this runs: Monday 7 January 2030 → 14th.
  const zone = 'Europe/Zurich';
  const rule: TaskRepeat = {
    frequency: 'weekly',
    interval: 1,
    weekdays: [1],
    timezone: zone,
  };
  const due = startOfCalendarDate({ year: 2030, month: 1, day: 7 }, zone);
  const nextDue = startOfCalendarDate({ year: 2030, month: 1, day: 14 }, zone);
  const taskId = await transactSerializable(sql, (tx) =>
    createTask(tx, auth, {
      projectId,
      title: 'Water the plants',
      status: 'todo',
      priority: 'p2',
      dueDate: due,
      repeat: rule,
    }),
  );
  const copies = () =>
    sql<
      {
        id: string;
        number: number;
        status: string;
        dueDate: number | null;
        repeat: unknown;
        createdBy: string;
      }[]
    >`
      SELECT id, number, status, due_date_ms::float8 AS "dueDate",
             repeat_rule AS "repeat", created_by AS "createdBy"
      FROM app.tasks
      WHERE project_id = ${projectId} AND id <> ${taskId}
      ORDER BY created_at_ms
    `;
  const pointer = async () => {
    const rows = await sql<{ next: string | null }[]>`
      SELECT repeat_next_task_id AS next FROM app.tasks WHERE id = ${taskId}
    `;
    return rows[0]?.next;
  };
  const continuedAt = async (id: string) => {
    const rows = await sql<{ at: number | null }[]>`
      SELECT repeat_continued_at_ms::float8 AS at FROM app.tasks
      WHERE id = ${id}
    `;
    return rows[0]?.at;
  };

  const answered = await transactSerializable(sql, (tx) =>
    updateTaskStatus(tx, auth, taskId, 'done'),
  );
  const afterClose = await copies();
  const copy = afterClose[0];
  const nextActivity = await sql<{ toValue: string | null }[]>`
    SELECT to_value AS "toValue" FROM app.task_activity
    WHERE task_id = ${taskId} AND action = 'repeat.next'
  `;
  record(
    'task repeat: closing a repeating task creates one copy in To do, due on the next occurrence, with the rule',
    afterClose.length === 1 &&
      copy?.status === 'todo' &&
      copy.dueDate === nextDue &&
      // jsonb keeps its own key order, so the rule compares by content.
      isDeepStrictEqual(copy.repeat, rule) &&
      copy.createdBy === userId &&
      (await pointer()) === copy.id &&
      answered?.id === copy.id &&
      answered.number === copy.number &&
      answered.dueDate === nextDue &&
      nextActivity.length === 1 &&
      nextActivity[0]?.toValue === `${key}-${copy.number}`,
    `copies=${afterClose.length}, status=${copy?.status}, due=${copy?.dueDate} (want ${nextDue}), rule=${JSON.stringify(copy?.repeat)}, author=${copy?.createdBy === userId ? 'kept' : copy?.createdBy}, answered=${JSON.stringify(answered)}, activity=${JSON.stringify(nextActivity)}`,
  );

  const reopened = await transactSerializable(sql, (tx) =>
    updateTaskStatus(tx, auth, taskId, 'todo'),
  );
  const reclosed = await transactSerializable(sql, (tx) =>
    updateTaskStatus(tx, auth, taskId, 'cancelled'),
  );
  const afterReclose = await copies();
  record(
    'task repeat: reopening and closing again creates no second copy',
    reopened === null && reclosed === null && afterReclose.length === 1,
    `reopen=${JSON.stringify(reopened)}, reclose=${JSON.stringify(reclosed)}, copies=${afterReclose.length}`,
  );

  if (copy !== undefined) {
    await sql`DELETE FROM app.tasks WHERE id = ${copy.id}`;
  }
  const cleared = await pointer();
  const stamp = await continuedAt(taskId);
  const reopenedAfterDelete = await transactSerializable(sql, (tx) =>
    updateTaskStatus(tx, auth, taskId, 'todo'),
  );
  const reclosedAfterDelete = await transactSerializable(sql, (tx) =>
    updateTaskStatus(tx, auth, taskId, 'done'),
  );
  const afterDelete = await copies();
  record(
    'task repeat: deleting the copy clears the closed task’s pointer, and reopening and closing it again creates nothing — its series ended',
    copy !== undefined &&
      cleared === null &&
      typeof stamp === 'number' &&
      reopenedAfterDelete === null &&
      reclosedAfterDelete === null &&
      afterDelete.length === 0,
    `pointer=${cleared}, stamp=${stamp}, reopen=${JSON.stringify(reopenedAfterDelete)}, reclose=${JSON.stringify(reclosedAfterDelete)}, copies=${afterDelete.length} (want 0)`,
  );

  // The series author follows each copy only while they watch: one who
  // unwatched the task is not subscribed to its copy.
  const unwatchedId = await transactSerializable(sql, (tx) =>
    createTask(tx, auth, {
      projectId,
      title: 'Empty the dishwasher',
      status: 'todo',
      dueDate: due,
      repeat: rule,
    }),
  );
  const watchedAtCreate = await sql<{ reason: string }[]>`
    SELECT reason FROM app.task_subscriptions
    WHERE task_id = ${unwatchedId} AND subscriber_id = ${userId}
  `;
  await sql`
    DELETE FROM app.task_subscriptions
    WHERE task_id = ${unwatchedId} AND subscriber_id = ${userId}
  `;
  const unwatchedCopy = await transactSerializable(sql, (tx) =>
    updateTaskStatus(tx, auth, unwatchedId, 'done'),
  );
  const followsCopy = await sql<{ reason: string }[]>`
    SELECT reason FROM app.task_subscriptions
    WHERE task_id = ${unwatchedCopy?.id ?? ''} AND subscriber_id = ${userId}
  `;
  record(
    'task repeat: the series author who unwatched the task is not subscribed to its copy',
    watchedAtCreate[0]?.reason === 'creator' &&
      unwatchedCopy !== null &&
      followsCopy.length === 0,
    `atCreate=${JSON.stringify(watchedAtCreate)}, copy=${JSON.stringify(unwatchedCopy)}, onCopy=${JSON.stringify(followsCopy)}`,
  );

  // A subtask never repeats: the create door refuses the rule, and a
  // subtask that holds one anyway (written straight to the row) closes
  // without a copy.
  const parentId = await transactSerializable(sql, (tx) =>
    createTask(tx, auth, {
      projectId,
      title: 'Quarterly close',
      status: 'todo',
    }),
  );
  let refusal = 'none';
  try {
    await transactSerializable(sql, (tx) =>
      createTask(tx, auth, {
        projectId,
        title: 'Collect the receipts',
        status: 'todo',
        parentTaskId: parentId,
        repeat: rule,
      }),
    );
  } catch (error) {
    if (!(error instanceof TaskError)) throw error;
    refusal = `${error.code}: ${error.message}`;
  }
  const subtaskId = await transactSerializable(sql, (tx) =>
    createTask(tx, auth, {
      projectId,
      title: 'Collect the receipts',
      status: 'todo',
      parentTaskId: parentId,
      dueDate: due,
    }),
  );
  await sql`
    UPDATE app.tasks SET repeat_rule = ${sql.json(toJson(rule))}
    WHERE id = ${subtaskId}
  `;
  const subtaskClosed = await transactSerializable(sql, (tx) =>
    updateTaskStatus(tx, auth, subtaskId, 'done'),
  );
  const underParent = await sql<{ count: number }[]>`
    SELECT count(*)::int AS count FROM app.tasks WHERE parent_task_id = ${parentId}
  `;
  record(
    'task repeat: a subtask never repeats — its rule is refused, and one it holds creates no copy',
    refusal === 'TASK_REPEAT_INVALID: Subtasks do not repeat' &&
      subtaskClosed === null &&
      underParent[0]?.count === 1,
    `refusal=${refusal}, answered=${JSON.stringify(subtaskClosed)}, children=${underParent[0]?.count} (want 1)`,
  );

  // Handing a repeating task to an automation ends its series, on the
  // timeline too.
  const handedId = await transactSerializable(sql, (tx) =>
    createTask(tx, auth, {
      projectId,
      title: 'File the VAT return',
      status: 'todo',
      dueDate: due,
      repeat: rule,
    }),
  );
  await transactSerializable(sql, (tx) =>
    assignTask(tx, auth, {
      taskId: handedId,
      assigneeType: 'app',
      assigneeId: 'vat-desk',
    }),
  );
  const handed = await sql<{ repeat: unknown; changed: number }[]>`
    SELECT t.repeat_rule AS "repeat",
           (SELECT count(*)::int FROM app.task_activity a
             WHERE a.task_id = t.id AND a.action = 'repeat.changed'
               AND a.to_value IS NULL) AS changed
    FROM app.tasks t WHERE t.id = ${handedId}
  `;
  record(
    'task repeat: assigning a repeating task to an automation clears its rule, with a repeat.changed line',
    handed[0]?.repeat === null && handed[0].changed === 1,
    `rule=${JSON.stringify(handed[0]?.repeat)}, lines=${handed[0]?.changed}`,
  );

  // An agent's cancel continues the series, and the copy's creation is on
  // the audit chain as the api actor's.
  const agentTaskId = await transactSerializable(sql, (tx) =>
    createTask(tx, auth, {
      projectId,
      title: 'Rotate the on-call',
      status: 'todo',
      dueDate: due,
      repeat: rule,
    }),
  );
  const cancelled = await transactSerializable(sql, (tx) =>
    agentUpdateTaskStatusTrusted(tx, {
      organizationId: orgId,
      actorId: 'workflow',
      taskId: agentTaskId,
      status: 'cancelled',
    }),
  );
  const agentCopy = await sql<{ id: string }[]>`
    SELECT repeat_next_task_id AS id FROM app.tasks
    WHERE id = ${agentTaskId} AND repeat_next_task_id IS NOT NULL
  `;
  const agentAudit = await sql<
    { actorType: string; repeatOf: string | null }[]
  >`
    SELECT actor_type AS "actorType", metadata->>'repeatOf' AS "repeatOf"
    FROM app.audit_logs
    WHERE org_id = ${orgId} AND action = 'task.created'
      AND resource_id = ${agentCopy[0]?.id ?? ''}
  `;
  record(
    'task repeat: an agent’s cancel creates the copy, audited as the api actor’s',
    cancelled.ok &&
      agentCopy.length === 1 &&
      agentAudit.length === 1 &&
      agentAudit[0]?.actorType === 'api' &&
      agentAudit[0].repeatOf === agentTaskId,
    `ok=${cancelled.ok}, copies=${agentCopy.length}, audit=${JSON.stringify(agentAudit)}`,
  );

  // ── The due-date lane ──────────────────────────────────────────────────
  // Due today, weekly on today's weekday, creating on the due date: today's
  // midnight has passed, so the scan continues it — once, however many
  // scans meet it, and to next week, so the copy is not due yet itself.
  const clock = Date.now();
  const today = calendarDateIn(clock, zone);
  const onDue: TaskRepeat = {
    frequency: 'weekly',
    interval: 1,
    weekdays: [weekdayOf(today)],
    timezone: zone,
    createOn: 'dueDate',
  };
  const todayStart = startOfTodayIn(zone, clock);
  const dueHeadId = await transactSerializable(sql, (tx) =>
    createTask(tx, auth, {
      projectId,
      title: 'Compliance review',
      status: 'todo',
      dueDate: todayStart,
      repeat: onDue,
    }),
  );
  // Due tomorrow: listed by the lookahead, not due yet in its zone.
  const tomorrowId = await transactSerializable(sql, (tx) =>
    createTask(tx, auth, {
      projectId,
      title: 'Payroll check',
      status: 'todo',
      dueDate: startOfCalendarDate(
        calendarDateIn(todayStart + 36 * 60 * 60 * 1000, zone),
        zone,
      ),
      repeat: onDue,
    }),
  );
  const scans = await Promise.all([
    createDueRepeatCopies(sql),
    createDueRepeatCopies(sql),
  ]);
  const rescan = await createDueRepeatCopies(sql);
  const dueRows = await sql<
    {
      id: string;
      status: string;
      next: string | null;
      dueDate: number | null;
      repeat: unknown;
    }[]
  >`
    SELECT id, status, repeat_next_task_id AS next,
           due_date_ms::float8 AS "dueDate", repeat_rule AS "repeat"
    FROM app.tasks
    WHERE project_id = ${projectId} AND title = 'Compliance review'
    ORDER BY created_at_ms, id
  `;
  const dueHead = dueRows.find((row) => row.id === dueHeadId);
  const dueCopy = dueRows.find((row) => row.id !== dueHeadId);
  const dueCredit = await sql<{ actorType: string; actorId: string }[]>`
    SELECT actor_type AS "actorType", actor_id AS "actorId"
    FROM app.task_activity
    WHERE task_id = ${dueHeadId} AND action = 'repeat.next'
  `;
  const tomorrowRow = await sql<{ next: string | null }[]>`
    SELECT repeat_next_task_id AS next FROM app.tasks WHERE id = ${tomorrowId}
  `;
  const weekLater = startOfCalendarDate(
    calendarDateIn(
      todayStart + 7 * 24 * 60 * 60 * 1000 + 12 * 60 * 60 * 1000,
      zone,
    ),
    zone,
  );
  record(
    'task repeat: the due-date scan continues a due task exactly once, as the system, and the task stays open',
    dueRows.length === 2 &&
      scans[0].created + scans[1].created === 1 &&
      rescan.created === 0 &&
      dueHead?.status === 'todo' &&
      dueHead.next === dueCopy?.id &&
      dueCopy?.status === 'todo' &&
      dueCopy.dueDate === weekLater &&
      isDeepStrictEqual(dueCopy.repeat, onDue) &&
      dueCredit.length === 1 &&
      dueCredit[0]?.actorType === 'agent' &&
      dueCredit[0].actorId === 'system' &&
      tomorrowRow[0]?.next === null,
    `rows=${dueRows.length}, scans=${JSON.stringify(scans.map((scan) => scan.created))}, rescan=${rescan.created}, head=${JSON.stringify(dueHead)}, copy=${JSON.stringify(dueCopy)} (want due ${weekLater}), credit=${JSON.stringify(dueCredit)}, tomorrow=${JSON.stringify(tomorrowRow)}`,
  );

  // ── Deleting a copy never re-arms the task before it ──────────────────
  // Standup notes → B → C → D, every one open: the scan continued each in
  // turn, B and C re-dated to today so it could, D due next week. Deleting B
  // (a copy in the middle) leaves the first task open, due and pointing
  // nowhere; deleting D (the newest) does the same to C. Neither continues
  // again — the series never forks, and deleting its newest task ends it —
  // not on the scan, and not when C is closed, reopened and closed again.
  const standup = 'Standup notes';
  const chainHeadId = await transactSerializable(sql, (tx) =>
    createTask(tx, auth, {
      projectId,
      title: standup,
      status: 'todo',
      dueDate: todayStart,
      repeat: onDue,
    }),
  );
  const nextOf = async (id: string) => {
    const rows = await sql<{ next: string | null }[]>`
      SELECT repeat_next_task_id AS next FROM app.tasks WHERE id = ${id}
    `;
    return rows[0]?.next ?? null;
  };
  const chain = [chainHeadId];
  for (let step = 0; step < 3; step += 1) {
    const last = chain.at(-1) ?? '';
    if (step > 0) {
      await transactSerializable(sql, (tx) =>
        updateTask(tx, auth, { taskId: last, dueDate: todayStart }),
      );
    }
    await createDueRepeatCopies(sql);
    const next = await nextOf(last);
    if (next === null) break;
    chain.push(next);
  }
  const [, middleId = '', beforeNewestId = '', newestId = ''] = chain;
  const standupTasks = async () => {
    const rows = await sql<{ id: string }[]>`
      SELECT id FROM app.tasks
      WHERE project_id = ${projectId} AND title = ${standup}
      ORDER BY created_at_ms, id
    `;
    return rows.map((row) => row.id);
  };
  const built = await standupTasks();

  await transactSerializable(sql, (tx) => deleteTask(tx, auth, middleId));
  const afterMiddleScan = await createDueRepeatCopies(sql);
  const afterMiddle = await standupTasks();
  const headAfter = await nextOf(chainHeadId);
  const headStamp = await continuedAt(chainHeadId);
  record(
    'task repeat: deleting a copy in the middle of an open due-date series never forks it — the task before it is not continued again',
    built.length === 4 &&
      chain.length === 4 &&
      afterMiddle.length === 3 &&
      !afterMiddle.includes(middleId) &&
      afterMiddle.includes(chainHeadId) &&
      headAfter === null &&
      typeof headStamp === 'number' &&
      afterMiddleScan.created === 0,
    `built=${built.length} (want 4), chain=${chain.length}, after=${afterMiddle.length} (want 3), headPointer=${headAfter}, headStamp=${headStamp}, scan=${JSON.stringify(afterMiddleScan)}`,
  );

  // The board reads which task continued its series, whether or not that
  // copy still exists, and the edit door refuses the first task a rule
  // again — nothing would ever create its next task. "Does not repeat"
  // still clears the one it holds.
  const headRow = await loadTaskOrThrow(sql, chainHeadId, orgId);
  const newestRow = await loadTaskOrThrow(sql, newestId, orgId);
  let headRuleRefusal = 'none';
  try {
    await transactSerializable(sql, (tx) =>
      updateTask(tx, auth, { taskId: chainHeadId, repeat: rule }),
    );
  } catch (error) {
    if (!(error instanceof TaskError)) throw error;
    headRuleRefusal = `${error.code}: ${error.message}`;
  }
  await transactSerializable(sql, (tx) =>
    updateTask(tx, auth, { taskId: chainHeadId, repeat: null }),
  );
  const headCleared = await loadTaskOrThrow(sql, chainHeadId, orgId);
  record(
    'task repeat: a task whose copy was deleted still reads as continued, and takes no rule again — clearing one is allowed',
    headRow.repeatContinued &&
      headRow.repeatNextTaskId === null &&
      !newestRow.repeatContinued &&
      headRuleRefusal ===
        'TASK_REPEAT_INVALID: This task already created its next task' &&
      headCleared.repeat === null &&
      headCleared.repeatContinued,
    `head continued=${String(headRow.repeatContinued)} pointer=${headRow.repeatNextTaskId}, newest continued=${String(newestRow.repeatContinued)} (want false), refusal=${headRuleRefusal}, cleared rule=${JSON.stringify(headCleared.repeat)}`,
  );

  await transactSerializable(sql, (tx) => deleteTask(tx, auth, newestId));
  const afterNewestScan = await createDueRepeatCopies(sql);
  const closedBeforeNewest = await transactSerializable(sql, (tx) =>
    updateTaskStatus(tx, auth, beforeNewestId, 'done'),
  );
  await transactSerializable(sql, (tx) =>
    updateTaskStatus(tx, auth, beforeNewestId, 'todo'),
  );
  const reclosedBeforeNewest = await transactSerializable(sql, (tx) =>
    updateTaskStatus(tx, auth, beforeNewestId, 'cancelled'),
  );
  const afterNewest = await standupTasks();
  record(
    'task repeat: deleting the newest task of a due-date series ends it — the scan, a close, and a reopen and re-close of the task before it create nothing',
    afterNewest.length === 2 &&
      afterNewest.includes(chainHeadId) &&
      afterNewest.includes(beforeNewestId) &&
      (await nextOf(beforeNewestId)) === null &&
      afterNewestScan.created === 0 &&
      closedBeforeNewest === null &&
      reclosedBeforeNewest === null,
    `after=${afterNewest.length} (want 2), scan=${JSON.stringify(afterNewestScan)}, close=${JSON.stringify(closedBeforeNewest)}, reclose=${JSON.stringify(reclosedBeforeNewest)}`,
  );

  // An automation filed it and a person held it, and that person can no
  // longer be carried over: the scan ends the series — the rule cleared, on
  // the timeline as the system — instead of meeting it every five minutes.
  const filedId = await transactSerializable(sql, (tx) =>
    createTask(tx, auth, {
      projectId,
      title: 'Reconcile the ledger',
      status: 'todo',
      dueDate: todayStart,
      repeat: onDue,
    }),
  );
  await sql`
    UPDATE app.tasks
    SET created_by_type = 'app', created_by = 'ledger-desk',
        assignee_type = 'user', assignee_id = ${randomUUID()}
    WHERE id = ${filedId}
  `;
  const filedScan = await createDueRepeatCopies(sql);
  const filedRescan = await createDueRepeatCopies(sql);
  const filed = await sql<
    { repeat: unknown; next: string | null; ended: number; copies: number }[]
  >`
    SELECT t.repeat_rule AS "repeat", t.repeat_next_task_id AS next,
           (SELECT count(*)::int FROM app.task_activity a
             WHERE a.task_id = t.id AND a.action = 'repeat.changed'
               AND a.to_value IS NULL AND a.actor_type = 'agent'
               AND a.actor_id = 'system') AS ended,
           (SELECT count(*)::int FROM app.tasks c
             WHERE c.project_id = t.project_id
               AND c.title = 'Reconcile the ledger') AS copies
    FROM app.tasks t WHERE t.id = ${filedId}
  `;
  record(
    'task repeat: the scan ends the series of an automation’s task whose person cannot carry over, as the system, and never lists it again',
    filed[0]?.repeat === null &&
      filed[0].next === null &&
      filed[0].ended === 1 &&
      filed[0].copies === 1 &&
      filedScan.skipped >= 1 &&
      filedRescan.skipped === 0 &&
      filedRescan.created === 0,
    `task=${JSON.stringify(filed[0])}, scan=${JSON.stringify(filedScan)}, rescan=${JSON.stringify(filedRescan)}`,
  );

  // ── The work comes back whole ──────────────────────────────────────────
  const workId = await transactSerializable(sql, (tx) =>
    createTask(tx, auth, {
      projectId,
      title: 'Month-end close',
      status: 'todo',
      dueDate: due,
      repeat: rule,
    }),
  );
  const collectId = await transactSerializable(sql, (tx) =>
    createTask(tx, auth, {
      projectId,
      title: 'Collect the receipts',
      status: 'todo',
      parentTaskId: workId,
      // Friday 4 January 2030 — three days before the parent.
      dueDate: startOfCalendarDate({ year: 2030, month: 1, day: 4 }, zone),
    }),
  );
  const bookId = await transactSerializable(sql, (tx) =>
    createTask(tx, auth, {
      projectId,
      title: 'Book the entries',
      status: 'todo',
      parentTaskId: workId,
    }),
  );
  const scanId = await transactSerializable(sql, (tx) =>
    createTask(tx, auth, {
      projectId,
      title: 'Scan the receipts',
      status: 'todo',
      parentTaskId: collectId,
    }),
  );
  const outsideId = await transactSerializable(sql, (tx) =>
    createTask(tx, auth, {
      projectId,
      title: 'Close the bank feed',
      status: 'todo',
    }),
  );
  await transactSerializable(sql, (tx) =>
    addTaskDependency(tx, auth, {
      blockerTaskId: collectId,
      blockedTaskId: bookId,
    }),
  );
  await transactSerializable(sql, (tx) =>
    addTaskDependency(tx, auth, {
      blockerTaskId: outsideId,
      blockedTaskId: bookId,
    }),
  );
  await sql`
    UPDATE app.task_subscriptions SET muted = true
    WHERE task_id = ${bookId} AND subscriber_id = ${userId}
  `;
  for (const id of [scanId, collectId, bookId, workId]) {
    await transactSerializable(sql, (tx) =>
      updateTaskStatus(tx, auth, id, 'done'),
    );
  }
  const workCopy = await sql<{ id: string | null }[]>`
    SELECT repeat_next_task_id AS id FROM app.tasks WHERE id = ${workId}
  `;
  const workCopyId = workCopy[0]?.id ?? '';
  const copied = await sql<
    {
      id: string;
      title: string;
      parentTaskId: string;
      status: string;
      repeat: unknown;
      dueDate: number | null;
    }[]
  >`
    WITH RECURSIVE tree AS (
      SELECT id FROM app.tasks WHERE parent_task_id = ${workCopyId}
      UNION ALL
      SELECT t.id FROM app.tasks t JOIN tree ON t.parent_task_id = tree.id
    )
    SELECT t.id, t.title, t.parent_task_id AS "parentTaskId", t.status,
           t.repeat_rule AS "repeat", t.due_date_ms::float8 AS "dueDate"
    FROM tree JOIN app.tasks t ON t.id = tree.id
    ORDER BY t.title
  `;
  const byTitle = new Map(copied.map((row) => [row.title, row]));
  const collectCopy = byTitle.get('Collect the receipts');
  const bookCopy = byTitle.get('Book the entries');
  const scanCopy = byTitle.get('Scan the receipts');
  const copiedEdges = await sql<{ blocker: string }[]>`
    SELECT blocker_task_id AS blocker FROM app.task_dependencies
    WHERE blocked_task_id = ${bookCopy?.id ?? ''}
  `;
  const carried = await sql<{ reason: string; muted: boolean | null }[]>`
    SELECT reason, muted FROM app.task_subscriptions
    WHERE task_id = ${bookCopy?.id ?? ''} AND subscriber_id = ${userId}
  `;
  const originalCollect = await sql<{ status: string }[]>`
    SELECT status FROM app.tasks WHERE id = ${collectId}
  `;
  record(
    'task repeat: the copy brings its subtasks back fresh, dated by its step, with the dependency between them and the watchers',
    copied.length === 3 &&
      collectCopy?.parentTaskId === workCopyId &&
      bookCopy?.parentTaskId === workCopyId &&
      scanCopy?.parentTaskId === collectCopy.id &&
      copied.every((row) => row.status === 'todo' && row.repeat === null) &&
      collectCopy.dueDate ===
        startOfCalendarDate({ year: 2030, month: 1, day: 11 }, zone) &&
      copiedEdges.length === 1 &&
      copiedEdges[0]?.blocker === collectCopy.id &&
      carried.length === 1 &&
      carried[0]?.reason === 'repeat' &&
      carried[0].muted === true &&
      originalCollect[0]?.status === 'done',
    `copied=${JSON.stringify(copied)}, edges=${JSON.stringify(copiedEdges)}, watcher=${JSON.stringify(carried)}, original=${originalCollect[0]?.status}`,
  );

  // ── Stop repeating ─────────────────────────────────────────────────────
  const openCount = async () => {
    const rows = await sql<{ open: number }[]>`
      SELECT open_task_count AS open FROM app.projects WHERE id = ${projectId}
    `;
    return rows[0]?.open ?? -1;
  };
  const stopId = await transactSerializable(sql, (tx) =>
    createTask(tx, auth, {
      projectId,
      title: 'Weekly backup check',
      status: 'todo',
      dueDate: due,
      repeat: rule,
    }),
  );
  const stopChildId = await transactSerializable(sql, (tx) =>
    createTask(tx, auth, {
      projectId,
      title: 'Restore one file',
      status: 'todo',
      parentTaskId: stopId,
    }),
  );
  await transactSerializable(sql, (tx) =>
    updateTaskStatus(tx, auth, stopChildId, 'done'),
  );
  const openBefore = await openCount();
  await transactSerializable(sql, (tx) =>
    updateTaskStatus(tx, auth, stopId, 'done'),
  );
  const stopCopy = await sql<{ id: string | null }[]>`
    SELECT repeat_next_task_id AS id FROM app.tasks WHERE id = ${stopId}
  `;
  const stopCopyId = stopCopy[0]?.id ?? '';
  const untouched = await transactSerializable(sql, (tx) =>
    stopTaskRepeat(tx, auth, stopId),
  );
  const leftOver = await sql<{ count: number }[]>`
    SELECT count(*)::int AS count FROM app.tasks
    WHERE id = ${stopCopyId} OR parent_task_id = ${stopCopyId}
  `;
  const stopped = await sql<{ repeat: unknown; next: string | null }[]>`
    SELECT repeat_rule AS "repeat", repeat_next_task_id AS next
    FROM app.tasks WHERE id = ${stopId}
  `;
  const openAfter = await openCount();
  record(
    'task repeat: stopping takes back a next task nobody touched, subtasks and all, and ends the series',
    stopCopyId !== '' &&
      untouched.removedNextTask &&
      leftOver[0]?.count === 0 &&
      stopped[0]?.repeat === null &&
      stopped[0].next === null &&
      // The close took one open card away and the copy's two came back;
      // taking them back leaves one fewer than before the close.
      openAfter === openBefore - 1,
    `answer=${JSON.stringify(untouched)}, left=${leftOver[0]?.count}, task=${JSON.stringify(stopped)}, open ${openBefore} → ${openAfter}`,
  );

  const keptId = await transactSerializable(sql, (tx) =>
    createTask(tx, auth, {
      projectId,
      title: 'Water the office plants',
      status: 'todo',
      dueDate: due,
      repeat: rule,
    }),
  );
  await transactSerializable(sql, (tx) =>
    updateTaskStatus(tx, auth, keptId, 'done'),
  );
  const keptCopy = await sql<{ id: string | null }[]>`
    SELECT repeat_next_task_id AS id FROM app.tasks WHERE id = ${keptId}
  `;
  const keptCopyId = keptCopy[0]?.id ?? '';
  await transactSerializable(sql, (tx) =>
    updateTask(tx, auth, { taskId: keptCopyId, title: 'Water the plants' }),
  );
  const touched = await transactSerializable(sql, (tx) =>
    stopTaskRepeat(tx, auth, keptId),
  );
  const kept = await sql<
    { id: string; repeat: unknown; next: string | null }[]
  >`
    SELECT id, repeat_rule AS "repeat", repeat_next_task_id AS next
    FROM app.tasks WHERE id IN (${keptId}, ${keptCopyId})
  `;
  const keptTask = kept.find((row) => row.id === keptId);
  const keptNext = kept.find((row) => row.id === keptCopyId);
  record(
    'task repeat: stopping keeps a next task somebody touched and only clears its rule',
    keptCopyId !== '' &&
      !touched.removedNextTask &&
      kept.length === 2 &&
      keptTask?.repeat === null &&
      keptTask.next === keptCopyId &&
      keptNext?.repeat === null,
    `answer=${JSON.stringify(touched)}, rows=${JSON.stringify(kept)}`,
  );
}
