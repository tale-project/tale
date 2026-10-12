/** Real Postgres proof of a task run on the native engine — the turn a chat
 * reply runs on, working a task (migration 0201):
 *
 * - the schema: `engine` is NOT NULL and defaults to the harness, so a run an
 *   older image inserts while a deploy rolls is a harness run; only the two
 *   engines are admitted; a run's transcript pointer clears when its thread
 *   goes; the watchdog's question is indexed;
 * - the host end to end, over the real chat store, work tools, blob store and
 *   settle door, with a scripted engine standing where the model is: the
 *   brief opens the run's own transcript thread, a file the tools make is
 *   bound to it, and the run settles as a harness run does — the files are
 *   the task's deliverables, the closing message its report, the task moves
 *   to review, and the run card and its transcript read it;
 * - a file a run made reads for the people who can read the task's project,
 *   and for nobody else;
 * - a run that needs the full workspace hands itself over: the harness is
 *   queued under a fresh exec with the pass's brief, the files already made
 *   are the task's deliverables, and the retry of such a run goes to the
 *   harness with the same brief instead of starting native again;
 * - a failed turn is classified for the run ledger (a rate limit retries, the
 *   organization's policy does not and is announced), and a run no person
 *   started is routed to the harness before anything runs;
 * - Stop flags the turn through its transcript's generation row;
 * - the watchdog fails a native run whose turn is gone — no transcript, a
 *   turn that ended without a settle, a heartbeat gone silent — and leaves a
 *   live turn alone; the queued-run recovery wakes a native run on its own
 *   queue; the harness's stalled-turn sweep never touches one;
 * - deleting the task takes the runs' transcripts and the files they made
 *   with it, and queues the bytes for release.
 *
 * The queue is inert: every start and retry job this lane's writes enqueue is
 * held a day inside the writing transaction. No sandbox, provider or model is
 * touched. */
import { randomUUID } from 'node:crypto';

import { transactSerializable } from '@tale/shared/db/serializable';
import type { Sql, TransactionSql } from 'postgres';

import type { TurnOutcome } from '../../../lib/chat/turn.ts';
import type { MessagePart } from '../../../lib/chat/types.ts';
import type { executeTurn } from '../../core/chat/turn_action.ts';
import {
  itestObjectStore,
  type RecordCheck,
  recordSkip,
} from '../../integration-lane-helpers.ts';
import { createTaskList } from '../../jobs/task-list.ts';
import { resolveFileReadAccess } from '../files/access.ts';
import { ensureDefaultObjectStore } from '../object_storage/bootstrap.ts';
import { getProjectAuthContext } from '../projects/service.ts';
import {
  cancelAgentRun,
  failAgentRunFromTurn,
  getLatestAgentRunCardForTask,
} from './agent-runs.ts';
import { claimAgentWorker } from './agent-workers.ts';
import { readNativeRunOp } from './native-runs.ts';
import { runNativeAgentTurn } from './native-turn.ts';
import {
  recoverStalledTaskAgentTurns,
  recoverStuckQueuedTaskAgentRuns,
} from './reattach.ts';
import { aroundTransactions } from './retry-eligibility.integration.ts';
import { deleteTask } from './service.ts';
import { runTaskAgentWatchdog } from './watchdogs.ts';

/** What the scripted engine is handed, as `executeTurn` receives it. */
interface Turn {
  args: Parameters<typeof executeTurn>[1];
  overrides: Parameters<typeof executeTurn>[2];
}

const scripted =
  (script: (turn: Turn) => Promise<TurnOutcome>): typeof executeTurn =>
  (_ctx, args, overrides) =>
    script({ args, overrides });

const completed = (text: string): TurnOutcome =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the host reads the status, the text and the cancel flag alone
  ({ status: 'completed', steps: [], text }) as unknown as TurnOutcome;

/** The entries of a run card's live timeline, whatever the wire types them as. */
const timelineOf = (
  op: { liveTimeline?: unknown } | null,
): Record<string, unknown>[] => {
  const timeline = op?.liveTimeline;
  return Array.isArray(timeline)
    ? timeline.filter(
        (entry): entry is Record<string, unknown> =>
          typeof entry === 'object' && entry !== null,
      )
    : [];
};

/** The `status` a tool answered with, whatever shape the answer has. */
const statusOf = (answer: unknown): unknown =>
  typeof answer === 'object' && answer !== null && 'status' in answer
    ? answer.status
    : undefined;

/**
 * One turn the way the pipeline drives it, minus the model: open it (the
 * brief becomes the user message, the placeholder and the generation row
 * appear), call each tool through the executor the lane built, settle the
 * reply with its calls and results, and end the generation.
 */
async function drive(
  turn: Turn,
  steps: readonly { name: string; input: unknown }[],
  text: string,
): Promise<unknown[]> {
  const { args, overrides } = turn;
  const opened = await overrides.deps.store.beginTurn({
    organizationId: args.organizationId,
    threadId: args.threadId,
    userParts: [{ type: 'text', text: args.userText }],
  });
  const tools = await overrides.workTools?.({
    rootThreadId: args.threadId,
    threadIds: [args.threadId],
    projectId: args.expectedProjectId ?? null,
  });
  const parts: MessagePart[] = [];
  const results: unknown[] = [];
  try {
    for (const [index, step] of steps.entries()) {
      const callId = `call-${index}`;
      parts.push({
        type: 'tool-call',
        callId,
        capabilityId: step.name,
        input: step.input,
      });
      const result = await tools?.executor.execute({
        id: callId,
        name: step.name,
        input: step.input,
      });
      results.push(result);
      parts.push({
        type: 'tool-result',
        callId,
        capabilityId: step.name,
        output: result,
        structured: true,
      });
    }
    parts.push({ type: 'text', text });
    await overrides.deps.store.finalizeAssistantMessage({
      organizationId: args.organizationId,
      threadId: args.threadId,
      messageId: opened.assistantMessage.id,
      text,
      parts,
      model: args.modelId ?? 'itest-model',
    });
  } finally {
    await overrides.deps.store.endGeneration({
      organizationId: args.organizationId,
      threadId: args.threadId,
    });
  }
  return results;
}

