/** Real Postgres proof that every run of a project agent that works at the
 * same time as another works in a worker of its own, bounded by the
 * organization's limit of agent workers (`agent-workers.ts`, migration 0167):
 *
 * - two tasks of one agent take two workers (`pa-<agent>`, `pa-<agent>-w2`)
 *   and two slots; the sandbox rows and the board read name each worker;
 * - a third run at a full limit waits for a worker (`org_limit`) — the start
 *   that asked for it can tell so before it claims, the sandbox view counts
 *   it — and no third workspace is opened;
 * - a run that ends gives back its own worker only, and the waiting run
 *   takes that worker (reuse, still no third one);
 * - a task's next run goes back to its previous worker when it is free, and
 *   to another worker when that one is busy;
 * - the schema refuses a second claimed live run on one worker;
 * - a member's runs work in that member's own workers, confined, and a run
 *   whose starter lost the Editor role while it waited moves into the
 *   member's family; an editor's run never lands in a member's worker;
 * - a freed worker goes to the waiting run of the agent with the fewest runs
 *   working, ahead of an older run of a busier agent, and a start that has
 *   not waited leaves that run the slot rather than take it before the
 *   woken run's claim;
 * - reassigning a task withdraws its run while it waits and never launched,
 *   and still refuses while a run works or was just woken;
 * - a run that has not claimed a worker holds none, though its kick or its
 *   wake names worker 1: a burst of starts opens no worker beside a stopped
 *   one, and a task's next run still goes back to its own worker;
 * - a wake restarts a run without a claim stamp an older image's park left
 *   on it, so it never collides with the run that holds that worker now;
 * - migration 0167's columns, CHECK and unique index are in place.
 *
 * The lane drives the turn job's own steps — the claim, the slot reserve or
 * resume, the launch flip, the settle and the release — on hand-inserted
 * runs, in an organization of its own (the limit counts that organization's
 * workers only, at the shipped default of 2). Every turn job its projects
 * enqueue is parked a day ahead, so no worker of the running backend takes
 * one, and no sandbox, provider or model is touched. */
import { randomUUID } from 'node:crypto';

import type { Sql } from 'postgres';

import { SANDBOX_SESSION_LIVE_STATUSES } from '../../core/sandbox/session_constants.ts';
import { standingWorkerSessionId } from '../../core/sandbox/session_naming.test-helpers.ts';
import { memberSessionIdForProjectAgent } from '../../core/sandbox/session_naming.ts';
import { getProjectAuthContext } from '../projects/service.ts';
import {
  countWaitingAgentRuns,
  listSandboxViewsForOrg,
  projectSessionRoom,
  releaseProjectAgentSessionSlot,
  reserveSessionSlot,
  resumeSessionSlot,
  setSessionStatus,
} from '../sandbox/sessions.ts';
import {
  launchAgentRun,
  settleAgentRun,
  wakeOrganizationParkedAgentRun,
} from './agent-runs.ts';
import {
  claimAgentWorker,
  predictWorkerWait,
  type WorkerClaim,
} from './agent-workers.ts';
import {
  holdAgentJobs,
  type LaneCtx,
  type Recorder,
} from './delegated-start.integration.ts';
import { isTaskRunConfined } from './run-authority.ts';
import { assignTask, getTaskOpsIndicators } from './service.ts';

interface RunFacts {
  status: string;
  sessionId: string;
  execId: string;
  claimed: boolean;
  parked: boolean;
  waitingReason: string | null;
  agentId: string;
  taskId: string;
  startedBy: string;
}

/** The SQLSTATE an error carries, else its text. */
function codeOf(error: unknown): string {
  if (error instanceof Error && 'code' in error) return String(error.code);
  return error instanceof Error ? error.message : String(error);
}

