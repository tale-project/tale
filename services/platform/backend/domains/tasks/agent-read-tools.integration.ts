/** Real Postgres proof of the read tools a manager agent reconciles a whole
 * project with (#3955), driven over the real workspace-tool door
 * (`POST /api/tools/execute`) with native session tokens for project agents'
 * live runs.
 *
 * `task_find` pages 260 tasks of one column, tied on rank and on their
 * creation millisecond, through signed cursors bound to their listing, in the
 * database's own order; a cursor from another filter, order or scope, and a
 * malformed one, are refused; what a move between pages does is shown for
 * both orders. `task_get` names subtasks, blockers and comments by id, pages
 * a discussion past its newest fifty and a run history newest-first on
 * `seq`, and tells live, finished and person-bound work apart without the
 * transcript or another project's rows. A manager's pass saves its cursor in
 * a checkpoint comment and a later run resumes from it, found beyond the
 * newest comments; the routine-question protocol's read half runs as
 * documented: a worker's question is an agent comment that starts nothing,
 * and the review and the native question stay a person's.
 *
 * Nothing here launches a sandbox: the runs are rows, and no read starts a
 * run. */
import { createHash, randomUUID } from 'node:crypto';

import type { Sql } from 'postgres';

import { memberSessionIdForProjectAgent } from '../../core/sandbox/session_naming.ts';
import { insertSessionToken } from '../sandbox/sessions.ts';
import { addTaskComment } from './comments.ts';

type Recorder = (name: string, ok: boolean, detail: string) => void;

interface LaneCtx {
  cookie: string;
  orgId: string;
  userId: string;
}

type Body = Record<string, unknown>;