const CONTACTS_CSV =
  'name,email\nAda,ada@example.com\nGrace,grace@example.com\n';

export async function checkNativeAgentRuns(
  sql: Sql,
  ctx: { orgId: string; userId: string },
  record: RecordCheck,
): Promise<void> {
  const { orgId, userId } = ctx;
  const suffix = randomUUID().slice(0, 8);
  const starter = `native-starter-${suffix}`;
  const teammate = `native-teammate-${suffix}`;
  const outsider = `native-outsider-${suffix}`;
  const people = [starter, teammate, outsider];
  const teamId = `native-team-${suffix}`;
  const projectId = randomUUID();
  const agentId = randomUUID();
  const now = Date.now();
  const owner = {
    organizationId: orgId,
    userId,
    role: 'owner',
    teamIds: [] as string[],
  };
  const threads: string[] = [];
  /** The blob refs the retirement queued for release. */
  const releasedRefs: string[] = [];
  let sequence = 0;

  // Every start and retry job this lane's writes enqueue stays queued a day:
  // held in the writing transaction, before any worker can see it.
  const holdJobs = async (tx: TransactionSql) => {
    await tx`
      UPDATE pgboss.job SET start_after = now() + interval '1 day'
      WHERE name IN ('task.agent_turn', 'task.agent_native', 'task.agent_retry')
        AND state = 'created'
        AND (data ->> 'runId' IN (SELECT id FROM app.project_agent_runs
                                  WHERE project_id = ${projectId})
             OR data ->> 'taskId' IN (SELECT id FROM app.tasks
                                      WHERE project_id = ${projectId}))
    `;
  };
  const held = aroundTransactions(sql, { after: holdJobs });
  const retryHandler = createTaskList({ sql: held })['task.agent_retry'];
  if (retryHandler === undefined) {
    throw new Error('itest: the retry handler is missing');
  }

  /** An agent-owned task at In progress the owner created. */
  const mkTask = async (title: string, description: string | null = null) => {
    const taskId = randomUUID();
    sequence += 1;
    await sql`
      INSERT INTO app.tasks (id, org_id, project_id, title, description,
        status, rank, assignee_type, assignee_id, created_by, created_by_type,
        created_at_ms, updated_at_ms)
      VALUES (${taskId}, ${orgId}, ${projectId}, ${title}, ${description},
        'in_progress', ${`n${suffix}${sequence}`}, 'agent', ${agentId},
        ${userId}, 'user', ${now}, ${now})
    `;
    return taskId;
  };
  /** A thread the way the run's transcript is: bare, of its own kind. */
  const mkThread = async (): Promise<string> => {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO app.threads (org_id, user_id, title, kind, created_at_ms,
                               updated_at_ms)
      VALUES (${orgId}, ${starter}, 'itest transcript', 'task_run', ${now},
              ${now})
      RETURNING id
    `;
    const id = rows[0]?.id ?? '';
    threads.push(id);
    return id;
  };
  const mkGeneration = (threadId: string, heartbeatAgoMs: number) => sql`
    INSERT INTO app.generations (thread_id, org_id, started_at_ms,
      heartbeat_at_ms, updated_at_ms)
    VALUES (${threadId}, ${orgId}, ${now - heartbeatAgoMs},
            ${now - heartbeatAgoMs}, ${now - heartbeatAgoMs})
  `;
  const mkRun = async (
    taskId: string,
    opts: {
      engine: 'native' | 'harness';
      status: 'queued' | 'running';
      startedBy?: string;
      threadId?: string | null;
      updatedAgoMs?: number;
    },
  ): Promise<{ runId: string; execId: string }> => {
    const execId = `exec-native-${randomUUID().slice(0, 8)}`;
    const rows = await sql<{ id: string }[]>`
      INSERT INTO app.project_agent_runs (
        org_id, project_id, task_id, agent_id, exec_id, session_id, status,
        harness, engine, model, trigger, started_by, started_at_ms,
        launched_at_ms, deadline_at_ms, updated_at_ms, thread_id
      ) VALUES (
        ${orgId}, ${projectId}, ${taskId}, ${agentId}, ${execId},
        ${`pa-${agentId}`}, ${opts.status}, 'claude-code', ${opts.engine},
        'itest-model', 'manual', ${opts.startedBy ?? starter}, ${now - 900_000},
        ${opts.status === 'running' ? now - 890_000 : null}, ${now + 3_600_000},
        ${now - (opts.updatedAgoMs ?? 0)}, ${opts.threadId ?? null}
      ) RETURNING id
    `;
    return { runId: rows[0]?.id ?? '', execId };
  };
  const runOf = async (runId: string) =>
    (
      await sql<
        {
          status: string;
          engine: string;
          execId: string;
          threadId: string | null;
          handoff: { reason: string; brief: string } | null;
          failureCode: string | null;
          error: string | null;
          resultText: string | null;
          resultMessageId: string | null;
          armed: number | null;
          trigger: string | null;
          launched: number | null;
          settled: number | null;
        }[]
      >`
        SELECT status, engine, exec_id AS "execId", thread_id AS "threadId",
               handoff, failure_code AS "failureCode", error,
               result_text AS "resultText",
               result_message_id AS "resultMessageId",
               auto_retry_armed_at_ms::float8 AS armed, trigger,
               launched_at_ms::float8 AS launched,
               settled_at_ms::float8 AS settled
        FROM app.project_agent_runs WHERE id = ${runId}
      `
    )[0];
  const taskOf = async (taskId: string) =>
    (
      await sql<
        {
          status: string;
          outputs:
            | { fileId: string; fileName: string; runId?: string }[]
            | null;
          comments: number;
        }[]
      >`
        SELECT status, outputs, comment_count AS comments
        FROM app.tasks WHERE id = ${taskId}
      `
    )[0];
  const jobsOf = (name: string, runId: string) =>
    sql<{ execId: string | null }[]>`
      SELECT data ->> 'execId' AS "execId" FROM pgboss.job
      WHERE name = ${name} AND data ->> 'runId' = ${runId}
    `;
  const input = (run: { runId: string; execId: string }) => ({
    organizationId: orgId,
    runId: run.runId,
    execId: run.execId,
  });
  const silently = async <T>(work: () => Promise<T>): Promise<T> => {
    const log = console.log;
    const warn = console.warn;
    console.log = () => undefined;
    console.warn = () => undefined;
    try {
      return await work();
    } finally {
      console.log = log;
      console.warn = warn;
    }
  };

  try {
    for (const person of people) {
      await sql`
        INSERT INTO "user" ("id", "name", "email", "emailVerified",
                            "createdAt", "updatedAt")
        VALUES (${person}, ${person}, ${`${person}@example.com`}, true,
                ${new Date()}, ${new Date()})
      `;
      await sql`
        INSERT INTO "member" ("id", "organizationId", "userId", "role",
                              "createdAt")
        VALUES (${`m-${person}`}, ${orgId}, ${person},
                ${person === starter ? 'editor' : 'member'}, ${new Date()})
      `;
    }
    await sql`
      INSERT INTO "team" ("id", "name", "organizationId", "createdAt",
                          "updatedAt")
      VALUES (${teamId}, 'Native squad', ${orgId}, ${new Date()}, ${new Date()})
    `;
    for (const person of [starter, teammate]) {
      await sql`
        INSERT INTO "teamMember" ("id", "teamId", "userId", "createdAt")
        VALUES (${`tm-${person}`}, ${teamId}, ${person}, ${new Date()})
      `;
    }
    await sql`
      INSERT INTO app.projects (id, org_id, name, team_ids, created_by,
                                created_at_ms, updated_at_ms)
      VALUES (${projectId}, ${orgId}, 'Native runs', ${sql.array([teamId])},
              ${userId}, ${now}, ${now})
    `;
    await sql`
      INSERT INTO app.project_agents (id, org_id, project_id, name, harness,
                                      model, created_by, created_at_ms,
                                      updated_at_ms)
      VALUES (${agentId}, ${orgId}, ${projectId}, 'Native agent',
              'claude-code', 'itest-model', ${userId}, ${now}, ${now})
    `;

    // ---- the schema -------------------------------------------------------
    const columns = await sql<
      {
        name: string;
        type: string;
        nullable: string;
        fallback: string | null;
      }[]
    >`
      SELECT column_name AS name, data_type AS type, is_nullable AS nullable,
             column_default AS fallback
      FROM information_schema.columns
      WHERE table_schema = 'app' AND table_name = 'project_agent_runs'
        AND column_name IN ('engine', 'thread_id', 'handoff')
      ORDER BY column_name
    `;
    const shape = columns.map(
      (column) =>
        `${column.name}:${column.type}:${column.nullable}:${column.fallback ?? '-'}`,
    );
    const index = await sql<{ def: string }[]>`
      SELECT indexdef AS def FROM pg_indexes
      WHERE schemaname = 'app' AND tablename = 'project_agent_runs'
        AND indexname = 'project_agent_runs_native_running'
    `;
    record(
      'native runs: the engine is a NOT NULL column that defaults to the harness, the transcript and the hand-over are nullable, and the watchdog’s question is indexed',
      shape.join(' ') ===
        "engine:text:NO:'harness'::text handoff:jsonb:YES:- thread_id:text:YES:-" &&
        index.length === 1 &&
        /engine = 'native'/.test(index[0]?.def ?? '') &&
        /status = 'running'/.test(index[0]?.def ?? ''),
      `columns=${shape.join(' ')} index=${index[0]?.def ?? 'missing'}`,
    );

    // A run an OLDER image inserts names no engine: it is a harness run.
    const olderTask = await mkTask('Inserted by an older image');
    const olderRows = await sql<{ id: string; engine: string }[]>`
      INSERT INTO app.project_agent_runs (
        org_id, project_id, task_id, agent_id, exec_id, session_id, status,
        harness, model, trigger, started_by, started_at_ms, deadline_at_ms,
        updated_at_ms
      ) VALUES (
        ${orgId}, ${projectId}, ${olderTask}, ${agentId}, 'exec-older',
        ${`pa-${agentId}`}, 'cancelled', 'claude-code', 'itest-model',
        'manual', ${starter}, ${now}, ${now + 3_600_000}, ${now}
      ) RETURNING id, engine
    `;
    const refusedEngine = await sql`
      INSERT INTO app.project_agent_runs (
        org_id, project_id, task_id, agent_id, exec_id, session_id, status,
        harness, engine, model, trigger, started_by, started_at_ms,
        deadline_at_ms, updated_at_ms
      ) VALUES (
        ${orgId}, ${projectId}, ${olderTask}, ${agentId}, 'exec-bogus',
        ${`pa-${agentId}`}, 'cancelled', 'claude-code', 'bogus', 'itest-model',
        'manual', ${starter}, ${now}, ${now + 3_600_000}, ${now}
      )
    `.then(
      () => false,
      (error: unknown) =>
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === '23514',
    );
    const goneThread = await mkThread();
    await sql`
      UPDATE app.project_agent_runs SET thread_id = ${goneThread}
      WHERE id = ${olderRows[0]?.id ?? ''}
    `;
    await sql`DELETE FROM app.threads WHERE id = ${goneThread}`;
    const afterThread = await runOf(olderRows[0]?.id ?? '');
    record(
      'native runs: a run an older image inserts is a harness run, only the two engines are admitted, and a run whose transcript thread goes loses only the pointer',
      olderRows[0]?.engine === 'harness' &&
        refusedEngine &&
        afterThread?.threadId === null &&
        afterThread.status === 'cancelled',
      `older engine=${olderRows[0]?.engine ?? 'missing'} bogus refused=${refusedEngine} threadId after delete=${afterThread?.threadId ?? 'null'}`,
    );

    // ---- a run no person started goes to the harness before anything runs -
    const scheduledTask = await mkTask('Started by a schedule');
    const scheduled = await mkRun(scheduledTask, {
      engine: 'native',
      status: 'queued',
      startedBy: `trigger:itest-${suffix}`,
    });
    let enginesCalled = 0;
    await silently(() =>
      runNativeAgentTurn(held, input(scheduled), {
        engine: scripted(() => {
          enginesCalled += 1;
          return Promise.resolve(completed('should not run'));
        }),
      }),
    );
    const routed = await runOf(scheduled.runId);
    const routedJobs = await jobsOf('task.agent_turn', scheduled.runId);
    record(
      'native runs: a run a schedule started is routed to the harness before the engine runs — a fresh exec, its start queued, no transcript, no hand-over brief',
      enginesCalled === 0 &&
        routed?.engine === 'harness' &&
        routed.status === 'queued' &&
        routed.execId !== scheduled.execId &&
        routed.threadId === null &&
        routed.handoff === null &&
        routedJobs.length === 1 &&
        routedJobs[0]?.execId === routed.execId,
      `engine calls=${enginesCalled} run=${JSON.stringify(routed)} harness start jobs=${JSON.stringify(routedJobs)}`,
    );

    // ---- the blob store ---------------------------------------------------
    const objectStore = itestObjectStore();
    if (objectStore === null) {
      recordSkip(
        record,
        'native runs: the host over the real work tools and blob store — settle, hand-over, file access, retirement',
        'no ITEST_S3_ENDPOINT — a run’s files have no store to land in',
      );
    } else {
      await ensureDefaultObjectStore(sql, {
        OBJECT_STORE_ENDPOINT: objectStore.endpoint,
        OBJECT_STORE_BUCKET: 'itest-blobs',
        OBJECT_STORE_ACCESS_KEY: objectStore.accessKeyId,
        OBJECT_STORE_SECRET_KEY: objectStore.secretAccessKey,
      });

      // ---- a run that settles --------------------------------------------
      const settleTask = await mkTask(
        'Contacts file',
        'Please prepare the onboarding contacts as a CSV file.',
      );
      const settle = await mkRun(settleTask, {
        engine: 'native',
        status: 'queued',
      });
      const closing = 'I made the contacts file.';
      await silently(() =>
        runNativeAgentTurn(held, input(settle), {
          engine: scripted(async (turn) => {
            await drive(
              turn,
              [
                {
                  name: 'create_file',
                  input: { name: 'notes.md', content: '# Notes v1' },
                },
                {
                  name: 'create_file',
                  input: { name: 'notes.md', content: '# Notes v2' },
                },
                {
                  name: 'create_file',
                  input: { name: 'contacts.csv', content: CONTACTS_CSV },
                },
              ],
              closing,
            );
            return completed(closing);
          }),
        }),
      );
      const settled = await runOf(settle.runId);
      const settledTask = await taskOf(settleTask);
      const comments = await sql<{ author: string; body: string | null }[]>`
        SELECT meta.author_type AS author, m.text AS body
        FROM app.task_discussion_message_meta meta
        JOIN app.messages m ON m.id = meta.message_id
        WHERE meta.task_id = ${settleTask}
        ORDER BY m."order", m.step_order
      `;
      const outputNames = (settledTask?.outputs ?? [])
        .map((output) => output.fileName)
        .toSorted();
      record(
        'native runs: a run settles as a harness run does — the files its tools made are the task’s deliverables, the closing message is the report with a delivery notice beside it, and the task waits for review',
        settled?.status === 'settled' &&
          settled.engine === 'native' &&
          settled.resultText === closing &&
          settled.resultMessageId !== null &&
          settled.failureCode === null &&
          settled.launched !== null &&
          settledTask?.status === 'in_review' &&
          JSON.stringify(outputNames) ===
            JSON.stringify(['contacts.csv', 'notes.md']) &&
          settledTask.outputs?.every(
            (output) => output.runId === settle.runId,
          ) === true &&
          comments.length === 2 &&
          comments[0]?.body === closing &&
          (comments[1]?.body ?? '').includes('contacts.csv') &&
          (comments[1]?.body ?? '').includes('notes.md') &&
          comments.every((comment) => comment.author === 'agent'),
        `run=${JSON.stringify(settled)} task=${JSON.stringify(settledTask)} comments=${JSON.stringify(comments)}`,
      );

      const runThread = settled?.threadId ?? '';
      if (runThread !== '') threads.push(runThread);
      const transcript = await sql<
        {
          role: string;
          status: string;
          text: string | null;
          parts: MessagePart[] | null;
        }[]
      >`
        SELECT role, status, text, parts FROM app.messages
        WHERE thread_id = ${runThread} ORDER BY "order", step_order
      `;
      const assistantParts = transcript[1]?.parts ?? [];
      const threadRow = await sql<
        { kind: string | null; user: string | null }[]
      >`
        SELECT kind, user_id AS "user" FROM app.threads WHERE id = ${runThread}
      `;
      const chatRows = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM app.thread_metadata
        WHERE thread_id = ${runThread}
      `;
      const generation = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM app.generations
        WHERE thread_id = ${runThread}
      `;
      const light = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM app.sandbox_sessions
        WHERE org_id = ${orgId} AND owner_type = 'light'
          AND owner_id = ${settle.runId}
      `;
      record(
        'native runs: the run’s transcript is its own bare thread for the person it acts for — the brief, then the reply with its tool calls and results — never a chat in anyone’s list, and no generation or light sandbox is left behind',
        threadRow[0]?.kind === 'task_run' &&
          threadRow[0].user === starter &&
          chatRows[0]?.n === 0 &&
          transcript.map((message) => message.role).join() ===
            'user,assistant' &&
          (transcript[0]?.text ?? '').startsWith('You are working on ') &&
          (transcript[0]?.text ?? '').includes('Contacts file') &&
          transcript[1]?.status === 'complete' &&
          assistantParts.filter((part) => part.type === 'tool-call').length ===
            3 &&
          assistantParts.filter((part) => part.type === 'tool-result')
            .length === 3 &&
          generation[0]?.n === 0 &&
          light[0]?.n === 0,
        `thread=${JSON.stringify(threadRow)} chat rows=${chatRows[0]?.n} roles=${transcript.map((m) => m.role).join()} parts=${assistantParts.map((p) => p.type).join()} generations=${generation[0]?.n} light=${light[0]?.n}`,
      );

      // Every file the run's tools made: the ones its transcript still binds,
      // and the ones it delivered, which the task lists.
      const deliveredRefs = (settledTask?.outputs ?? []).map(
        (output) => output.fileId,
      );
      const fileRows = await sql<
        {
          name: string;
          source: string | null;
          uploadedBy: string | null;
          threadId: string | null;
          ref: string;
          size: number;
        }[]
      >`
        SELECT file_name AS name, source, uploaded_by AS "uploadedBy",
               thread_id AS "threadId", storage_ref AS ref, size::float8 AS size
        FROM app.file_metadata
        WHERE org_id = ${orgId}
          AND (thread_id = ${runThread} OR storage_ref = ANY(${deliveredRefs}))
        ORDER BY created_at_ms, id
      `;
      const sources = fileRows
        .map((file) => `${file.name}:${file.source}`)
        .toSorted();
      const delivered = fileRows.filter(
        (file) => file.source === 'task-output',
      );
      const scratch = fileRows.filter((file) => file.source === 'agent');
      record(
        'native runs: the files a tool made are bound to the run’s transcript under the person it acts for until the run delivers them; a deliverable is then the task’s alone — bound to neither the transcript nor its starter — and the earlier version of a revised file stays the run’s own [TASK-R36]',
        fileRows.length === 3 &&
          JSON.stringify(sources) ===
            JSON.stringify([
              'contacts.csv:task-output',
              'notes.md:agent',
              'notes.md:task-output',
            ]) &&
          delivered.length === 2 &&
          delivered.every(
            (file) => file.uploadedBy === null && file.threadId === null,
          ) &&
          scratch.length === 1 &&
          scratch[0]?.uploadedBy === starter &&
          scratch[0].threadId === runThread &&
          fileRows.find((file) => file.name === 'contacts.csv')?.size ===
            CONTACTS_CSV.length,
        `files=${JSON.stringify(fileRows.map((f) => `${f.name}:${f.source}:${f.uploadedBy ?? '-'}:${f.threadId === null ? '-' : 'thread'}`))}`,
      );

      const op = await readNativeRunOp(sql, orgId, settle.runId);
      const card = await getLatestAgentRunCardForTask(sql, orgId, settleTask);
      const timeline = timelineOf(op);
      record(
        'native runs: the run card reads the transcript in the wire a harness run’s log has — the tool calls with their results, the run completed — and names the engine',
        op?.status === 'completed' &&
          timeline.filter(
            (entry) =>
              entry.type === 'tool-create_file' &&
              entry.state === 'output-available',
          ).length === 3 &&
          card?.status === 'settled' &&
          card.engine === 'native',
        `op status=${op?.status} tools=${timeline.map((e) => `${String(e.type)}:${String(e.state)}`).join()} card=${card?.status}/${card?.engine}`,
      );

      // ---- who reads a file a run made ------------------------------------
      // The earlier version of the revised file: the task lists only the last.
      const earlierNotes = fileRows.find(
        (file) => file.name === 'notes.md' && file.source === 'agent',
      );
      const readAs = async (who: string, role: string) =>
        resolveFileReadAccess(
          sql,
          await getProjectAuthContext(sql, {
            organizationId: orgId,
            userId: who,
            role,
          }),
          {
            organizationId: orgId,
            storageRef: earlierNotes?.ref ?? '',
            uploadedBy: starter,
            documentId: null,
            threadId: runThread,
            conversationId: null,
          },
        );
      const [byStarter, byTeammate, byOutsider] = [
        await readAs(starter, 'editor'),
        await readAs(teammate, 'member'),
        await readAs(outsider, 'member'),
      ];
      record(
        'native runs: a file a run made — one the task does not even list, an earlier version — reads for the people who can read the task’s project, and for nobody outside it',
        byStarter && byTeammate && !byOutsider,
        `starter=${byStarter} teammate=${byTeammate} outsider=${byOutsider} (want true/true/false)`,
      );
      // A deliverable reads through the task that lists it, as a harness
      // run's always did.
      const contactsRef =
        delivered.find((file) => file.name === 'contacts.csv')?.ref ?? '';
      const readDelivered = async (who: string, role: string) =>
        resolveFileReadAccess(
          sql,
          await getProjectAuthContext(sql, {
            organizationId: orgId,
            userId: who,
            role,
          }),
          {
            organizationId: orgId,
            storageRef: contactsRef,
            uploadedBy: null,
            documentId: null,
            threadId: null,
            conversationId: null,
          },
        );
      const [deliveredToTeammate, deliveredToOutsider] = [
        await readDelivered(teammate, 'member'),
        await readDelivered(outsider, 'member'),
      ];
      record(
        'native runs: a deliverable reads through the task that lists it — for the people who can read the project, and for nobody outside it — whoever started the run',
        contactsRef !== '' && deliveredToTeammate && !deliveredToOutsider,
        `teammate=${deliveredToTeammate} outsider=${deliveredToOutsider} (want true/false)`,
      );

      // ---- a run that needs the full workspace ----------------------------
      const handTask = await mkTask(
        'Run the repository tests',
        'Clone the repository and run its tests.',
      );
      const hand = await mkRun(handTask, {
        engine: 'native',
        status: 'queued',
      });
      let askedFor: unknown;
      await silently(() =>
        runNativeAgentTurn(held, input(hand), {
          engine: scripted(async (turn) => {
            const results = await drive(
              turn,
              [
                {
                  name: 'create_file',
                  input: { name: 'draft.md', content: '# Findings so far' },
                },
                {
                  name: 'use_workspace',
                  input: {
                    reason: 'The work needs a repository checked out.',
                    brief: 'Clone the repository and run its tests.',
                  },
                },
              ],
              'Handing this over.',
            );
            askedFor = results[1];
            return completed('Handing this over.');
          }),
        }),
      );
      const handed = await runOf(hand.runId);
      const handedTask = await taskOf(handTask);
      const nativeJobs = await jobsOf('task.agent_native', hand.runId);
      const harnessJobs = await jobsOf('task.agent_turn', hand.runId);
      if (handed?.threadId) threads.push(handed.threadId);
      record(
        'native runs: a run that needs the full workspace hands itself over — the harness is queued under a fresh exec with the pass’s reason and brief, the files already made are the task’s deliverables, the pass’s sentence is not posted as the report, and the card stays at work',
        statusOf(askedFor) === 'ok' &&
          handed?.engine === 'harness' &&
          handed.status === 'queued' &&
          handed.execId !== hand.execId &&
          handed.threadId !== null &&
          handed.settled === null &&
          handed.handoff?.reason ===
            'The work needs a repository checked out.' &&
          handed.handoff.brief === 'Clone the repository and run its tests.' &&
          handedTask?.status === 'in_progress' &&
          handedTask.comments === 0 &&
          JSON.stringify(handedTask.outputs?.map((o) => o.fileName)) ===
            JSON.stringify(['draft.md']) &&
          harnessJobs.length === 1 &&
          harnessJobs[0]?.execId === handed.execId &&
          nativeJobs.length === 0,
        `answer=${JSON.stringify(askedFor)} run=${JSON.stringify(handed)} task=${JSON.stringify(handedTask)} harness jobs=${JSON.stringify(harnessJobs)} native jobs=${nativeJobs.length}`,
      );

      // The harness cannot start (this lane has no sandbox): the failure is
      // retried, and the retry goes to the harness with the same brief.
      await failAgentRunFromTurn(held, {
        runId: hand.runId,
        execId: handed?.execId ?? '',
        error: 'itest: the harness could not start',
        failureCode: 'start_failed',
      });
      const retryJobs = await sql<{ data: unknown }[]>`
        SELECT data FROM pgboss.job
        WHERE name = 'task.agent_retry' AND data ->> 'expectedRunId' = ${hand.runId}
      `;
      await silently(async () => {
        await retryHandler(retryJobs[0]?.data);
      });
      const retried = (
        await sql<{ id: string }[]>`
          SELECT id FROM app.project_agent_runs
          WHERE task_id = ${handTask} AND id <> ${hand.runId}
          ORDER BY seq DESC LIMIT 1
        `
      )[0];
      const retriedRun =
        retried === undefined ? undefined : await runOf(retried.id);
      record(
        'native runs: the retry of a run that handed over goes straight to the harness with the same brief, instead of starting native again',
        retryJobs.length === 1 &&
          retriedRun?.engine === 'harness' &&
          retriedRun.trigger === 'auto_retry' &&
          retriedRun.status === 'queued' &&
          retriedRun.handoff?.brief ===
            'Clone the repository and run its tests.',
        `retry jobs=${retryJobs.length} retried=${JSON.stringify(retriedRun)}`,
      );

      // ---- failures --------------------------------------------------------
      const rateTask = await mkTask('Rate limited');
      const rate = await mkRun(rateTask, {
        engine: 'native',
        status: 'queued',
      });
      await silently(() =>
        runNativeAgentTurn(held, input(rate), {
          engine: scripted(() =>
            Promise.reject(
              Object.assign(new Error('Rate limit exceeded, retry later'), {
                status: 429,
              }),
            ),
          ),
        }),
      );
      const rated = await runOf(rate.runId);
      const rateCard = await getLatestAgentRunCardForTask(sql, orgId, rateTask);
      if (rated?.threadId) threads.push(rated.threadId);
      record(
        'native runs: a provider’s rate limit fails the run as model capacity, arms its automatic retry and reads as pending on the card — the same posture a harness run has',
        rated?.status === 'failed' &&
          rated.failureCode === 'model_capacity' &&
          rated.error === 'Rate limit exceeded, retry later' &&
          typeof rated.armed === 'number' &&
          rateCard?.retryPending === true,
        `run=${JSON.stringify(rated)} retryPending=${rateCard?.retryPending}`,
      );

      const policyTask = await mkTask('Refused by policy');
      const policy = await mkRun(policyTask, {
        engine: 'native',
        status: 'queued',
      });
      await silently(() =>
        runNativeAgentTurn(held, input(policy), {
          engine: scripted(() =>
            Promise.resolve<TurnOutcome>({
              status: 'refused',
              steps: [],
              step: 'input-guardrails',
              reason: 'Blocked by the organization’s content policy',
              persisted: true,
            }),
          ),
        }),
      );
      const refused = await runOf(policy.runId);
      const policyNotices = await sql<{ userId: string; bodyKey: string }[]>`
        SELECT user_id AS "userId", body_key AS "bodyKey"
        FROM app.user_notifications
        WHERE org_id = ${orgId} AND task_id = ${policyTask}
          AND type = 'agent_run_failed'
      `;
      if (refused?.threadId) threads.push(refused.threadId);
      record(
        'native runs: the organization’s content policy refusing a run fails it for good — no retry is armed, and the person who started it is told in the policy’s own words',
        refused?.status === 'failed' &&
          refused.failureCode === 'policy_refused' &&
          refused.armed === null &&
          JSON.stringify(
            policyNotices.map((row) => [row.userId, row.bodyKey]),
          ) === JSON.stringify([[starter, 'agentRunFailedPolicyBody']]),
        `run=${JSON.stringify(refused)} notices=${JSON.stringify(policyNotices)}`,
      );

      // ---- retiring the task takes the transcripts and files with it ------
      const refs = fileRows.map((file) => file.ref);
      releasedRefs.push(...refs);
      await transactSerializable(sql, (tx) =>
        deleteTask(tx, owner, settleTask),
      );
      const afterDelete = {
        thread: await sql<{ n: number }[]>`
          SELECT count(*)::int AS n FROM app.threads WHERE id = ${runThread}
        `,
        run: await sql<{ n: number }[]>`
          SELECT count(*)::int AS n FROM app.project_agent_runs
          WHERE id = ${settle.runId}
        `,
        files: await sql<{ n: number; trashed: number }[]>`
          SELECT count(*)::int AS n,
                 count(*) FILTER (WHERE lifecycle_status = 'trashed')::int
                   AS trashed
          FROM app.file_metadata
          WHERE org_id = ${orgId} AND storage_ref = ANY(${refs})
        `,
        release: await sql<{ refs: string[] }[]>`
          SELECT data -> 'refs' AS refs FROM pgboss.job
          WHERE name = 'knowledge.release_refs'
            AND data ->> 'organizationId' = ${orgId}
            AND data -> 'refs' ?| ${refs}
        `,
      };
      const queued = new Set(afterDelete.release.flatMap((row) => row.refs));
      record(
        'native runs: deleting the task deletes its runs’ transcripts and trashes the files they made, and queues the bytes for release — nothing the run produced outlives its task',
        afterDelete.thread[0]?.n === 0 &&
          afterDelete.run[0]?.n === 0 &&
          afterDelete.files[0]?.n === afterDelete.files[0]?.trashed &&
          refs.every((ref) => queued.has(ref)),
        `thread=${afterDelete.thread[0]?.n} run=${afterDelete.run[0]?.n} files=${JSON.stringify(afterDelete.files)} queued=${queued.size}/${refs.length}`,
      );
    }

    // ---- a native run holds no worker ------------------------------------
    // It names the agent's first worker like every kick does, and works in
    // none: a run of the full workspace started beside it takes that worker,
    // and the end of the native run, a failed one included, keeps none for a
    // retry.
    const beside = await mkRun(await mkTask('Native run beside a worker'), {
      engine: 'native',
      status: 'running',
    });
    const failedBeside = await mkRun(await mkTask('Failed native run'), {
      engine: 'native',
      status: 'running',
    });
    await failAgentRunFromTurn(held, {
      runId: failedBeside.runId,
      execId: failedBeside.execId,
      error: 'the provider fell over',
      failureCode: 'harness_error',
    });
    const needsWorker = await mkRun(await mkTask('Run in the full workspace'), {
      engine: 'harness',
      status: 'queued',
    });
    const claim = await claimAgentWorker(sql, input(needsWorker));
    record(
      'native runs: a run without a workspace holds no worker — a run of the same agent in the full workspace takes the agent’s first worker beside it, running or failed, not a second one [TASK-R37]',
      beside.runId !== '' &&
        claim !== null &&
        'sessionId' in claim &&
        claim.sessionId === `pa-${agentId}` &&
        !claim.moved,
      `claim=${JSON.stringify(claim)} (want worker 1 = pa-${agentId}, not moved)`,
    );

    // ---- Stop -------------------------------------------------------------
    const stopTask = await mkTask('Stopped while working');
    const stopThread = await mkThread();
    await mkGeneration(stopThread, 1_000);
    const stop = await mkRun(stopTask, {
      engine: 'native',
      status: 'running',
      threadId: stopThread,
    });
    const stopped = await cancelAgentRun(sql, {
      organizationId: orgId,
      runId: stop.runId,
      taskId: stopTask,
    });
    const flag = await sql<{ cancel: boolean }[]>`
      SELECT cancel_requested AS cancel FROM app.generations
      WHERE thread_id = ${stopThread}
    `;
    const driveJobs = await jobsOf('task.agent_drive', stop.runId);
    record(
      'native runs: Stop ends the run and flags its turn through its transcript’s generation, as a chat reply’s Stop does — and queues no exec cleanup, there being none',
      stopped &&
        (await runOf(stop.runId))?.status === 'cancelled' &&
        flag.some((row) => row.cancel) &&
        driveJobs.length === 0,
      `cancelled=${stopped} flag=${flag[0]?.cancel} drive jobs=${driveJobs.length}`,
    );

    // ---- the sweeps -------------------------------------------------------
    const lostTask = (title: string) => mkTask(title);
    const noTranscript = await mkRun(await lostTask('Lost: no transcript'), {
      engine: 'native',
      status: 'running',
      updatedAgoMs: 10 * 60_000,
    });
    const endedThread = await mkThread();
    const unsettled = await mkRun(await lostTask('Lost: turn ended'), {
      engine: 'native',
      status: 'running',
      threadId: endedThread,
      updatedAgoMs: 5 * 60_000,
    });
    const silentThread = await mkThread();
    await mkGeneration(silentThread, 15 * 60_000);
    const silent = await mkRun(await lostTask('Lost: heartbeat silent'), {
      engine: 'native',
      status: 'running',
      threadId: silentThread,
      updatedAgoMs: 60_000,
    });
    const liveThread = await mkThread();
    await mkGeneration(liveThread, 1_000);
    const live = await mkRun(await lostTask('Alive: heartbeat fresh'), {
      engine: 'native',
      status: 'running',
      threadId: liveThread,
      updatedAgoMs: 1_000,
    });
    const justEndedThread = await mkThread();
    const justEnded = await mkRun(await lostTask('Alive: turn just ended'), {
      engine: 'native',
      status: 'running',
      threadId: justEndedThread,
      updatedAgoMs: 5_000,
    });
    const strandedTask = await lostTask('Stranded at queued');
    const stranded = await mkRun(strandedTask, {
      engine: 'native',
      status: 'queued',
      updatedAgoMs: 10 * 60_000,
    });

    // The harness's stalled-turn sweep has no exec to ask about for a native
    // run: it must not even examine it.
    await recoverStalledTaskAgentTurns(sql, {
      staleMs: 60_000,
      probe: () => Promise.resolve({ state: 'running' as const }),
    });
    const examined = await sql<{ id: string; checked: number | null }[]>`
      SELECT id, recovery_checked_at_ms::float8 AS checked
      FROM app.project_agent_runs
      WHERE id IN ${sql([noTranscript.runId, unsettled.runId, silent.runId, live.runId])}
    `;
    record(
      'native runs: the harness’s stalled-turn sweep never examines a native run — it has no exec and no op row to ask about',
      examined.length === 4 && examined.every((row) => row.checked === null),
      `examined=${JSON.stringify(examined)}`,
    );

    // A harness run that looks as quiet as a lost native one: the native
    // scan must not read it as lost. (Made after the stalled-turn sweep,
    // which would otherwise resume it.)
    const harnessRunning = await mkRun(await lostTask('A harness run'), {
      engine: 'harness',
      status: 'running',
      updatedAgoMs: 10 * 60_000,
    });
    await silently(() => runTaskAgentWatchdog(held));
    const states = new Map<string, Awaited<ReturnType<typeof runOf>>>();
    for (const [name, run] of Object.entries({
      noTranscript,
      unsettled,
      silent,
      live,
      justEnded,
      harnessRunning,
    })) {
      states.set(name, await runOf(run.runId));
    }
    const silentFlag = await sql<{ cancel: boolean }[]>`
      SELECT cancel_requested AS cancel FROM app.generations
      WHERE thread_id = ${silentThread}
    `;
    const lostFailed = (name: string) => {
      const run = states.get(name);
      return (
        run?.status === 'failed' &&
        run.failureCode === 'turn_crashed' &&
        typeof run.armed === 'number'
      );
    };
    record(
      'native runs: the watchdog fails a native run whose turn is gone — no transcript, a turn that ended without a settle, a heartbeat silent as long as a chat reply’s may be — as interrupted, which retries, and tells a leftover turn to stop; a live turn, a turn that ended seconds ago and a harness run are left alone',
      lostFailed('noTranscript') &&
        lostFailed('unsettled') &&
        lostFailed('silent') &&
        silentFlag.some((row) => row.cancel) &&
        states.get('live')?.status === 'running' &&
        states.get('justEnded')?.status === 'running' &&
        states.get('harnessRunning')?.status === 'running',
      `states=${JSON.stringify([...states].map(([name, run]) => [name, run?.status, run?.failureCode]))} silent flag=${silentFlag[0]?.cancel}`,
    );

    await recoverStuckQueuedTaskAgentRuns(sql, { staleMs: 60_000 });
    const woken = await runOf(stranded.runId);
    const wakeJobs = await sql<{ name: string; execId: string | null }[]>`
      SELECT name, data ->> 'execId' AS "execId" FROM pgboss.job
      WHERE data ->> 'runId' = ${stranded.runId}
        AND name IN ('task.agent_native', 'task.agent_turn')
    `;
    record(
      'native runs: a native run stranded at queued is woken under a rotated exec on the native queue, not the harness’s — whose start would skip it and leave it stranded again',
      woken?.execId !== stranded.execId &&
        wakeJobs.length === 1 &&
        wakeJobs[0]?.name === 'task.agent_native' &&
        wakeJobs[0].execId === woken?.execId,
      `exec ${stranded.execId} -> ${woken?.execId}, jobs=${JSON.stringify(wakeJobs)}`,
    );
  } finally {
    await sql`
      DELETE FROM pgboss.job
      WHERE name IN ('task.agent_turn', 'task.agent_native', 'task.agent_retry',
                     'task.agent_drive')
        AND (data ->> 'runId' IN (SELECT id FROM app.project_agent_runs
                                  WHERE project_id = ${projectId})
             OR data ->> 'taskId' IN (SELECT id FROM app.tasks
                                      WHERE project_id = ${projectId})
             OR data ->> 'expectedRunId' IN (SELECT id FROM app.project_agent_runs
                                             WHERE project_id = ${projectId}))
    `;
    if (releasedRefs.length > 0) {
      await sql`
        DELETE FROM pgboss.job
        WHERE name = 'knowledge.release_refs'
          AND data ->> 'organizationId' = ${orgId}
          AND state = 'created' AND data -> 'refs' ?| ${releasedRefs}
      `;
    }
    await sql`
      DELETE FROM app.user_notifications
      WHERE org_id = ${orgId} AND task_id IN (
        SELECT id FROM app.tasks WHERE project_id = ${projectId})
    `;
    // The transcripts the runs opened go with their runs; the lane's own
    // threads and every file row bound to any of them go here.
    const runThreads = await sql<{ id: string }[]>`
      SELECT thread_id AS id FROM app.project_agent_runs
      WHERE project_id = ${projectId} AND thread_id IS NOT NULL
    `;
    const everyThread = [
      ...new Set([...threads, ...runThreads.map((row) => row.id)]),
    ];
    if (everyThread.length > 0) {
      await sql`
        DELETE FROM app.file_metadata
        WHERE org_id = ${orgId} AND thread_id IN ${sql(everyThread)}
      `;
    }
    // Cascades to the agent, its tasks and their runs.
    await sql`DELETE FROM app.projects WHERE id = ${projectId}`;
    if (everyThread.length > 0) {
      await sql`DELETE FROM app.threads WHERE id IN ${sql(everyThread)}`;
    }
    await sql`DELETE FROM "teamMember" WHERE "teamId" = ${teamId}`;
    await sql`DELETE FROM "team" WHERE "id" = ${teamId}`;
    await sql`DELETE FROM "member" WHERE "userId" IN ${sql(people)}`;
    await sql`DELETE FROM "user" WHERE "id" IN ${sql(people)}`;
  }
}
