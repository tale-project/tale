import type { Sql } from 'postgres';

import { toJson } from '../../db/sql.ts';
import type { ShimHandlers } from '../../lib/ctx-shim.ts';
import { notifyAgentQuestionAsked } from '../collab/service.ts';

/**
 * The ASK lane's write door — `ask_human`, registered from two places.
 *
 * The automation stepper reaches it through `automationShimHandlers`; the
 * in-container tool dispatch (`POST /api/tools/execute`) reaches it through
 * `sandboxToolShimHandlers`. It lives in its own leaf module because the
 * sandbox map may not import the automations map: the automation shim already
 * spreads the task-agent turn shim, which spreads the sandbox one.
 *
 * Everything the tool needs is proven by the SESSION: the ask attaches to the
 * automation run the session belongs to, so a container cannot register a
 * question against another run. Every refusal is DATA (`{refused}`) rather
 * than a throw — the bridge relays it to the model as guidance, and a run that
 * cannot ask must still be able to finish with what it has.
 */

/** The run's task, re-read in the run's own org — a stale or foreign id in
 * the run input resolves to no task rather than a bell pointing at someone
 * else's card (0.4's `normalizeId` guard). */
async function resolveRunTask(
  sql: Sql,
  organizationId: string,
  taskId: string | null,
): Promise<{ id: string; title: string; projectId: string } | null> {
  if (taskId === null || taskId === '') return null;
  const rows = await sql<{ id: string; title: string; projectId: string }[]>`
    SELECT id, title, project_id AS "projectId" FROM app.tasks
    WHERE id = ${taskId} AND org_id = ${organizationId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function notifyAskBestEffort(
  sql: Sql,
  args: {
    organizationId: string;
    askId: string;
    runId: string;
    question: string;
    task: { id: string; title: string; projectId: string } | null;
  },
): Promise<void> {
  try {
    const runs = await sql<{ name: string; projectId: string | null }[]>`
      SELECT name, project_id AS "projectId" FROM app.automation_runs
      WHERE id = ${args.runId} LIMIT 1
    `;
    const run = runs[0];
    await notifyAgentQuestionAsked(sql, {
      organizationId: args.organizationId,
      askId: args.askId,
      runId: args.runId,
      question: args.question,
      automationLabel: run?.name ?? 'automation',
      task: args.task,
      ...(run?.projectId != null ? { projectId: run.projectId } : {}),
    });
  } catch (error) {
    console.warn('[asks] bell fan-out failed:', error);
  }
}

/** Between a turn's earlier question and a later one folded onto it. */
const ASK_FOLD_SEPARATOR = '\n\n---\n\n';

export function automationAskShimHandlers(sql: Sql): ShimHandlers {
  return {
    'automations/human_asks:createAskForExec': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the bridge passes exactly this shape
      const args = raw as {
        organizationId: string;
        sessionId: string;
        question: string;
        questions?: unknown;
      };
      const question = args.question.trim().slice(0, 4000);
      if (question === '') {
        return { refused: 'the question is empty' };
      }
      const sessions = await sql<{ ownerType: string; ownerId: string }[]>`
        SELECT owner_type AS "ownerType", owner_id AS "ownerId"
        FROM app.sandbox_sessions
        WHERE session_id = ${args.sessionId}
          AND org_id = ${args.organizationId}
        ORDER BY created_at_ms DESC
        LIMIT 1
      `;
      const session = sessions[0];
      if (!session || session.ownerType !== 'workflow_run') {
        return { refused: 'this session is not an automation run session' };
      }
      const runId = session.ownerId.split(':')[0] ?? '';
      const runs = await sql<
        { status: string; checkpoints: unknown; taskId: string | null }[]
      >`
        SELECT status, checkpoints, input -> 'task' ->> 'id' AS "taskId"
        FROM app.automation_runs
        WHERE id = ${runId} AND org_id = ${args.organizationId}
        LIMIT 1
      `;
      const run = runs[0];
      if (!run) {
        return { refused: 'the automation run behind this session is gone' };
      }
      if (!['waiting', 'running', 'queued'].includes(run.status)) {
        return { refused: 'the automation run has already finished' };
      }
      const checkpoints =
        run.checkpoints !== null && typeof run.checkpoints === 'object'
          ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the stepper owns this JSON shape
            (run.checkpoints as {
              cursor?: {
                node?: string;
                agent?: { execId?: string; result?: unknown };
              };
            })
          : {};
      const agent = checkpoints.cursor?.agent;
      if (agent === undefined || agent.result !== undefined) {
        return { refused: 'the run has no live agent turn right now' };
      }
      const execId = agent.execId ?? '';
      // A run bound to a task carries it in its input; resolve it ONCE and
      // hang the ask off it, so the bell deep-links to the card the person
      // is being asked about instead of the bare dashboard.
      const task = await resolveRunTask(sql, args.organizationId, run.taskId);
      // ONE statement, never SELECT-then-INSERT: the pending-ask rule is a
      // partial unique index (migration 0082), so two ask_human calls racing
      // inside one turn converge on one row carrying both questions — the
      // fold happens in the database, and `inserted` tells the two apart.
      const rows = await sql<
        { id: string; question: string; inserted: boolean }[]
      >`
        INSERT INTO app.automation_human_asks AS t (
          org_id, run_id, node_id, session_id, exec_id, question, questions,
          status, expires_at_ms, task_id, created_at_ms
        ) VALUES (
          ${args.organizationId}, ${runId},
          ${checkpoints.cursor?.node ?? ''}, ${args.sessionId}, ${execId},
          ${question},
          ${args.questions === undefined ? null : sql.json(toJson(args.questions))},
          'pending', ${Date.now() + 7 * 24 * 3_600_000}, ${task?.id ?? null},
          ${Date.now()}
        )
        ON CONFLICT (session_id, exec_id) WHERE status = 'pending' DO UPDATE SET
          question = left(t.question || ${ASK_FOLD_SEPARATOR}::text || EXCLUDED.question, 4000),
          questions = NULL
        RETURNING id, question, (xmax = 0) AS inserted
      `;
      const landed = rows[0];
      if (!landed) return { refused: 'the question could not be recorded' };
      await notifyAskBestEffort(sql, {
        organizationId: args.organizationId,
        askId: landed.id,
        runId,
        question: landed.question,
        task,
      });
      return {
        askId: landed.id,
        ...(task !== null ? { taskId: task.id } : {}),
        question,
        folded: !landed.inserted,
      };
    },
  };
}