function isRecord(value: unknown): value is Body {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const BUCKET_SIZE = 260;
const PAGE = 50;

export async function checkAgentTaskReadTools(
  sql: Sql,
  base: string,
  ctx: LaneCtx,
  record: Recorder,
): Promise<void> {
  const { orgId, userId } = ctx;
  const suffix = randomUUID().slice(0, 8);
  const now = Date.now();
  const projectA = randomUUID();
  const projectB = randomUUID();
  const manager = randomUUID();
  const worker = randomUUID();
  const outsider = randomUUID();
  const member = `itest-read-member-${suffix}`;
  const tokens: string[] = [];
  const sessionIds = new Set<string>();
  const discoveryApprovalIds: string[] = [];
  const ownerAuth = {
    organizationId: orgId,
    userId,
    role: 'owner',
    teamIds: [],
  };

  const insertTask = async (args: {
    projectId: string;
    title: string;
    status?: string;
    rank?: string;
    createdAt?: number;
    agentId?: string;
    parentTaskId?: string;
    archived?: boolean;
    createdBy?: string;
  }): Promise<string> => {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO app.tasks (org_id, project_id, title, status, rank,
        assignee_type, assignee_id, parent_task_id, created_by,
        created_by_type, created_at_ms, updated_at_ms, archived_at_ms)
      VALUES (${orgId}, ${args.projectId}, ${args.title},
        ${args.status ?? 'todo'}, ${args.rank ?? `z${suffix}`},
        ${args.agentId === undefined ? null : 'agent'}, ${args.agentId ?? null},
        ${args.parentTaskId ?? null}, ${args.createdBy ?? userId}, 'user',
        ${args.createdAt ?? now}, ${args.createdAt ?? now},
        ${args.archived === true ? now : null})
      RETURNING id
    `;
    return rows[0]?.id ?? '';
  };

  /** A run row of `agentId` on `taskId`, and — while it is live — a token
   * for its turn. */
  const agentRun = async (args: {
    agentId: string;
    projectId?: string;
    taskId: string;
    status: string;
    startedBy?: string;
    sessionId?: string;
    startedAt?: number;
    feedback?: string;
    failureCode?: string;
    grants?: string[];
  }): Promise<{ runId: string; token: string }> => {
    const execId = `exec-${randomUUID().slice(0, 12)}`;
    const sessionId = args.sessionId ?? `pa-${args.agentId}`;
    const startedAt = args.startedAt ?? Date.now();
    const terminal = !['queued', 'running'].includes(args.status);
    const rows = await sql<{ id: string }[]>`
      INSERT INTO app.project_agent_runs (
        org_id, project_id, task_id, agent_id, exec_id, session_id, status,
        harness, model, trigger, feedback, failure_code, error, result_text,
        started_by, started_at_ms, launched_at_ms, deadline_at_ms,
        settled_at_ms, updated_at_ms
      ) VALUES (
        ${orgId}, ${args.projectId ?? projectA}, ${args.taskId}, ${args.agentId}, ${execId},
        ${sessionId}, ${args.status}, 'claude-code', 'itest-model', 'manual',
        ${args.feedback ?? null}, ${args.failureCode ?? null},
        ${args.status === 'failed' ? 'itest: harness exploded with a secret-looking trace' : null},
        ${args.status === 'settled' ? 'itest: the full report the run produced' : null},
        ${args.startedBy ?? userId}, ${startedAt}, ${startedAt + 1000},
        ${startedAt + 3_600_000}, ${terminal ? startedAt + 60_000 : null},
        ${Date.now()}
      ) RETURNING id
    `;
    if (!sessionIds.has(sessionId)) {
      sessionIds.add(sessionId);
      await sql`
        INSERT INTO app.sandbox_sessions (org_id, session_id, status,
          owner_type, owner_id, created_by, created_at_ms, expires_at_ms)
        VALUES (${orgId}, ${sessionId}, 'active', 'project_agent',
          ${args.agentId}, 'itest:read-tools', ${now}, ${now + 3_600_000})
        ON CONFLICT DO NOTHING
      `;
    }
    const token = `itest-read-${randomUUID()}`;
    tokens.push(token);
    await insertSessionToken(sql, {
      organizationId: orgId,
      sessionId,
      tokenHash: createHash('sha256').update(token).digest('hex'),
      scope: {
        agentKind: 'claude-code',
        allowedModels: [],
        connectorGrants: [],
        budgetCents: 100,
        toolGrants: args.grants ?? ['task_find', 'task_get', 'task_comment'],
        taskRun: { execId },
      },
      ttlMs: 600_000,
    });
    return { runId: rows[0]?.id ?? '', token };
  };
  const settle = (runId: string) => sql`
    UPDATE app.project_agent_runs
    SET status = 'settled', settled_at_ms = ${Date.now()},
        updated_at_ms = ${Date.now()}
    WHERE id = ${runId}
  `;

  const dispatch = async (
    token: string,
    tool: string,
    args: Record<string, unknown>,
  ): Promise<Body> => {
    const res = await fetch(`${base}/api/tools/execute`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ tool, args }),
    });
    const body: unknown = await res.json().catch(() => null);
    return isRecord(body) ? body : { status: 'PARSE_ERROR' };
  };
  const out = (result: Body): Body =>
    isRecord(result.output) ? result.output : {};
  /** The records of the list at `key`, else none. */
  const listAt = (value: unknown, key: string): Body[] => {
    const inner = isRecord(value) ? value[key] : undefined;
    return Array.isArray(inner) ? inner.filter(isRecord) : [];
  };
  /** The record at `key`, else an empty one. */
  const recordAt = (value: unknown, key: string): Body => {
    const inner = isRecord(value) ? value[key] : undefined;
    return isRecord(inner) ? inner : {};
  };
  /** The string at `key`, else ''. */
  const textAt = (value: unknown, key: string): string => {
    const inner = isRecord(value) ? value[key] : undefined;
    return typeof inner === 'string' ? inner : '';
  };
  const idsOf = (result: Body): string[] => {
    const tasks = out(result).tasks;
    return Array.isArray(tasks)
      ? tasks.flatMap((task) =>
          isRecord(task) && typeof task.taskId === 'string'
            ? [task.taskId]
            : [],
        )
      : [];
  };
  /** Walk a listing to its end; `between` runs after each page but the
   * last, for the concurrent-change checks. */
  const walk = async (
    token: string,
    args: Record<string, unknown>,
    between?: (page: number) => Promise<void>,
  ): Promise<{ pages: Body[]; ids: string[]; ok: boolean }> => {
    const pages: Body[] = [];
    let cursor: unknown;
    let ok = true;
    for (let page = 0; page < 20; page++) {
      const result = await dispatch(token, 'task_find', {
        ...args,
        ...(cursor !== undefined ? { cursor } : {}),
      });
      if (result.status !== 'ok') {
        ok = false;
        pages.push(result);
        break;
      }
      pages.push(out(result));
      if (out(result).isDone === true) break;
      cursor = out(result).continueCursor;
      if (between !== undefined) await between(page);
    }
    return {
      pages,
      ids: pages.flatMap((page) =>
        Array.isArray(page.tasks)
          ? page.tasks.flatMap((task) =>
              isRecord(task) && typeof task.taskId === 'string'
                ? [task.taskId]
                : [],
            )
          : [],
      ),
      ok,
    };
  };
  const sameList = (a: readonly string[], b: readonly string[]) =>
    a.length === b.length && a.every((id, index) => id === b[index]);

  try {
    await sql`
      INSERT INTO "user" ("id", "name", "email", "emailVerified",
                          "createdAt", "updatedAt")
      VALUES (${member}, 'Itest read member', ${`${member}@example.com`}, true,
              ${new Date()}, ${new Date()})
    `;
    await sql`
      INSERT INTO "member" ("id", "organizationId", "userId", "role",
                            "createdAt")
      VALUES (${`m-${member}`}, ${orgId}, ${member}, 'member', ${new Date()})
    `;
    for (const [id, name] of [
      [projectA, `Fleet ${suffix}`],
      [projectB, `Neighbour ${suffix}`],
    ] as const) {
      await sql`
        INSERT INTO app.projects (id, org_id, name, created_by,
                                  created_at_ms, updated_at_ms)
        VALUES (${id}, ${orgId}, ${name}, ${userId}, ${now}, ${now})
      `;
    }
    for (const [id, projectId, name] of [
      [manager, projectA, 'Fleet manager'],
      [worker, projectA, 'Implementer'],
      [outsider, projectB, 'Neighbour agent'],
    ] as const) {
      await sql`
        INSERT INTO app.project_agents (id, org_id, project_id, name, harness,
                                        model, created_by, created_at_ms,
                                        updated_at_ms)
        VALUES (${id}, ${orgId}, ${projectId}, ${name}, 'claude-code',
                'itest-model', ${userId}, ${now}, ${now})
      `;
    }

    // ---- the queue ---------------------------------------------------------
    // One column of 260 tasks tied on rank AND on the creation millisecond:
    // only their ids order them, in whatever collation the database uses.
    const tiedAt = now - 3_600_000;
    await sql`
      INSERT INTO app.tasks (org_id, project_id, title, status, rank,
        created_by, created_by_type, created_at_ms, updated_at_ms)
      SELECT ${orgId}, ${projectA}, 'Bucket ' || n, 'backlog', ${`t${suffix}`},
             ${userId}, 'user', ${tiedAt}, ${tiedAt}
      FROM generate_series(1, ${BUCKET_SIZE}) AS n
    `;
    const roleTask = await insertTask({
      projectId: projectA,
      title: 'Autonomous cycle — Fleet manager',
      agentId: manager,
    });
    const questionTask = await insertTask({
      projectId: projectA,
      title: 'Implement the retry budget',
      status: 'in_progress',
      agentId: worker,
    });
    const liveTask = await insertTask({
      projectId: projectA,
      title: 'Being worked right now',
      status: 'in_progress',
      agentId: worker,
    });
    const historyTask = await insertTask({
      projectId: projectA,
      title: 'Retried many times',
      status: 'in_progress',
    });
    const parentTask = await insertTask({
      projectId: projectA,
      title: 'Parent with subtasks',
    });
    const subA = await insertTask({
      projectId: projectA,
      title: 'Subtask one',
      parentTaskId: parentTask,
    });
    const subB = await insertTask({
      projectId: projectA,
      title: 'Subtask two',
      parentTaskId: parentTask,
      status: 'done',
    });
    const blocker = await insertTask({
      projectId: projectA,
      title: 'Prerequisite',
      status: 'in_progress',
    });
    const askTask = await insertTask({
      projectId: projectA,
      title: 'Waits on an operator',
      status: 'in_progress',
    });
    const approvalTask = await insertTask({
      projectId: projectA,
      title: 'Waits on an approval',
      status: 'in_progress',
    });
    const memberTask = await insertTask({
      projectId: projectA,
      title: 'A member’s own task',
      status: 'in_progress',
      agentId: worker,
      createdBy: member,
    });
    for (const title of ['Retired one', 'Retired two']) {
      await insertTask({
        projectId: projectA,
        title,
        status: 'backlog',
        archived: true,
      });
    }
    const foreignTitle = `Neighbour secret ${suffix}`;
    const foreignTasks: string[] = [];
    for (let index = 0; index < 3; index++) {
      foreignTasks.push(
        await insertTask({
          projectId: projectB,
          title: `${foreignTitle} ${index}`,
          status: 'backlog',
          rank: `t${suffix}`,
          createdAt: tiedAt,
        }),
      );
    }
    const foreignTask = foreignTasks[0] ?? '';
    for (const blockerId of [blocker, foreignTask]) {
      // The second edge crosses projects, which the writer refuses — put in
      // by hand, it must still never show a neighbour's task.
      await sql`
        INSERT INTO app.task_dependencies (org_id, project_id,
          blocker_task_id, blocked_task_id, created_by, created_by_type,
          created_at_ms)
        VALUES (${orgId}, ${projectA}, ${blockerId}, ${parentTask},
                ${userId}, 'user', ${now})
      `;
    }

    const boardOrder = async (filter: 'backlog' | 'all') =>
      (
        await sql<{ id: string }[]>`
          SELECT id FROM app.tasks
          WHERE project_id = ${projectA} AND archived_at_ms IS NULL
            AND (${filter === 'all'} OR status = 'backlog')
          ORDER BY status, rank, id
        `
      ).map((row) => row.id);
    const createdOrder = async () =>
      (
        await sql<{ id: string }[]>`
          SELECT id FROM app.tasks
          WHERE project_id = ${projectA} AND archived_at_ms IS NULL
          ORDER BY created_at_ms, id
        `
      ).map((row) => row.id);

    // The manager's live run on its standing role task.
    const managerRun = await agentRun({
      agentId: manager,
      taskId: roleTask,
      status: 'running',
      grants: [
        'task_find',
        'task_get',
        'task_comment',
        'task_update_status',
        'ask_human',
      ],
    });
    const m1 = managerRun.token;

    // ==== task_find: the whole column, page by page ========================
    const expectedBucket = await boardOrder('backlog');
    const bucketWalk = await walk(m1, { status: 'backlog', limit: PAGE });
    const bucketPages = bucketWalk.pages;
    record(
      'read tools: task_find walks a column of 260 tasks tied on rank and creation time in pages of 50 — each once, in the database’s own (status, rank, id) order',
      bucketWalk.ok &&
        expectedBucket.length === BUCKET_SIZE &&
        sameList(bucketWalk.ids, expectedBucket) &&
        new Set(bucketWalk.ids).size === BUCKET_SIZE &&
        bucketPages.length === 6 &&
        bucketPages
          .slice(0, -1)
          .every(
            (page) =>
              page.isDone === false &&
              typeof page.continueCursor === 'string' &&
              !('totalFound' in page),
          ) &&
        bucketPages.at(-1)?.isDone === true &&
        !('continueCursor' in (bucketPages.at(-1) ?? {})) &&
        !('totalFound' in (bucketPages.at(-1) ?? {})),
      `pages=${bucketPages.map((page) => (Array.isArray(page.tasks) ? page.tasks.length : `!${String(page.status)}`)).join(',')} ids=${bucketWalk.ids.length} unique=${new Set(bucketWalk.ids).size} expected=${expectedBucket.length} sameOrder=${sameList(bucketWalk.ids, expectedBucket)}`,
    );
    const again = await walk(m1, { status: 'backlog', limit: PAGE });
    record(
      'read tools: the same walk twice gives the same order — ties never reshuffle between reads',
      sameList(again.ids, bucketWalk.ids),
      `first=${bucketWalk.ids.slice(0, 3).join(',')} second=${again.ids.slice(0, 3).join(',')}`,
    );

    const expectedCreated = await createdOrder();
    const createdWalk = await walk(m1, { order: 'created', limit: PAGE });
    record(
      'read tools: task_find in created order walks the whole project oldest first on (created_at, id), each task once, never a neighbour’s or an archived one',
      createdWalk.ok &&
        sameList(createdWalk.ids, expectedCreated) &&
        !createdWalk.ids.some((id) => foreignTasks.includes(id)),
      `ids=${createdWalk.ids.length} expected=${expectedCreated.length} sameOrder=${sameList(createdWalk.ids, expectedCreated)}`,
    );

    const todo = await dispatch(m1, 'task_find', { status: 'todo', limit: 50 });
    const todoCount = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM app.tasks
      WHERE project_id = ${projectA} AND status = 'todo'
        AND archived_at_ms IS NULL
    `;
    const archivedWalk = await walk(m1, {
      status: 'backlog',
      includeArchived: true,
      limit: PAGE,
    });
    record(
      'read tools: a listing one page holds names its total; a paged one never does, and archived tasks come only when asked for',
      out(todo).isDone === true &&
        out(todo).totalFound === todoCount[0]?.n &&
        idsOf(todo).length === todoCount[0]?.n &&
        !('totalFound' in out(bucketPages[0] ?? {})) &&
        archivedWalk.ids.length === BUCKET_SIZE + 2,
      `todo=${JSON.stringify({ isDone: out(todo).isDone, totalFound: out(todo).totalFound, n: todoCount[0]?.n })} archivedWalk=${archivedWalk.ids.length}`,
    );

    // ==== cursors: bound to their listing ==================================
    const cursor = textAt(bucketPages[0], 'continueCursor');
    const outsiderRun = await agentRun({
      agentId: outsider,
      projectId: projectB,
      taskId: foreignTask,
      status: 'running',
    });
    // A valid neighbour run must carry its own project. A stale/malformed
    // run identity is refused before the read tool sees any cursor or task.
    let mismatchedProject: Body;
    await sql`UPDATE app.project_agent_runs SET project_id = ${projectA}
      WHERE id = ${outsiderRun.runId}`;
    try {
      mismatchedProject = await dispatch(outsiderRun.token, 'task_find', {
        limit: PAGE,
      });
    } finally {
      await sql`UPDATE app.project_agent_runs SET project_id = ${projectB}
        WHERE id = ${outsiderRun.runId}`;
    }
    const restoredProject = await dispatch(outsiderRun.token, 'task_find', {
      limit: PAGE,
    });
    record(
      'read tools: a mismatched live run project is refused; its coherent identity restores only its own project reads',
      mismatchedProject.status === 'unavailable' &&
        listAt(mismatchedProject, 'blockers').some(
          (runBlocker) => runBlocker.code === 'run_ended',
        ) &&
        restoredProject.status === 'ok' &&
        sameList([...idsOf(restoredProject)].sort(), [...foreignTasks].sort()),
      `mismatch=${String(mismatchedProject.status)} restored=${String(restoredProject.status)}/${idsOf(restoredProject).length}`,
    );
    const mismatches = await Promise.all([
      dispatch(m1, 'task_find', { status: 'todo', cursor }),
      dispatch(m1, 'task_find', {
        status: 'backlog',
        order: 'created',
        cursor,
      }),
      dispatch(m1, 'task_find', {
        status: 'backlog',
        includeArchived: true,
        cursor,
      }),
      dispatch(m1, 'task_find', { cursor }),
      // Another project's run, with the same filters.
      dispatch(outsiderRun.token, 'task_find', { status: 'backlog', cursor }),
    ]);
    const foreignProject = await dispatch(m1, 'task_find', {
      status: 'backlog',
      projectId: projectB,
      cursor,
    });
    record(
      'read tools: a cursor passed with another filter, order or scope — another project’s run included — is refused, never read as a first page',
      mismatches.every(
        (result) =>
          result.status === 'invalid_args' &&
          String(result.message).includes('"cursor" is not a cursor'),
      ) && foreignProject.status === 'invalid_args',
      JSON.stringify(mismatches.map((result) => result.status)) +
        ` foreignProject=${String(foreignProject.status)}`,
    );
    const dot = cursor.lastIndexOf('.');
    const position = cursor.slice(0, dot);
    const tag = cursor.slice(dot + 1);
    const malformed = await Promise.all(
      [
        'garbage',
        cursor.slice(0, -2),
        `${position.slice(0, -1)}${position.endsWith('A') ? 'B' : 'A'}.${tag}`,
        position,
        `${position}.${tag.slice(1)}x`,
        12,
        { cursor },
      ].map((bad) =>
        dispatch(m1, 'task_find', { status: 'backlog', cursor: bad }),
      ),
    );
    const resumed = await dispatch(m1, 'task_find', {
      status: 'backlog',
      limit: PAGE,
      cursor,
    });
    record(
      'read tools: a malformed, truncated or edited cursor is refused with invalid_args, and the unchanged one still resumes after page one',
      malformed.every((result) => result.status === 'invalid_args') &&
        sameList(idsOf(resumed), expectedBucket.slice(PAGE, 2 * PAGE)),
      JSON.stringify(malformed.map((result) => result.status)) +
        ` resumed=${idsOf(resumed).length}`,
    );

    // ==== what a move between pages does ===================================
    // Created order: a task keeps its place, so it is listed at most once.
    const createdIds = await createdOrder();
    const movedEarly = createdIds[3] ?? '';
    const movedLate = createdIds[180] ?? '';
    const archivedLate = createdIds[181] ?? '';
    let createdDuring = '';
    const changing = await walk(
      m1,
      { order: 'created', limit: PAGE },
      async (page) => {
        if (page !== 0) return;
        await sql`UPDATE app.tasks SET status = 'todo' WHERE id = ${movedEarly}`;
        await sql`UPDATE app.tasks SET status = 'in_review' WHERE id = ${movedLate}`;
        await sql`UPDATE app.tasks SET archived_at_ms = ${Date.now()} WHERE id = ${archivedLate}`;
        createdDuring = await insertTask({
          projectId: projectA,
          title: 'Filed during the pass',
          createdAt: Date.now() + 1000,
        });
      },
    );
    const lateView = changing.pages
      .flatMap((page) => (Array.isArray(page.tasks) ? page.tasks : []))
      .find((task) => isRecord(task) && task.taskId === movedLate);
    const counts = new Map<string, number>();
    for (const id of changing.ids) counts.set(id, (counts.get(id) ?? 0) + 1);
    record(
      'read tools: in created order a pass lists each task at most once while the board moves — a moved task once, in its new state; an archived one not; a new one at the end',
      changing.ok &&
        [...counts.values()].every((n) => n === 1) &&
        counts.get(movedEarly) === 1 &&
        counts.get(movedLate) === 1 &&
        isRecord(lateView) &&
        lateView.status === 'in_review' &&
        !counts.has(archivedLate) &&
        changing.ids.at(-1) === createdDuring,
      `listed=${changing.ids.length} dupes=${[...counts.values()].filter((n) => n > 1).length} late=${JSON.stringify(lateView)} archived=${counts.has(archivedLate)} last=${changing.ids.at(-1) === createdDuring}`,
    );
    await sql`UPDATE app.tasks SET status = 'backlog' WHERE id = ANY(${[movedEarly, movedLate]})`;
    await sql`UPDATE app.tasks SET archived_at_ms = NULL WHERE id = ${archivedLate}`;
    await sql`DELETE FROM app.tasks WHERE id = ${createdDuring}`;

    // Board order: a task that moves between pages can be listed twice, or
    // skipped — the documented reason to walk a queue in created order.
    const boardIds = await boardOrder('all');
    const returnedEarly = boardIds[2] ?? '';
    const aheadButMovedBack = boardIds[120] ?? '';
    const board = await walk(m1, { limit: PAGE }, async (page) => {
      if (page !== 0) return;
      await sql`UPDATE app.tasks SET status = 'todo' WHERE id = ${returnedEarly}`;
      await sql`UPDATE app.tasks SET rank = '0' WHERE id = ${aheadButMovedBack}`;
    });
    const boardCounts = new Map<string, number>();
    for (const id of board.ids) {
      boardCounts.set(id, (boardCounts.get(id) ?? 0) + 1);
    }
    record(
      'read tools: in board order a task moved forward past the cursor is listed again, and one moved behind it is not listed in that pass',
      board.ok &&
        boardCounts.get(returnedEarly) === 2 &&
        !boardCounts.has(aheadButMovedBack),
      `returnedEarly=${boardCounts.get(returnedEarly) ?? 0} movedBack=${boardCounts.get(aheadButMovedBack) ?? 0}`,
    );
    await sql`UPDATE app.tasks SET status = 'backlog' WHERE id = ${returnedEarly}`;
    await sql`UPDATE app.tasks SET rank = ${`t${suffix}`} WHERE id = ${aheadButMovedBack}`;

    // ==== task_get: ids, the discussion beyond fifty, runs =================
    const workerRun = await agentRun({
      agentId: worker,
      taskId: questionTask,
      status: 'running',
      grants: ['task_comment', 'task_get'],
    });
    const runsBefore = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM app.project_agent_runs
      WHERE project_id = ${projectA}
    `;
    const questionBody =
      `Routine question (key q-${suffix}, source run ${workerRun.runId}): ` +
      `should the retry budget stay per task? @${manager} ` +
      'Evidence: backend/core/tasks/task_auto_retry.ts.';
    const asked = await dispatch(workerRun.token, 'task_comment', {
      taskId: questionTask,
      body: questionBody,
    });
    const questionId = textAt(out(asked), 'messageId');
    await settle(workerRun.runId);
    const runsAfter = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM app.project_agent_runs
      WHERE project_id = ${projectA}
    `;
    const kicks = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pgboss.job
      WHERE name IN ('task.agent_turn', 'task.agent_steer', 'task.start_workflow')
        AND (data ->> 'taskId' = ${questionTask}
             OR data ->> 'runId' IN (SELECT id FROM app.project_agent_runs
                                     WHERE task_id = ${questionTask}))
    `;
    record(
      'read tools: a worker’s routine question is an agent comment that starts nothing — its @mention of the manager stays inert',
      asked.status === 'ok' &&
        questionId !== '' &&
        runsAfter[0]?.n === runsBefore[0]?.n &&
        kicks[0]?.n === 0,
      `asked=${JSON.stringify(asked)} runs=${runsBefore[0]?.n}->${runsAfter[0]?.n} kicks=${kicks[0]?.n}`,
    );
    // The run parked its result for review, as a settle does.
    await sql`UPDATE app.tasks SET status = 'in_review' WHERE id = ${questionTask}`;
    const review = await sql<{ id: string }[]>`
      INSERT INTO app.approvals (org_id, resource_type, resource_id, status,
                                 metadata, created_at_ms)
      VALUES (${orgId}, 'task_review', ${questionTask}, 'pending',
              ${sql.json({
                taskId: questionTask,
                projectId: projectA,
                agentSlug: worker,
                requestedFor: userId,
                round: 1,
                runId: workerRun.runId,
              })}, ${Date.now()})
      RETURNING id
    `;
    const reviewId = review[0]?.id ?? '';
    // A person keeps talking on the task: 55 comments after the question.
    for (let index = 0; index < 55; index++) {
      await sql.begin((tx) =>
        addTaskComment(tx, ownerAuth, {
          taskId: questionTask,
          body: `Progress note ${index + 1}`,
        }),
      );
    }

    const newest = await dispatch(m1, 'task_get', {
      taskId: questionTask,
      commentLimit: 50,
    });
    const newestComments = listAt(out(newest), 'comments');
    const commentsPage = recordAt(out(newest), 'commentsPage');
    const older = await dispatch(m1, 'task_get', {
      taskId: questionTask,
      commentLimit: 50,
      commentCursor: commentsPage.continueCursor,
    });
    const olderComments = listAt(out(older), 'comments');
    const question = olderComments.find(
      (comment) => comment.commentId === questionId,
    );
    record(
      'read tools: task_get pages a discussion past its newest 50 — the question is found on the next page by the id task_comment answered, with its author and an ISO date',
      newest.status === 'ok' &&
        newestComments.length === 50 &&
        !newestComments.some((comment) => comment.commentId === questionId) &&
        commentsPage.isDone === false &&
        older.status === 'ok' &&
        olderComments.length === 6 &&
        recordAt(out(older), 'commentsPage').isDone === true &&
        question !== undefined &&
        question.authorType === 'agent' &&
        question.authorId === worker &&
        question.body === questionBody &&
        typeof question.createdAt === 'string' &&
        !Number.isNaN(Date.parse(textAt(question, 'createdAt'))),
      `newest=${newestComments.length} page=${JSON.stringify({ isDone: commentsPage.isDone })} older=${olderComments.length} question=${JSON.stringify(question)}`,
    );
    const otherTaskCursor = await dispatch(m1, 'task_get', {
      taskId: liveTask,
      commentCursor: commentsPage.continueCursor,
    });
    record(
      'read tools: a comment cursor pages only the task that answered it',
      otherTaskCursor.status === 'invalid_args',
      JSON.stringify(otherTaskCursor),
    );

    const view = out(newest);
    const runs = listAt(view, 'agentRuns');
    const pendingReview = isRecord(view.pendingReview)
      ? view.pendingReview
      : {};
    record(
      'read tools: the finished run that asked is terminal, and the review it parked waits on a person',
      runs[0]?.runId === workerRun.runId &&
        runs[0]?.status === 'settled' &&
        runs[0]?.live === false &&
        typeof runs[0]?.settledAt === 'string' &&
        view.workflowRun === null &&
        pendingReview.approvalId === reviewId &&
        pendingReview.runId === workerRun.runId,
      `runs=${JSON.stringify(runs)} review=${JSON.stringify(pendingReview)}`,
    );

    // ---- live, terminal and human-required work ----------------------------
    const liveRun = await agentRun({
      agentId: worker,
      taskId: liveTask,
      status: 'running',
      feedback: `Answer a-1 to q-0: ${'keep going '.repeat(80)}`,
    });
    const liveView = out(await dispatch(m1, 'task_get', { taskId: liveTask }));
    const liveRuns = listAt(liveView, 'agentRuns');
    const hidden = [
      'error',
      'resultText',
      'execId',
      'sessionId',
      'agentSessionId',
      'model',
      'harness',
      'startedBy',
    ];
    record(
      'read tools: a running run reads as live, with a bounded excerpt of its start message and none of its transcript or workspace',
      liveRuns.length === 1 &&
        liveRuns[0]?.runId === liveRun.runId &&
        liveRuns[0]?.live === true &&
        liveRuns[0]?.status === 'running' &&
        !('settledAt' in (liveRuns[0] ?? {})) &&
        textAt(liveRuns[0], 'feedback').length === 500 &&
        liveRuns[0]?.feedbackTruncated === true &&
        hidden.every((key) => !(key in (liveRuns[0] ?? {}))),
      JSON.stringify(liveRuns[0] ?? null).slice(0, 400),
    );

    // Seven runs whose clocks run backwards against their creation order:
    // newest first means newest CREATED, and the page continues on seq.
    const history: string[] = [];
    for (let index = 0; index < 7; index++) {
      const created = await agentRun({
        agentId: worker,
        taskId: historyTask,
        status: index === 6 ? 'failed' : 'settled',
        startedAt: now - index * 60_000,
        ...(index === 6 ? { failureCode: 'harness_error' } : {}),
      });
      history.unshift(created.runId);
    }
    const firstRuns = await dispatch(m1, 'task_get', {
      taskId: historyTask,
      runLimit: 5,
    });
    const runsPage = recordAt(out(firstRuns), 'agentRunsPage');
    const restRuns = await dispatch(m1, 'task_get', {
      taskId: historyTask,
      runLimit: 5,
      runCursor: runsPage.continueCursor,
    });
    const runIds = (result: Body) =>
      listAt(out(result), 'agentRuns').map((run) => textAt(run, 'runId'));
    const newestRun = listAt(out(firstRuns), 'agentRuns')[0];
    record(
      'read tools: the run history is newest created first — whatever the clocks say — and pages on with runCursor to its end',
      sameList([...runIds(firstRuns), ...runIds(restRuns)], history) &&
        runsPage.isDone === false &&
        recordAt(out(restRuns), 'agentRunsPage').isDone === true &&
        newestRun?.status === 'failed' &&
        newestRun.failureCode === 'harness_error' &&
        !('error' in newestRun),
      `first=${runIds(firstRuns).join(',')} rest=${runIds(restRuns).join(',')} expected=${history.join(',')} newest=${JSON.stringify(newestRun)}`,
    );

    // An automation run waiting on a native question, and one on an approval.
    const workflowRun = async (
      taskId: string,
      projectId: string,
      detail: string,
    ): Promise<string> => {
      const rows = await sql<{ id: string }[]>`
        INSERT INTO app.automation_runs (org_id, project_id, name, version,
          status, mode, started_by, input, detail, started_at_ms)
        VALUES (${orgId}, ${projectId}, ${`itest/read-${suffix}`}, 1,
          'waiting', 'live', ${userId}, ${sql.json({ task: { id: taskId } })},
          ${detail}, ${Date.now()})
        RETURNING id
      `;
      return rows[0]?.id ?? '';
    };
    const askRun = await workflowRun(askTask, projectA, 'agent:triage');
    const ask = await sql<{ id: string }[]>`
      INSERT INTO app.automation_human_asks (org_id, run_id, node_id,
        session_id, exec_id, question, status, expires_at_ms, task_id,
        created_at_ms)
      VALUES (${orgId}, ${askRun}, 'triage', ${`wf-${suffix}`}, 'exec-ask',
        'Which ledger account applies?', 'pending', ${Date.now() + 86_400_000},
        ${askTask}, ${Date.now()})
      RETURNING id
    `;
    const approvalRun = await workflowRun(
      approvalTask,
      projectA,
      'approval:itest-approval',
    );
    // A run of ANOTHER project naming this project's task as its subject is
    // not this task's run.
    await workflowRun(liveTask, projectB, 'approval:foreign');
    const askView = out(await dispatch(m1, 'task_get', { taskId: askTask }));
    const approvalView = out(
      await dispatch(m1, 'task_get', { taskId: approvalTask }),
    );
    const liveAgain = out(await dispatch(m1, 'task_get', { taskId: liveTask }));
    const askRunView = isRecord(askView.workflowRun) ? askView.workflowRun : {};
    const askInfo = isRecord(askRunView.ask) ? askRunView.ask : {};
    const approvalRunView = isRecord(approvalView.workflowRun)
      ? approvalView.workflowRun
      : {};
    record(
      'read tools: an automation run waiting on a native question or an approval reads as live and names what a person must do; another project’s run on the task is not its run',
      askRunView.runId === askRun &&
        askRunView.live === true &&
        askRunView.waitingFor === 'ask' &&
        askInfo.askId === ask[0]?.id &&
        !('question' in askInfo) &&
        approvalRunView.runId === approvalRun &&
        approvalRunView.waitingFor === 'approval' &&
        approvalRunView.approvalId === 'itest-approval' &&
        liveAgain.workflowRun === null,
      `ask=${JSON.stringify(askRunView)} approval=${JSON.stringify(approvalRunView)} liveTaskWorkflow=${JSON.stringify(liveAgain.workflowRun)}`,
    );

    // ---- ids for subtasks and blockers, and nothing of a neighbour's ------
    const parentView = await dispatch(m1, 'task_get', { taskId: parentTask });
    const subtaskIds = listAt(out(parentView), 'subtasks').map((row) =>
      textAt(row, 'taskId'),
    );
    const blockerIds = listAt(out(parentView), 'blockedBy').map((row) =>
      textAt(row, 'taskId'),
    );
    record(
      'read tools: task_get names subtasks and blockers by id, and never another project’s task — not even through a dependency put in by hand',
      parentView.status === 'ok' &&
        sameList([...subtaskIds].sort(), [subA, subB].sort()) &&
        sameList(blockerIds, [blocker]) &&
        !JSON.stringify(parentView).includes(foreignTitle),
      `subtasks=${JSON.stringify(subtaskIds)} blockers=${JSON.stringify(blockerIds)}`,
    );

    // ---- refused reads ------------------------------------------------------
    const foreignRead = await dispatch(m1, 'task_get', { taskId: foreignTask });
    const missingRead = await dispatch(m1, 'task_get', {
      taskId: randomUUID(),
    });
    const memberSession = memberSessionIdForProjectAgent(worker, member);
    const memberRun = await agentRun({
      agentId: worker,
      taskId: memberTask,
      status: 'running',
      startedBy: member,
      sessionId: memberSession,
    });
    const memberFind = await walk(memberRun.token, {
      status: 'backlog',
      limit: PAGE,
    });
    const memberGet = await dispatch(memberRun.token, 'task_get', {
      taskId: questionTask,
    });
    const memberForeign = await dispatch(memberRun.token, 'task_get', {
      taskId: foreignTask,
    });
    const outsiderFind = await walk(outsiderRun.token, { limit: PAGE });
    record(
      'read tools: another project’s task reads exactly as a missing one; a member’s confined run still reads its project, never beyond it; a neighbour’s run lists only its own',
      foreignRead.status === 'not_found' &&
        JSON.stringify(foreignRead) === JSON.stringify(missingRead) &&
        memberFind.ok &&
        sameList(memberFind.ids, expectedBucket) &&
        memberGet.status === 'ok' &&
        memberForeign.status === 'not_found' &&
        outsiderFind.ok &&
        sameList([...outsiderFind.ids].sort(), [...foreignTasks].sort()),
      `foreign=${JSON.stringify(foreignRead)} member=${memberFind.ids.length}/${String(memberGet.status)}/${String(memberForeign.status)} outsider=${outsiderFind.ids.length}`,
    );

    // ---- what stays a person's ---------------------------------------------
    // The answer names the task's own agent while nothing runs on the task:
    // the case in which a person's @mention starts a rework run.
    const answerBody =
      `Answer (to comment ${questionId}, question q-${suffix}, source run ` +
      `${workerRun.runId}): @${worker} yes, keep the budget per task.`;
    const countRuns = async () =>
      (
        await sql<{ n: number }[]>`
          SELECT count(*)::int AS n FROM app.project_agent_runs
          WHERE task_id = ${questionTask}
        `
      )[0]?.n ?? -1;
    const countKicks = async () =>
      (
        await sql<{ n: number }[]>`
          SELECT count(*)::int AS n FROM pgboss.job
          WHERE name IN ('task.agent_turn', 'task.agent_steer',
                         'task.start_workflow')
            AND (data ->> 'taskId' = ${questionTask}
                 OR data ->> 'runId' IN (SELECT id FROM app.project_agent_runs
                                         WHERE task_id = ${questionTask}))
        `
      )[0]?.n ?? -1;
    const runsBeforeAnswer = await countRuns();
    const answered = await dispatch(m1, 'task_comment', {
      taskId: questionTask,
      body: answerBody,
    });
    const answerId = textAt(out(answered), 'messageId');
    const runsAfterAnswer = await countRuns();
    const kicksAfterAnswer = await countKicks();
    const assignee = await sql<{ assigneeId: string | null }[]>`
      SELECT assignee_id AS "assigneeId" FROM app.tasks WHERE id = ${questionTask}
    `;
    record(
      'read tools: an agent’s comment that @mentions the task’s own idle agent starts nothing — a manager restarts work only through its start tool',
      answered.status === 'ok' &&
        runsAfterAnswer === runsBeforeAnswer &&
        kicksAfterAnswer === 0 &&
        assignee[0]?.assigneeId === worker,
      `runs=${runsBeforeAnswer}->${runsAfterAnswer} kicks=${kicksAfterAnswer} assignee=${String(assignee[0]?.assigneeId)}`,
    );
    const completing = await dispatch(m1, 'task_update_status', {
      taskId: questionTask,
      status: 'done',
    });
    const asking = await dispatch(m1, 'ask_human', {
      question: 'May I approve this review?',
    });
    const reviewRow = await sql<{ status: string }[]>`
      SELECT status FROM app.approvals WHERE id = ${reviewId}
    `;
    const taskRow = await sql<{ status: string }[]>`
      SELECT status FROM app.tasks WHERE id = ${questionTask}
    `;
    const readback = out(
      await dispatch(m1, 'task_get', { taskId: questionTask, commentLimit: 3 }),
    );
    const readbackComments = listAt(readback, 'comments');
    const answerComment = readbackComments.find(
      (comment) => comment.commentId === answerId,
    );
    const blockers = listAt(completing, 'blockers');
    record(
      'read tools: the manager’s answer reads back as its own comment and starts nothing, while the review stays pending, the card stays in review, and a native question is not the manager’s to ask or answer',
      answered.status === 'ok' &&
        answerComment?.authorType === 'agent' &&
        answerComment.authorId === manager &&
        answerComment.body === answerBody &&
        completing.status === 'unavailable' &&
        blockers[0]?.code === 'AGENTS_CANNOT_COMPLETE' &&
        asking.status === 'unavailable' &&
        reviewRow[0]?.status === 'pending' &&
        taskRow[0]?.status === 'in_review' &&
        isRecord(readback.pendingReview) &&
        readback.pendingReview.approvalId === reviewId &&
        listAt(readback, 'agentRuns')[0]?.runId === workerRun.runId,
      `answer=${JSON.stringify(answerComment)} done=${JSON.stringify(completing)} ask=${String(asking.status)} review=${reviewRow[0]?.status} task=${taskRow[0]?.status}`,
    );

    // ==== a pass that outlives its run =====================================
    const passId = `pass-${suffix}`;
    const expectedPass = await createdOrder();
    const firstLeg: string[] = [];
    let legCursor: unknown;
    for (let page = 0; page < 2; page++) {
      const result = await dispatch(m1, 'task_find', {
        order: 'created',
        limit: PAGE,
        ...(legCursor !== undefined ? { cursor: legCursor } : {}),
      });
      firstLeg.push(...idsOf(result));
      legCursor = out(result).continueCursor;
    }
    const checkpoint = {
      kind: 'fleet-checkpoint',
      pass: passId,
      scope: { projectId: projectA },
      order: 'created',
      cursor: legCursor,
      lastTaskId: firstLeg.at(-1),
      dispatched: [],
      questions: [questionId],
    };
    const saved = await dispatch(m1, 'task_comment', {
      taskId: roleTask,
      body: `Fleet checkpoint\n\n\`\`\`json\n${JSON.stringify(checkpoint)}\n\`\`\``,
    });
    const checkpointId = textAt(out(saved), 'messageId');
    for (let index = 0; index < 55; index++) {
      await sql.begin((tx) =>
        addTaskComment(tx, ownerAuth, {
          taskId: roleTask,
          body: `Occurrence note ${index + 1}`,
        }),
      );
    }
    await settle(managerRun.runId);
    const ended = await dispatch(m1, 'task_find', { order: 'created' });
    const endedBlockers = listAt(ended, 'blockers');

    // The next occurrence: a new run with only the board to go on.
    const nextRun = await agentRun({
      agentId: manager,
      taskId: roleTask,
      status: 'running',
    });
    const m2 = nextRun.token;
    let found: Body | undefined;
    let foundOnPage = 0;
    let pageCursor: unknown;
    for (let page = 1; page <= 5 && found === undefined; page++) {
      const result = await dispatch(m2, 'task_get', {
        taskId: roleTask,
        commentLimit: 50,
        ...(pageCursor !== undefined ? { commentCursor: pageCursor } : {}),
      });
      const comments = listAt(out(result), 'comments');
      found = [...comments]
        .reverse()
        .find(
          (comment) =>
            comment.authorType === 'agent' &&
            comment.authorId === manager &&
            textAt(comment, 'body').startsWith('Fleet checkpoint'),
        );
      foundOnPage = page;
      const pageInfo = recordAt(out(result), 'commentsPage');
      if (pageInfo.isDone === true) break;
      pageCursor = pageInfo.continueCursor;
    }
    const json = textAt(found, 'body').match(/```json\n([\s\S]*?)\n```/);
    const restored: unknown = JSON.parse(json?.[1] ?? 'null');
    const restoredCursor = isRecord(restored) ? restored.cursor : undefined;
    const secondLeg = await walk(m2, {
      order: 'created',
      limit: PAGE,
      cursor: restoredCursor,
    });
    const wholePass = [...firstLeg, ...secondLeg.ids];
    record(
      'read tools: a later run resumes a pass from the checkpoint its predecessor saved — found past the newest 50 comments by its id and author, the cursor still valid — and the two legs list every task exactly once',
      saved.status === 'ok' &&
        ended.status === 'unavailable' &&
        endedBlockers[0]?.code === 'run_ended' &&
        found?.commentId === checkpointId &&
        foundOnPage === 2 &&
        isRecord(restored) &&
        restored.pass === passId &&
        secondLeg.ok &&
        sameList(wholePass, expectedPass) &&
        new Set(wholePass).size === wholePass.length,
      `found=${String(found?.commentId)}@page${foundOnPage} ended=${JSON.stringify(ended)} legs=${firstLeg.length}+${secondLeg.ids.length} expected=${expectedPass.length}`,
    );

    // After the pass says it is done, the next pass starts over at page one.
    const endCheckpoint = await dispatch(m2, 'task_comment', {
      taskId: roleTask,
      body: `Fleet checkpoint\n\n\`\`\`json\n${JSON.stringify({ kind: 'fleet-checkpoint', pass: passId, end: true })}\n\`\`\``,
    });
    const fresh = await dispatch(m2, 'task_find', {
      order: 'created',
      limit: PAGE,
    });
    record(
      'read tools: after a pass ends, a fresh pass begins with no cursor at the oldest task',
      endCheckpoint.status === 'ok' &&
        sameList(idsOf(fresh), expectedPass.slice(0, PAGE)) &&
        out(fresh).isDone === false,
      `fresh=${idsOf(fresh).length} first=${idsOf(fresh)[0] === expectedPass[0]}`,
    );

    // ==== captured reviewer discovery, beyond the old global 50 cap ======
    const capture = async (
      taskId: string,
      metadata: Record<string, unknown>,
      overrides: {
        organizationId?: string;
        status?: string;
        workflow?: string;
        resourceType?: string;
      } = {},
    ) => {
      const rows = await sql<{ id: string }[]>`
        INSERT INTO app.approvals (org_id, resource_type, resource_id, status,
          wf_execution_id, metadata, created_at_ms)
        VALUES (${overrides.organizationId ?? orgId}, ${overrides.resourceType ?? 'task_review'},
          ${taskId}, ${overrides.status ?? 'pending'}, ${overrides.workflow ?? null},
          ${JSON.stringify({ projectId: projectA, ...metadata })}::jsonb, ${now})
        RETURNING id
      `;
      const id = rows[0]?.id ?? '';
      discoveryApprovalIds.push(id);
      return id;
    };
    const expectedReviews = new Map<
      string,
      {
        approvalId: string;
        runId: string;
        reviewer: { kind: string; agentId: string };
      }
    >();
    for (let index = 0; index < 61; index++) {
      const taskId = await insertTask({
        projectId: projectA,
        title: `Review queue ${index}`,
        status: 'in_review',
        rank: `review-${suffix}`,
        createdAt: now,
        agentId: worker,
      });
      const runId = `review-source-${randomUUID()}`;
      const reviewer = { kind: 'agent', agentId: manager };
      const approvalId = await capture(taskId, { runId, reviewer });
      expectedReviews.set(taskId, { approvalId, runId, reviewer });
      // Configured future ownership and the implementation owner differ.
      await sql`UPDATE app.tasks SET reviewer_agent_id = ${worker} WHERE id = ${taskId}`;
    }
    const managerReviews = await walk(m2, {
      reviewerAgentId: manager,
      status: 'in_review',
      limit: 20,
    });
    const allReviewRows = managerReviews.pages.flatMap((page) =>
      listAt(page, 'tasks'),
    );
    record(
      'review discovery: captured agent ownership pages all 61 tied reviews with exact approval and source identities, independent of the future reviewer and implementer',
      managerReviews.ok &&
        managerReviews.ids.length === 61 &&
        new Set(managerReviews.ids).size === 61 &&
        managerReviews.pages.length === 4 &&
        allReviewRows.every(
          (task) =>
            JSON.stringify(task.pendingReview) ===
            JSON.stringify(expectedReviews.get(textAt(task, 'taskId'))),
        ),
      `pages=${managerReviews.pages.length} rows=${managerReviews.ids.length} unique=${new Set(managerReviews.ids).size}`,
    );
    const firstReview = managerReviews.ids[0] ?? '';
    const firstReviewSummary = expectedReviews.get(firstReview);
    // Newer irrelevant approval rows must not replace the native pending one.
    await capture(
      firstReview,
      { reviewer: { kind: 'agent', agentId: worker } },
      { status: 'completed' },
    );
    await capture(
      firstReview,
      { reviewer: { kind: 'agent', agentId: worker } },
      { workflow: 'legacy-workflow' },
    );
    await capture(
      firstReview,
      { reviewer: { kind: 'agent', agentId: worker } },
      { resourceType: 'connector_operation' },
    );
    await capture(
      firstReview,
      { reviewer: { kind: 'agent', agentId: worker } },
      { organizationId: `foreign-review-org-${suffix}` },
    );
    await capture(foreignTask, {
      reviewer: { kind: 'agent', agentId: manager },
    });
    const ignored = await walk(m2, { reviewerAgentId: worker, limit: 20 });
    const reread = await walk(m2, { reviewerAgentId: manager, limit: 20 });
    record(
      'review discovery: decided, workflow-bound, other-resource and foreign-org approvals never replace a captured review; foreign project tasks and configured-only reviewers do not match',
      ignored.ok &&
        ignored.ids.length === 0 &&
        reread.ok &&
        sameList(reread.ids, managerReviews.ids) &&
        !reread.ids.includes(foreignTask) &&
        JSON.stringify(
          recordAt(
            reread.pages
              .flatMap((page) => listAt(page, 'tasks'))
              .find((task) => task.taskId === firstReview),
            'pendingReview',
          ),
        ) === JSON.stringify(firstReviewSummary),
      `worker=${ignored.ids.length} manager=${reread.ids.length} foreign=${reread.ids.includes(foreignTask)}`,
    );
    const changedCursor = await dispatch(m2, 'task_find', {
      reviewerAgentId: worker,
      status: 'in_review',
      limit: 20,
      cursor: managerReviews.pages[0]?.continueCursor,
    });
    record(
      'review discovery: a signed review cursor cannot continue with a different captured reviewer filter',
      changedCursor.status === 'invalid_args' &&
        String(changedCursor.message).includes('cursor'),
      `status=${String(changedCursor.status)}`,
    );

    const changedApproval = await capture(firstReview, {
      reviewer: { kind: 'agent', agentId: worker },
      runId: 'new-source',
    });
    const newestReview = await dispatch(m2, 'task_find', {
      reviewerAgentId: worker,
    });
    record(
      'review discovery: the newest pending native review owns filtering and its summary when legacy duplicate pending rows exist',
      sameList(idsOf(newestReview), [firstReview]) &&
        recordAt(listAt(out(newestReview), 'tasks')[0], 'pendingReview')
          .approvalId === changedApproval,
      `ids=${idsOf(newestReview).length} approval=${textAt(recordAt(listAt(out(newestReview), 'tasks')[0], 'pendingReview'), 'approvalId')}`,
    );

    const deletedAgent = randomUUID();
    const deletedReviewTask = await insertTask({
      projectId: projectA,
      title: 'Deleted captured reviewer',
      status: 'in_review',
    });
    const deletedApproval = await capture(deletedReviewTask, {
      reviewer: { kind: 'agent', agentId: deletedAgent },
      runId: 'retained-source',
    });
    const deleted = await dispatch(m2, 'task_find', {
      reviewerAgentId: deletedAgent,
    });
    const deletedDetail = await dispatch(m2, 'task_get', {
      taskId: deletedReviewTask,
    });
    const missingGrantDetail = await dispatch(m2, 'task_get', {
      taskId: firstReview,
    });
    record(
      'review discovery: deleted captured IDs remain discoverable and task_get relays reviewer-unavailable and current missing-grant blockers',
      sameList(idsOf(deleted), [deletedReviewTask]) &&
        recordAt(listAt(out(deleted), 'tasks')[0], 'pendingReview')
          .approvalId === deletedApproval &&
        recordAt(out(deletedDetail), 'pendingReview')
          .agentReviewBlockedReason === 'reviewer_unavailable' &&
        recordAt(out(missingGrantDetail), 'pendingReview')
          .agentReviewBlockedReason === 'permission_missing',
      `deleted=${textAt(recordAt(out(deletedDetail), 'pendingReview'), 'agentReviewBlockedReason')} missingGrant=${textAt(recordAt(out(missingGrantDetail), 'pendingReview'), 'agentReviewBlockedReason')}`,
    );

    const malformedTask = await insertTask({
      projectId: projectA,
      title: 'Malformed typed owner',
      status: 'in_review',
    });
    await capture(malformedTask, {
      reviewer: { kind: 'agent', agentId: manager, extra: true },
      requestedFor: userId,
    });
    const managerAfter = await walk(m2, {
      reviewerAgentId: manager,
      status: 'in_review',
      limit: 20,
    });
    const allPending = await walk(m2, { status: 'in_review', limit: 20 });
    const rowsById = new Map(
      allPending.pages
        .flatMap((page) => listAt(page, 'tasks'))
        .map((task) => [task.taskId, task]),
    );
    record(
      'review discovery: a manager can page all owners, a legacy person remains human, malformed typed ownership cannot fall back or match an agent',
      allPending.ok &&
        managerAfter.ids.length === 60 &&
        !managerAfter.ids.includes(malformedTask) &&
        rowsById.has(deletedReviewTask) &&
        recordAt(rowsById.get(malformedTask), 'pendingReview').reviewer ===
          null &&
        JSON.stringify(
          recordAt(
            recordAt(rowsById.get(questionTask), 'pendingReview'),
            'reviewer',
          ),
        ) === JSON.stringify({ kind: 'user', userId }),
      `all=${allPending.ids.length} manager=${managerAfter.ids.length} deletedVisible=${rowsById.has(deletedReviewTask)}`,
    );
    for (const reviewerAgentId of [null, '', '  ', 3, {}, 'a'.repeat(201)]) {
      const result = await dispatch(m2, 'task_find', { reviewerAgentId });
      record(
        'review discovery: malformed reviewerAgentId is refused at the native tool boundary',
        result.status === 'invalid_args' &&
          String(result.message).includes('reviewerAgentId'),
        `type=${typeof reviewerAgentId} status=${String(result.status)}`,
      );
    }
  } finally {
    await sql`DELETE FROM app.approvals WHERE id = ANY(${discoveryApprovalIds})`;
    await sql`DELETE FROM app.sandbox_session_tokens
              WHERE token_hash = ANY(${tokens.map((token) =>
                createHash('sha256').update(token).digest('hex'),
              )})`;
    await sql`DELETE FROM app.sandbox_sessions
              WHERE session_id = ANY(${[...sessionIds]})`;
    await sql`DELETE FROM app.automation_runs
              WHERE org_id = ${orgId} AND name = ${`itest/read-${suffix}`}`;
    await sql`DELETE FROM app.approvals
              WHERE org_id = ${orgId} AND metadata ->> 'projectId' = ${projectA}`;
    await sql`DELETE FROM app.projects WHERE id = ANY(${[projectA, projectB]})`;
    await sql`DELETE FROM "member" WHERE "id" = ${`m-${member}`}`;
    await sql`DELETE FROM "user" WHERE "id" = ${member}`;
  }
}
