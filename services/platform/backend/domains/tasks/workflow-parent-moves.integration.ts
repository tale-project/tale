import { randomUUID } from 'node:crypto';

import type { Sql } from 'postgres';
import { z } from 'zod';

/** Real Postgres proof over the app's own doors: moving an automation-owned
 * parent out of In progress while its run is live stops the run and lands
 * the card where it was moved, in one transaction. Only a closing move meets
 * the open-subtask guard; a refused move leaves the run, its question, its
 * approval, the task and its history exactly as they were. The engine is
 * inert: the runs are rows parked on a question, and nothing executes. */
import { markAutomationWriterInTx } from '../automations/writer-protocol.ts';

type Recorder = (name: string, ok: boolean, detail: string) => void;

interface Parent {
  taskId: string;
  runId: string;
  askId: string;
  approvalId: string;
}

export async function checkTaskWorkflowParentMoves(
  sql: Sql,
  base: string,
  ctx: { cookie: string; orgId: string; userId: string },
  reader: { cookie: string },
  record: Recorder,
): Promise<void> {
  const { orgId, userId } = ctx;
  const suffix = randomUUID().slice(0, 8);
  const projectId = randomUUID();
  const automation = `itest-parent-flow-${suffix}`;
  const now = Date.now();
  let rank = 0;
  const nextRank = () => {
    rank += 1;
    return `m${String(rank).padStart(4, '0')}`;
  };

  const post = async (
    cookie: string,
    route: string,
    body?: unknown,
  ): Promise<{ status: number; body: Record<string, unknown> | null }> => {
    const response = await fetch(`${base}${route}?orgId=${orgId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, origin: base },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const json = z
      .record(z.string(), z.unknown())
      .safeParse(await response.json().catch(() => null));
    return { status: response.status, body: json.success ? json.data : null };
  };
  /** The board's move off a live In progress, as the app sends it. */
  const stopAndMove = (taskId: string, body?: unknown, cookie = ctx.cookie) =>
    post(cookie, `/api/app/tasks/${taskId}/workflow/cancel`, body);

  const mkTask = async (
    title: string,
    status: string,
    parentTaskId: string | null,
  ): Promise<string> => {
    const taskId = randomUUID();
    await sql`
      INSERT INTO app.tasks (id, org_id, project_id, title, status, rank,
        assignee_type, assignee_id, parent_task_id, completed_at_ms,
        created_by, created_by_type, created_at_ms, updated_at_ms)
      VALUES (${taskId}, ${orgId}, ${projectId}, ${title}, ${status},
        ${nextRank()}, ${parentTaskId === null ? 'app' : null},
        ${parentTaskId === null ? automation : null}, ${parentTaskId},
        ${status === 'done' || status === 'cancelled' ? now : null},
        ${userId}, 'user', ${now}, ${now})
    `;
    return taskId;
  };
  /** An automation-owned parent at In progress whose live run is parked on
   * a question, with a connector write waiting for approval, and the given
   * subtasks. */
  const mkParent = async (
    title: string,
    children: readonly string[],
  ): Promise<Parent> => {
    const taskId = await mkTask(title, 'in_progress', null);
    for (const [index, status] of children.entries()) {
      await mkTask(`${title} · subtask ${index + 1}`, status, taskId);
    }
    const runs = await sql.begin(async (fixtureTx) => {
      await markAutomationWriterInTx(fixtureTx);
      return fixtureTx<{ id: string }[]>`
      INSERT INTO app.automation_runs (
        org_id, project_id, name, version, status, mode, started_by, input,
        detail, started_at_ms
      ) VALUES (
        ${orgId}, ${projectId}, ${automation}, 1, 'waiting', 'live',
        ${`user:${userId}`}, ${sql.json({ task: { id: taskId } })},
        'ask', ${now}
      ) RETURNING id
    `;
    });
    const runId = runs[0]?.id ?? '';
    const asks = await sql<{ id: string }[]>`
      INSERT INTO app.automation_human_asks (
        org_id, run_id, node_id, session_id, exec_id, question, status,
        expires_at_ms, task_id, created_at_ms
      ) VALUES (
        ${orgId}, ${runId}, 'review', ${`wf-${runId}`}, ${`exec-${runId}`},
        'Which supplier file is current?', 'pending', ${now + 86_400_000},
        ${taskId}, ${now}
      ) RETURNING id
    `;
    const approvals = await sql<{ id: string }[]>`
      INSERT INTO app.approvals (
        org_id, status, resource_type, resource_id, priority, metadata,
        created_at_ms
      ) VALUES (
        ${orgId}, 'pending', 'connector_operation', ${`op-${runId}`}, 'high',
        ${sql.json({ runId, operation: 'itest.write' })}, ${now}
      ) RETURNING id
    `;
    return {
      taskId,
      runId,
      askId: asks[0]?.id ?? '',
      approvalId: approvals[0]?.id ?? '',
    };
  };
  const state = async (parent: Parent) => {
    const [task] = await sql<
      {
        status: string;
        rank: string;
        completedAt: number | null;
        comments: number;
      }[]
    >`
      SELECT status, rank, completed_at_ms::float8 AS "completedAt",
             comment_count AS comments
      FROM app.tasks WHERE id = ${parent.taskId}
    `;
    const [run] = await sql<{ status: string }[]>`
      SELECT status FROM app.automation_runs WHERE id = ${parent.runId}
    `;
    const [ask] = await sql<{ status: string }[]>`
      SELECT status FROM app.automation_human_asks WHERE id = ${parent.askId}
    `;
    const [approval] = await sql<
      { status: string; withdrawn: string | null }[]
    >`
      SELECT status, metadata ->> 'withdrawn' AS withdrawn
      FROM app.approvals WHERE id = ${parent.approvalId}
    `;
    const children = await sql<{ status: string }[]>`
      SELECT status FROM app.tasks WHERE parent_task_id = ${parent.taskId}
      ORDER BY title
    `;
    const activity = await sql<{ line: string }[]>`
      SELECT action || ':' || coalesce(from_value, '') || '>'
             || coalesce(to_value, '') AS line
      FROM app.task_activity WHERE task_id = ${parent.taskId} ORDER BY id
    `;
    const audits = await sql<{ action: string }[]>`
      SELECT action FROM app.audit_logs
      WHERE org_id = ${orgId}
        AND resource_id IN (${parent.taskId}, ${parent.runId})
      ORDER BY ts, action
    `;
    return {
      task: task?.status ?? 'gone',
      rank: task?.rank ?? '',
      completed: task?.completedAt !== null && task?.completedAt !== undefined,
      comments: task?.comments ?? -1,
      run: run?.status ?? 'gone',
      ask: ask?.status ?? 'gone',
      approval: `${approval?.status ?? 'gone'}${approval?.withdrawn === 'true' ? '/withdrawn' : ''}`,
      children: children.map((child) => child.status).join(','),
      activity: activity.map((row) => row.line),
      audits: audits.map((row) => row.action),
    };
  };
  type State = Awaited<ReturnType<typeof state>>;
  const untouched = (before: State, after: State) =>
    JSON.stringify(before) === JSON.stringify(after);
  const show = (value: unknown) => JSON.stringify(value);

  try {
    await sql`
      INSERT INTO app.projects (id, org_id, name, created_by, created_at_ms,
                                updated_at_ms)
      VALUES (${projectId}, ${orgId}, 'Workflow parent moves', ${userId},
              ${now}, ${now})
    `;

    // ---- open subtask, moved to To do: the run stops, the card moves ----
    const open = await mkParent('Open subtask to To do', ['todo']);
    const openMove = await stopAndMove(open.taskId, { status: 'todo' });
    const openAfter = await state(open);
    record(
      'workflow parent: moving it to To do with an open subtask stops the run and moves the card in one write',
      openMove.status === 200 &&
        openMove.body?.executionCancelled === true &&
        openMove.body.taskCancelled === false &&
        openMove.body.executionId === open.runId &&
        openAfter.task === 'todo' &&
        !openAfter.completed &&
        openAfter.run === 'cancelled' &&
        openAfter.ask === 'cancelled' &&
        openAfter.approval === 'rejected/withdrawn' &&
        openAfter.children === 'todo' &&
        show(
          openAfter.activity.filter((line) =>
            line.startsWith('status.changed'),
          ),
        ) === show(['status.changed:in_progress>todo']) &&
        openAfter.audits.filter((action) => action === 'task.status_changed')
          .length === 1 &&
        openAfter.audits.filter(
          (action) => action === 'automation.run.cancelled',
        ).length === 1,
      `door=${openMove.status} ${show(openMove.body)} (want 200, executionCancelled, not taskCancelled), task=${openAfter.task} run=${openAfter.run} ask=${openAfter.ask} approval=${openAfter.approval} subtasks=${openAfter.children} (want todo, cancelled, cancelled, rejected/withdrawn, todo), activity=${show(openAfter.activity)} (want one in_progress>todo, never through cancelled), audits=${show(openAfter.audits)}`,
    );

    // ---- open subtask, closing moves: refused, and nothing is stopped ----
    for (const [label, body] of [
      ['moved to Done', { status: 'done' }],
      ['moved to Cancelled', { status: 'cancelled' }],
      ['stopped with no destination (Cancel run)', undefined],
    ] as const) {
      const parent = await mkParent(`Closing move ${label}`, ['in_progress']);
      const before = await state(parent);
      const refused = await stopAndMove(parent.taskId, body);
      const after = await state(parent);
      record(
        `workflow parent: an open subtask refuses the parent ${label}, and the run, its question, its approval and the task stay as they were`,
        refused.status === 400 &&
          refused.body?.error === 'TASK_HAS_OPEN_SUBTASKS' &&
          untouched(before, after) &&
          after.task === 'in_progress' &&
          after.run === 'waiting' &&
          after.ask === 'pending' &&
          after.approval === 'pending' &&
          after.activity.length === 0,
        `door=${refused.status} ${show(refused.body)} (want 400 TASK_HAS_OPEN_SUBTASKS), before=${show(before)}, after=${show(after)} (want identical: task in_progress, run waiting, ask and approval pending, no activity)`,
      );
    }

    // ---- finished subtasks: the closing move goes through ------------------
    const finished = await mkParent('Finished subtasks to Done', [
      'done',
      'cancelled',
    ]);
    const finishedMove = await stopAndMove(finished.taskId, { status: 'done' });
    const finishedAfter = await state(finished);
    record(
      'workflow parent: with every subtask finished, moving it to Done stops the run and closes it once',
      finishedMove.status === 200 &&
        finishedMove.body?.executionCancelled === true &&
        finishedAfter.task === 'done' &&
        finishedAfter.completed &&
        finishedAfter.run === 'cancelled' &&
        finishedAfter.children === 'done,cancelled' &&
        show(
          finishedAfter.activity.filter((line) =>
            line.startsWith('status.changed'),
          ),
        ) === show(['status.changed:in_progress>done']),
      `door=${finishedMove.status} ${show(finishedMove.body)}, task=${finishedAfter.task} completed=${finishedAfter.completed} run=${finishedAfter.run} subtasks=${finishedAfter.children} (want done, true, cancelled, done,cancelled), activity=${show(finishedAfter.activity)} (want one in_progress>done)`,
    );

    // ---- no subtasks: Backlog, In review and the default Cancelled ---------
    const noChildren: [string, unknown, string][] = [
      ['Backlog', { status: 'backlog' }, 'backlog'],
      ['In review', { status: 'in_review' }, 'in_review'],
      ['the default stop', undefined, 'cancelled'],
    ];
    for (const [label, body, expected] of noChildren) {
      const parent = await mkParent(`No subtasks to ${label}`, []);
      const moved = await stopAndMove(parent.taskId, body);
      const after = await state(parent);
      record(
        `workflow parent: without subtasks, ${label} stops the run and lands the card there`,
        moved.status === 200 &&
          moved.body?.executionCancelled === true &&
          moved.body.taskCancelled === (expected === 'cancelled') &&
          after.task === expected &&
          after.run === 'cancelled' &&
          show(
            after.activity.filter((line) => line.startsWith('status.changed')),
          ) === show([`status.changed:in_progress>${expected}`]),
        `door=${moved.status} ${show(moved.body)}, task=${after.task} run=${after.run} (want ${expected}, cancelled), activity=${show(after.activity)}`,
      );
    }

    // ---- the drop position rides the same write -----------------------------
    const above = await mkTask('Placement above', 'todo', null);
    const below = await mkTask('Placement below', 'todo', null);
    const [aboveRank] = await sql<{ rank: string }[]>`
      SELECT rank FROM app.tasks WHERE id = ${above}
    `;
    const [belowRank] = await sql<{ rank: string }[]>`
      SELECT rank FROM app.tasks WHERE id = ${below}
    `;
    const placed = await mkParent('Dropped between two cards', ['todo']);
    // The board names the card it lands after (`beforeTaskId`, the one
    // above it) and the one it lands before (`afterTaskId`).
    const placedMove = await stopAndMove(placed.taskId, {
      status: 'todo',
      beforeTaskId: above,
      afterTaskId: below,
    });
    const placedAfter = await state(placed);
    record(
      'workflow parent: a board drop keeps its position when the move stops the run',
      placedMove.status === 200 &&
        placedAfter.task === 'todo' &&
        placedAfter.run === 'cancelled' &&
        aboveRank !== undefined &&
        belowRank !== undefined &&
        placedAfter.rank > aboveRank.rank &&
        placedAfter.rank < belowRank.rank,
      `door=${placedMove.status}, task=${placedAfter.task} run=${placedAfter.run}, rank ${aboveRank?.rank} < ${placedAfter.rank} < ${belowRank?.rank} (want between its neighbours)`,
    );

    // ---- refused before any side effect ---------------------------------------
    const guarded = await mkParent('Refused requests', ['todo']);
    const guardedBefore = await state(guarded);
    const toInProgress = await stopAndMove(guarded.taskId, {
      status: 'in_progress',
    });
    const readOnly = await stopAndMove(
      guarded.taskId,
      { status: 'todo' },
      reader.cookie,
    );
    const guardedAfter = await state(guarded);
    record(
      'workflow parent: In progress as a destination and a read-only member are refused before the run is touched',
      toInProgress.status === 400 &&
        readOnly.status === 403 &&
        untouched(guardedBefore, guardedAfter) &&
        guardedAfter.run === 'waiting',
      `in_progress=${toInProgress.status} ${show(toInProgress.body)} (want 400), read-only=${readOnly.status} ${show(readOnly.body)} (want 403), state unchanged=${untouched(guardedBefore, guardedAfter)} run=${guardedAfter.run} (want waiting)`,
    );

    // ---- a run that already ended: the move alone --------------------------
    const idle = await mkParent('Run ended meanwhile', ['todo']);
    await sql.begin(async (fixtureTx) => {
      await markAutomationWriterInTx(fixtureTx);
      return fixtureTx`
      UPDATE app.automation_runs SET status = 'success',
        finished_at_ms = ${Date.now()}
      WHERE id = ${idle.runId}
    `;
    });
    const idleMove = await stopAndMove(idle.taskId, { status: 'todo' });
    const idleAfter = await state(idle);
    record(
      'workflow parent: when the run ended before the move, the card still lands in To do and nothing is cancelled',
      idleMove.status === 200 &&
        idleMove.body?.executionCancelled === false &&
        idleMove.body.executionId === null &&
        idleAfter.task === 'todo' &&
        idleAfter.run === 'success',
      `door=${idleMove.status} ${show(idleMove.body)} (want 200, nothing cancelled), task=${idleAfter.task} run=${idleAfter.run} (want todo, success)`,
    );

    // ---- a stop that lost the race: the drop still names its place ---------
    // Another session stopped the run and moved the task to To do while this
    // one confirmed: the task already sits there, and this drop's place
    // between two cards still applies, as a reorder with no status change.
    const raced = await mkParent('Stopped elsewhere meanwhile', ['todo']);
    const elsewhere = await stopAndMove(raced.taskId, { status: 'todo' });
    const racedBefore = await state(raced);
    const racedMove = await stopAndMove(raced.taskId, {
      status: 'todo',
      beforeTaskId: above,
      afterTaskId: below,
    });
    const racedAfter = await state(raced);
    record(
      'workflow parent: a stop that finds the task already moved there still places the card where it was dropped, as a reorder',
      elsewhere.status === 200 &&
        racedMove.status === 200 &&
        racedMove.body?.executionCancelled === false &&
        racedAfter.task === 'todo' &&
        aboveRank !== undefined &&
        belowRank !== undefined &&
        racedAfter.rank > aboveRank.rank &&
        racedAfter.rank < belowRank.rank &&
        show(racedAfter.activity) === show(racedBefore.activity),
      `first stop=${elsewhere.status}, second=${racedMove.status} ${show(racedMove.body)} (want 200, nothing left to cancel), task=${racedAfter.task}, rank ${aboveRank?.rank} < ${racedAfter.rank} < ${belowRank?.rank} (want between its neighbours), history unchanged=${show(racedAfter.activity) === show(racedBefore.activity)} (want true: a reorder is no status change)`,
    );
  } finally {
    await sql`
      DELETE FROM app.approvals
      WHERE org_id = ${orgId} AND resource_type = 'connector_operation'
        AND metadata ->> 'runId' IN (SELECT id FROM app.automation_runs
                                     WHERE project_id = ${projectId})
    `;
    // Cascades to the runs' questions.
    await sql.begin(async (fixtureTx) => {
      await markAutomationWriterInTx(fixtureTx);
      return fixtureTx`
      DELETE FROM app.automation_runs
      WHERE org_id = ${orgId} AND project_id = ${projectId}
    `;
    });
    // Cascades to its tasks and their history.
    await sql`DELETE FROM app.projects WHERE id = ${projectId}`;
  }
}