export async function checkAgentWorkers(
  sql: Sql,
  _ctx: LaneCtx,
  record: Recorder,
): Promise<void> {
  const suffix = randomUUID().slice(0, 8);
  const orgId = randomUUID();
  const projectId = randomUUID();
  const ada = `workers-ada-${suffix}`;
  const mia = `workers-mia-${suffix}`;
  const scribe = randomUUID();
  const lector = randomUUID();
  const w = (n: number) => standingWorkerSessionId(scribe, n);
  const noTicket = async () => null;
  let rank = 0;

  const insertUser = async (id: string, role: string) => {
    await sql`
      INSERT INTO "user" ("id", "name", "email", "emailVerified",
                          "createdAt", "updatedAt")
      VALUES (${id}, ${`Itest ${role}`}, ${`${id}@example.com`}, true,
              ${new Date()}, ${new Date()})
    `;
    await sql`
      INSERT INTO "member" ("id", "organizationId", "userId", "role",
                            "createdAt")
      VALUES (${`m-${id}`}, ${orgId}, ${id}, ${role}, ${new Date()})
    `;
  };
  const setRole = (id: string, role: string) =>
    sql`UPDATE "member" SET "role" = ${role} WHERE "id" = ${`m-${id}`}`;
  const insertTask = async (
    title: string,
    agentId: string,
    createdBy = ada,
  ): Promise<string> => {
    const taskId = randomUUID();
    rank += 1;
    await sql`
      INSERT INTO app.tasks (id, org_id, project_id, title, status, rank,
        assignee_type, assignee_id, created_by, created_by_type,
        created_at_ms, updated_at_ms)
      VALUES (${taskId}, ${orgId}, ${projectId}, ${title}, 'in_progress',
        ${`w${suffix}${String(rank).padStart(3, '0')}`}, 'agent', ${agentId},
        ${createdBy}, 'user', ${Date.now()}, ${Date.now()})
    `;
    return taskId;
  };
  /** A run as a kick leaves it: queued, on its family's first worker as a
   * provisional session, unclaimed. */
  const kick = async (
    taskId: string,
    agentId: string,
    startedBy = ada,
  ): Promise<string> => {
    const sessionId =
      startedBy === ada
        ? standingWorkerSessionId(agentId, 1)
        : memberSessionIdForProjectAgent(agentId, startedBy);
    const now = Date.now();
    const rows = await sql<{ id: string }[]>`
      INSERT INTO app.project_agent_runs (
        org_id, project_id, task_id, agent_id, exec_id, session_id, status,
        harness, model, trigger, started_by, started_at_ms, deadline_at_ms,
        updated_at_ms
      ) VALUES (
        ${orgId}, ${projectId}, ${taskId}, ${agentId},
        ${`exec-${randomUUID().slice(0, 12)}`}, ${sessionId}, 'queued',
        'claude-code', 'itest-model', 'manual', ${startedBy}, ${now},
        ${now + 12 * 3_600_000}, ${now}
      ) RETURNING id
    `;
    const id = rows[0]?.id;
    if (id === undefined) throw new Error('itest: no run inserted');
    return id;
  };
  const factsOf = async (runId: string): Promise<RunFacts> => {
    const rows = await sql<RunFacts[]>`
      SELECT status, session_id AS "sessionId", exec_id AS "execId",
             session_claimed_at_ms IS NOT NULL AS claimed,
             waiting_for_capacity_at_ms IS NOT NULL AS parked,
             waiting_reason AS "waitingReason", agent_id AS "agentId",
             task_id AS "taskId", started_by AS "startedBy"
      FROM app.project_agent_runs WHERE id = ${runId}
    `;
    const row = rows[0];
    if (row === undefined) throw new Error(`itest: no run ${runId}`);
    return row;
  };
  /** The live session row of one worker, if any. */
  const sessionStatus = async (sessionId: string): Promise<string | null> => {
    const rows = await sql<{ status: string }[]>`
      SELECT status FROM app.sandbox_sessions
      WHERE org_id = ${orgId} AND session_id = ${sessionId}
        AND status = ANY(${[...SANDBOX_SESSION_LIVE_STATUSES]})
      ORDER BY created_at_ms DESC LIMIT 1
    `;
    return rows[0]?.status ?? null;
  };
  /** Slots the organization's agent workers hold now. */
  const inFlight = async () => (await projectSessionRoom(sql, orgId)).inFlight;
  /** What the turn job does for a run: claim its worker, then (when it got
   * one) reserve or resume that worker's slot and launch. */
  const start = async (runId: string): Promise<WorkerClaim | null> => {
    const run = await factsOf(runId);
    const claim = await claimAgentWorker(sql, {
      organizationId: orgId,
      runId,
      execId: run.execId,
    });
    if (claim === null || 'parked' in claim) return claim;
    if ((await sessionStatus(claim.sessionId)) === null) {
      await reserveSessionSlot(sql, {
        organizationId: orgId,
        sessionId: claim.sessionId,
        profile: {},
        ownerType: 'project_agent',
        ownerId: run.agentId,
        createdBy: run.startedBy,
        agentKind: 'claude-code',
      });
      await setSessionStatus(sql, {
        organizationId: orgId,
        sessionId: claim.sessionId,
        status: 'active',
      });
    } else {
      await resumeSessionSlot(sql, {
        organizationId: orgId,
        sessionId: claim.sessionId,
      });
    }
    await launchAgentRun(sql, { runId, execId: run.execId });
    return claim;
  };
  const sessionOfClaim = (claim: WorkerClaim | null) =>
    claim !== null && 'sessionId' in claim
      ? claim.sessionId
      : JSON.stringify(claim);
  /** The run settles and its worker is released, as the host does. */
  const end = async (runId: string) => {
    const run = await factsOf(runId);
    await settleAgentRun(sql, { runId, resultText: 'itest: done' });
    await releaseProjectAgentSessionSlot(
      sql,
      { organizationId: orgId, agentId: run.agentId, sessionId: run.sessionId },
      noTicket,
    );
  };
  /** Every live run of the lane ends — a working one settles, a queued one
   * is cancelled — and every worker stops. Settling, not cancelling, a run
   * that worked keeps its worker free for any task: a worker whose run
   * failed or was cancelled is kept for that run's task a while. */
  const endAll = async () => {
    const now = Date.now();
    await sql`
      UPDATE app.project_agent_runs SET
        status = CASE WHEN status = 'running' THEN 'settled'
          ELSE 'cancelled' END,
        settled_at_ms = ${now}, updated_at_ms = ${now}
      WHERE org_id = ${orgId} AND status IN ('queued', 'running')
    `;
    for (const agentId of [scribe, lector]) {
      await releaseProjectAgentSessionSlot(
        sql,
        { organizationId: orgId, agentId },
        noTicket,
        { wake: false },
      );
    }
  };

  const release = await holdAgentJobs(sql, suffix, [projectId]);
  try {
    await sql`
      INSERT INTO "organization" ("id", "name", "slug", "createdAt")
      VALUES (${orgId}, 'Agent workers', ${`workers-${suffix}`}, now())
    `;
    await insertUser(ada, 'editor');
    await insertUser(mia, 'member');
    await sql`
      INSERT INTO app.projects (id, org_id, name, created_by, created_at_ms,
                                updated_at_ms)
      VALUES (${projectId}, ${orgId}, 'Release work', ${ada}, ${Date.now()},
              ${Date.now()})
    `;
    for (const [id, name] of [
      [scribe, 'Scribe'],
      [lector, 'Lector'],
    ] as const) {
      await sql`
        INSERT INTO app.project_agents (id, org_id, project_id, name, harness,
                                        model, created_by, created_at_ms,
                                        updated_at_ms)
        VALUES (${id}, ${orgId}, ${projectId}, ${name}, 'claude-code',
                'itest-model', ${ada}, ${Date.now()}, ${Date.now()})
      `;
    }
    const auth = await getProjectAuthContext(sql, {
      organizationId: orgId,
      userId: ada,
      role: 'editor',
    });
    const { cap } = await projectSessionRoom(sql, orgId);

    // ---- two tasks, two workers --------------------------------------------
    const releaseNotes = await insertTask('Release notes', scribe);
    const changelog = await insertTask('Changelog', scribe);
    const r1 = await kick(releaseNotes, scribe);
    const c1 = await start(r1);
    const r2 = await kick(changelog, scribe);
    const c2 = await start(r2);
    const views = await listSandboxViewsForOrg(sql, orgId);
    const workerRows = views
      .filter((view) => view.ownerId === scribe)
      .map(
        (view) =>
          `${view.sessionId === w(1) ? 'w1' : view.sessionId === w(2) ? 'w2' : view.sessionId}:${view.worker?.number}/${view.worker?.scope}`,
      )
      .toSorted();
    const twoSlots = await inFlight();
    record(
      'agent workers: two tasks of one agent work at once in two workers, each holding a slot, and the Sandboxes rows name worker 1 and worker 2',
      cap === 2 &&
        sessionOfClaim(c1) === w(1) &&
        sessionOfClaim(c2) === w(2) &&
        (await factsOf(r1)).status === 'running' &&
        (await factsOf(r2)).status === 'running' &&
        twoSlots === 2 &&
        JSON.stringify(workerRows) ===
          JSON.stringify(['w1:1/agent', 'w2:2/agent']),
      `cap=${cap} (want the default 2) r1=${sessionOfClaim(c1)} r2=${sessionOfClaim(c2)} slots=${twoSlots} rows=${JSON.stringify(workerRows)}`,
    );

    // ---- a third run at a full limit waits; no third workspace -------------
    const pressKit = await insertTask('Press kit', scribe);
    const r3 = await kick(pressKit, scribe);
    const predicted = await predictWorkerWait(sql, {
      organizationId: orgId,
      runId: r3,
    });
    const c3 = await start(r3);
    const parked = await factsOf(r3);
    const counts = await countWaitingAgentRuns(sql, orgId);
    const board = await getTaskOpsIndicators(sql, auth, projectId);
    const boardRuns = Object.fromEntries(
      board.runs.map((run) => [
        run.runId,
        `${run.status}/${run.waiting ? `waiting:${run.waitingReason}` : `w${run.worker}`}`,
      ]),
    );
    record(
      'agent workers: a third run at a full limit waits for a worker — told before its claim, parked as org_limit on its family’s first worker with no claim, counted on the Sandboxes page and shown on the board — and no third workspace is opened',
      predicted === 'org_limit' &&
        JSON.stringify(c3) === JSON.stringify({ parked: 'org_limit' }) &&
        parked.status === 'queued' &&
        parked.parked &&
        parked.waitingReason === 'org_limit' &&
        !parked.claimed &&
        parked.sessionId === w(1) &&
        (await sessionStatus(w(3))) === null &&
        counts.total === 1 &&
        counts.byReason.org_limit === 1 &&
        boardRuns[r1] === 'running/w1' &&
        boardRuns[r2] === 'running/w2' &&
        boardRuns[r3] === 'queued/waiting:org_limit' &&
        !board.runsTruncated,
      `predicted=${predicted} claim=${JSON.stringify(c3)} run=${JSON.stringify(parked)} w3=${await sessionStatus(w(3))} counts=${JSON.stringify(counts)} board=${JSON.stringify(boardRuns)}`,
    );

    // ---- a run that ends frees its own worker; the waiting run takes it ----
    await end(r1);
    const w1After = await sessionStatus(w(1));
    const w2After = await sessionStatus(w(2));
    const woken = await factsOf(r3);
    const c3b = await start(r3);
    const claimed3 = await factsOf(r3);
    record(
      'agent workers: a run that ends gives back its own worker at once while the agent’s other worker keeps working, and the waiting run is woken — keeping its reason, its place in line, until its claim clears it — and takes the freed worker, reused, no third one opened',
      w1After === 'stopped' &&
        w2After === 'active' &&
        !woken.parked &&
        !woken.claimed &&
        woken.waitingReason === 'org_limit' &&
        sessionOfClaim(c3b) === w(1) &&
        claimed3.status === 'running' &&
        claimed3.waitingReason === null &&
        (await sessionStatus(w(3))) === null &&
        (await inFlight()) === 2,
      `w1=${w1After} (want stopped) w2=${w2After} (want active) woken=${JSON.stringify(woken)} claim=${sessionOfClaim(c3b)} w3=${await sessionStatus(w(3))}`,
    );

    // ---- a task's next run goes back to its worker when free ---------------
    await end(r2);
    await end(r3);
    const r2b = await kick(changelog, scribe);
    const c2b = await start(r2b);
    const launchPlan = await insertTask('Launch plan', scribe);
    const r4 = await kick(launchPlan, scribe);
    const c4 = await start(r4);
    await end(r2b);
    // Release notes last worked in worker 1, which Launch plan now holds.
    const r1b = await kick(releaseNotes, scribe);
    const c1b = await start(r1b);
    record(
      'agent workers: a task’s next run goes back to its previous worker when it is free (Changelog to worker 2, past a free worker 1), and to another free worker when its own is busy (Release notes to worker 2 while worker 1 works Launch plan)',
      sessionOfClaim(c2b) === w(2) &&
        sessionOfClaim(c4) === w(1) &&
        sessionOfClaim(c1b) === w(2),
      `changelog=${sessionOfClaim(c2b)} launch plan=${sessionOfClaim(c4)} release notes=${sessionOfClaim(c1b)}`,
    );
    await end(r4);
    await end(r1b);

    // ---- the schema holds one run per worker -------------------------------
    {
      const held = await insertTask('Holds a worker', scribe);
      const other = await insertTask('Wants the same worker', scribe);
      const holder = await kick(held, scribe);
      const holderClaim = await start(holder);
      const intruder = await kick(other, scribe);
      let refusal = 'committed';
      try {
        await sql`
          UPDATE app.project_agent_runs
          SET session_id = ${sessionOfClaim(holderClaim)},
              session_claimed_at_ms = ${Date.now()}
          WHERE id = ${intruder}
        `;
      } catch (error) {
        refusal = codeOf(error);
      }
      record(
        'agent workers: the schema refuses a second claimed live run on one worker (23505, project_agent_runs_one_per_worker)',
        refusal === '23505',
        `refusal=${refusal} holder=${sessionOfClaim(holderClaim)}`,
      );
      await endAll();
    }

    // ---- a member's runs work in the member's own workers -----------------
    {
      const own1 = await insertTask('Mia’s brief', scribe, mia);
      const own2 = await insertTask('Mia’s summary', scribe, mia);
      const rm1 = await kick(own1, scribe, mia);
      const cm1 = await start(rm1);
      const rm2 = await kick(own2, scribe, mia);
      const cm2 = await start(rm2);
      const memberBase = memberSessionIdForProjectAgent(scribe, mia);
      const confined = await Promise.all(
        [rm1, rm2].map(async (runId) => {
          const run = await factsOf(runId);
          return isTaskRunConfined(sql, {
            organizationId: orgId,
            projectId,
            agentId: scribe,
            sessionId: run.sessionId,
            startedBy: run.startedBy,
          });
        }),
      );
      // Ada's run finds every slot held by Mia's workers: it waits, in the
      // standing family, and takes a standing worker once one frees.
      const editorTask = await insertTask('Editor work', scribe);
      const ra = await kick(editorTask, scribe);
      const ca = await start(ra);
      await end(rm1);
      const caAfter = await start(ra);
      record(
        'agent workers: a member’s two runs work at once in the member’s own workers 1 and 2, both confined, and an editor’s run never lands in a member’s worker — it waits, then takes a standing worker',
        sessionOfClaim(cm1) === memberBase &&
          sessionOfClaim(cm2) === `${memberBase}-w2` &&
          confined.every(Boolean) &&
          JSON.stringify(ca) === JSON.stringify({ parked: 'org_limit' }) &&
          sessionOfClaim(caAfter) === w(1),
        `member=${sessionOfClaim(cm1)},${sessionOfClaim(cm2)} (want ${memberBase} and -w2) confined=${JSON.stringify(confined)} editor first=${JSON.stringify(ca)} then=${sessionOfClaim(caAfter)}`,
      );
      await endAll();

      // A run whose starter lost the Editor role while it waited.
      const demotedTask = await insertTask('Started, then demoted', scribe);
      const rd = await kick(demotedTask, scribe);
      await setRole(ada, 'member');
      const cd = await start(rd);
      const demoted = await factsOf(rd);
      const demotedConfined = await isTaskRunConfined(sql, {
        organizationId: orgId,
        projectId,
        agentId: scribe,
        sessionId: demoted.sessionId,
        startedBy: ada,
      });
      await setRole(ada, 'editor');
      record(
        'agent workers: a run whose starter lost the Editor role before it started moves into that member’s own workers and runs confined',
        sessionOfClaim(cd) === memberSessionIdForProjectAgent(scribe, ada) &&
          demotedConfined,
        `claim=${sessionOfClaim(cd)} confined=${demotedConfined}`,
      );
      await endAll();
    }

    // ---- a freed worker goes to the agent with the fewest runs working ----
    {
      const busy1 = await insertTask('Scribe busy 1', scribe);
      const busy2 = await insertTask('Scribe busy 2', scribe);
      const queue1 = await insertTask('Scribe queued 1', scribe);
      const queue2 = await insertTask('Scribe queued 2', scribe);
      const lectorTask = await insertTask('Lector’s only task', lector);
      const rb1 = await kick(busy1, scribe);
      await start(rb1);
      const rb2 = await kick(busy2, scribe);
      await start(rb2);
      const rq1 = await kick(queue1, scribe);
      const cq1 = await start(rq1);
      const rq2 = await kick(queue2, scribe);
      const cq2 = await start(rq2);
      const rl = await kick(lectorTask, lector);
      const cl = await start(rl);
      await end(rb1);
      const lectorAfter = await factsOf(rl);
      const scribeQueued = await Promise.all([rq1, rq2].map(factsOf));
      record(
        'agent workers: a freed worker wakes the waiting run of the agent with the fewest runs working (Lector), ahead of the older waiting runs of the busier agent (Scribe)',
        JSON.stringify([cq1, cq2, cl]) ===
          JSON.stringify([
            { parked: 'org_limit' },
            { parked: 'org_limit' },
            { parked: 'org_limit' },
          ]) &&
          !lectorAfter.parked &&
          lectorAfter.status === 'queued' &&
          scribeQueued.every((run) => run.parked),
        `parks=${JSON.stringify([cq1, cq2, cl])} lector=${JSON.stringify(lectorAfter)} scribe queued=${JSON.stringify(scribeQueued.map((run) => run.parked))}`,
      );

      // ---- reassigning withdraws a run that waits and never launched -----
      const change = async (taskId: string, agentId: string) => {
        try {
          await sql.begin((tx) =>
            assignTask(tx, auth, {
              taskId,
              assigneeType: 'agent',
              assigneeId: agentId,
            }),
          );
          return 'assigned';
        } catch (error) {
          return codeOf(error);
        }
      };
      const waitingHanded = await change(queue1, lector);
      const withdrawn = await factsOf(rq1);
      const assignee = await sql<{ assigneeId: string | null }[]>`
        SELECT assignee_id AS "assigneeId" FROM app.tasks WHERE id = ${queue1}
      `;
      const workingHanded = await change(busy2, lector);
      const wokenHanded = await change(lectorTask, scribe);
      record(
        'agent workers: reassigning a task withdraws its run that waits for a worker and never launched; a task whose run works, or was just woken to start, still refuses (TASK_HAS_LIVE_RUN)',
        waitingHanded === 'assigned' &&
          withdrawn.status === 'cancelled' &&
          assignee[0]?.assigneeId === lector &&
          workingHanded === 'TASK_HAS_LIVE_RUN' &&
          (await factsOf(rb2)).status === 'running' &&
          wokenHanded === 'TASK_HAS_LIVE_RUN' &&
          (await factsOf(rl)).status === 'queued',
        `waiting=${waitingHanded}/${withdrawn.status} assignee=${assignee[0]?.assigneeId === lector ? 'Lector' : assignee[0]?.assigneeId} working=${workingHanded} woken=${wokenHanded}`,
      );
      await endAll();
    }

    // ---- a start that has not waited leaves a woken run its room ----------
    {
      // Scribe works two tasks and fills the limit; Lector's run waits.
      // "Scribe frees one" ends: its worker stops, and the wake hands the
      // slot to Lector's run, the agent with no run working. Ada starts
      // Scribe on "Press kit" before Lector's run claims: Scribe's stopped
      // worker is free, but starting it would take Lector's slot, so Press
      // kit waits behind Lector's run, which then takes the slot.
      const freesOne = await kick(
        await insertTask('Scribe frees one', scribe),
        scribe,
      );
      await start(freesOne);
      const keepsOne = await kick(
        await insertTask('Scribe keeps one', scribe),
        scribe,
      );
      await start(keepsOne);
      const lectorRun = await kick(
        await insertTask('Lector waits', lector),
        lector,
      );
      const lectorParked = await start(lectorRun);
      await end(freesOne);
      const lectorWoken = await factsOf(lectorRun);
      const pressKitTask = await insertTask('Press kit', scribe);
      const pressKitRun = await kick(pressKitTask, scribe);
      const pressKitPredicted = await predictWorkerWait(sql, {
        organizationId: orgId,
        runId: pressKitRun,
      });
      const pressKitClaim = await start(pressKitRun);
      const lectorClaim = await start(lectorRun);
      const pressKitAfter = await factsOf(pressKitRun);
      record(
        'agent workers: a start that has not waited leaves the slot a wake handed a waiting run — it waits behind the woken run (told so before its claim), which then takes the slot; no third workspace opens',
        JSON.stringify(lectorParked) ===
          JSON.stringify({ parked: 'org_limit' }) &&
          !lectorWoken.parked &&
          lectorWoken.status === 'queued' &&
          pressKitPredicted === 'org_limit' &&
          JSON.stringify(pressKitClaim) ===
            JSON.stringify({ parked: 'org_limit' }) &&
          pressKitAfter.parked &&
          sessionOfClaim(lectorClaim) === standingWorkerSessionId(lector, 1) &&
          (await factsOf(lectorRun)).status === 'running' &&
          (await sessionStatus(w(1))) === 'stopped' &&
          (await inFlight()) === 2,
        `lector=${JSON.stringify(lectorParked)} woken=${JSON.stringify(lectorWoken)} press kit predicted=${pressKitPredicted} claim=${JSON.stringify(pressKitClaim)} then lector=${sessionOfClaim(lectorClaim)} w1=${await sessionStatus(w(1))} slots=${await inFlight()}`,
      );
      await endAll();
    }

    // ---- a run that has not claimed a worker holds none -------------------
    {
      // Three starts kicked before any of them claims, every worker
      // stopped: each kick names worker 1, yet the claims take worker 1 and
      // worker 2 and the third waits — no worker 3 opens while worker 1
      // stays idle.
      const burst: string[] = [];
      for (const title of ['Burst 1', 'Burst 2', 'Burst 3']) {
        burst.push(await insertTask(title, scribe));
      }
      const kicked: string[] = [];
      for (const taskId of burst) kicked.push(await kick(taskId, scribe));
      const claims: Array<WorkerClaim | null> = [];
      for (const runId of kicked) claims.push(await start(runId));
      record(
        'agent workers: three starts kicked before any claims take worker 1 and worker 2 and the third waits, though every kick names worker 1 — no worker 3 opens',
        sessionOfClaim(claims[0] ?? null) === w(1) &&
          sessionOfClaim(claims[1] ?? null) === w(2) &&
          JSON.stringify(claims[2]) ===
            JSON.stringify({ parked: 'org_limit' }) &&
          (await sessionStatus(w(3))) === null,
        `claims=${claims.map((claim) => sessionOfClaim(claim)).join(',')} w3=${await sessionStatus(w(3))}`,
      );
      await endAll();

      // Burst 1 last worked in worker 1. Another task is kicked first and
      // names worker 1 too; Burst 1's next run claims before it and goes
      // back to worker 1, and the other task takes worker 2.
      const sideTask = await insertTask('Kicked a moment earlier', scribe);
      const side = await kick(sideTask, scribe);
      const followUp = await kick(burst[0] ?? '', scribe);
      const followUpClaim = await start(followUp);
      const sideClaim = await start(side);
      record(
        'agent workers: a task’s next run goes back to its free worker though another task’s unclaimed kick names it, and that task takes another worker',
        sessionOfClaim(followUpClaim) === w(1) &&
          sessionOfClaim(sideClaim) === w(2),
        `follow-up=${sessionOfClaim(followUpClaim)} (want w1) other=${sessionOfClaim(sideClaim)} (want w2)`,
      );

      // Worker 1 is pinned, so it stays up when its run ends; a run that
      // waited is woken into the family (naming worker 1) when it does.
      // Burst 1's next run claims before the woken run and still takes its
      // own worker, which needs no slot.
      await sql`
        UPDATE app.sandbox_sessions SET pinned = true
        WHERE org_id = ${orgId} AND session_id = ${w(1)}
      `;
      const waitingTask = await insertTask('Waits for a worker', scribe);
      const waiting = await kick(waitingTask, scribe);
      const waitingClaim = await start(waiting);
      await end(followUp);
      const wokenRun = await factsOf(waiting);
      const again = await kick(burst[0] ?? '', scribe);
      const againClaim = await start(again);
      record(
        'agent workers: a task’s next run takes its own worker, still up, while a woken run that has not claimed yet names that worker',
        JSON.stringify(waitingClaim) ===
          JSON.stringify({ parked: 'org_limit' }) &&
          !wokenRun.parked &&
          wokenRun.sessionId === w(1) &&
          !wokenRun.claimed &&
          sessionOfClaim(againClaim) === w(1) &&
          (await sessionStatus(w(3))) === null,
        `waiting=${JSON.stringify(waitingClaim)} woken=${JSON.stringify(wokenRun)} next=${sessionOfClaim(againClaim)} (want w1) w3=${await sessionStatus(w(3))}`,
      );
      await sql`
        UPDATE app.sandbox_sessions SET pinned = false
        WHERE org_id = ${orgId} AND session_id = ${w(1)}
      `;
      await endAll();
    }

    // ---- a wake restarts a run without the claim an older park left -------
    {
      const first = await kick(
        await insertTask('Works worker 1', scribe),
        scribe,
      );
      await start(first);
      const second = await kick(
        await insertTask('Works worker 2', scribe),
        scribe,
      );
      const secondClaim = await start(second);
      // Parked by an image that keeps the claim stamp: still naming worker
      // 2, which "Works worker 2" has claimed since.
      const stale = await kick(
        await insertTask('Parked long ago', scribe),
        scribe,
      );
      await sql`
        UPDATE app.project_agent_runs SET
          session_id = ${w(2)}, session_claimed_at_ms = ${Date.now()},
          waiting_for_capacity_at_ms = ${Date.now()}
        WHERE id = ${stale}
      `;
      let wake = 'woke nothing';
      try {
        wake = `woke ${await wakeOrganizationParkedAgentRun(sql, orgId)}`;
      } catch (error) {
        wake = codeOf(error);
      }
      const restarted = await factsOf(stale);
      record(
        'agent workers: a wake restarts a run an older image parked with its claim stamp on a worker another run holds — without the stamp, naming its family’s first worker, and with no unique-index refusal',
        sessionOfClaim(secondClaim) === w(2) &&
          wake === 'woke 1' &&
          !restarted.parked &&
          !restarted.claimed &&
          restarted.sessionId === w(1),
        `wake=${wake} run=${JSON.stringify(restarted)}`,
      );
      await endAll();
    }

    // ---- migration 0167 ----------------------------------------------------
    {
      const columns = await sql<{ name: string; nullable: string }[]>`
        SELECT column_name AS name, is_nullable AS nullable
        FROM information_schema.columns
        WHERE table_schema = 'app' AND table_name = 'project_agent_runs'
          AND column_name IN ('session_claimed_at_ms', 'waiting_reason')
        ORDER BY column_name
      `;
      const index = await sql<{ valid: boolean; definition: string }[]>`
        SELECT i.indisvalid AS valid, pg_get_indexdef(i.indexrelid) AS definition
        FROM pg_index i
        WHERE i.indexrelid = to_regclass('app.project_agent_runs_one_per_worker')
      `;
      const checkTask = await insertTask('Check constraint', scribe);
      const checkRun = await kick(checkTask, scribe);
      let checked = 'committed';
      try {
        await sql`
          UPDATE app.project_agent_runs SET waiting_reason = 'tired'
          WHERE id = ${checkRun}
        `;
      } catch (error) {
        checked = codeOf(error);
      }
      record(
        'agent workers: migration 0167 adds the nullable claim and reason columns, a CHECK on the reason and a valid unique index over claimed live runs',
        JSON.stringify(columns) ===
          JSON.stringify([
            { name: 'session_claimed_at_ms', nullable: 'YES' },
            { name: 'waiting_reason', nullable: 'YES' },
          ]) &&
          index[0] !== undefined &&
          index[0].valid &&
          /UNIQUE/.test(index[0].definition) &&
          /session_claimed_at_ms IS NOT NULL/.test(index[0].definition) &&
          checked === '23514',
        `columns=${JSON.stringify(columns)} index=${JSON.stringify(index)} check=${checked}`,
      );
      await endAll();
    }
  } finally {
    await release();
    await sql`DELETE FROM app.projects WHERE id = ${projectId}`;
    await sql`DELETE FROM app.sandbox_sessions WHERE org_id = ${orgId}`;
    for (const id of [ada, mia]) {
      await sql`DELETE FROM "member" WHERE "id" = ${`m-${id}`}`;
      await sql`DELETE FROM "user" WHERE "id" = ${id}`;
    }
    await sql`DELETE FROM "organization" WHERE "id" = ${orgId}`;
  }
}
