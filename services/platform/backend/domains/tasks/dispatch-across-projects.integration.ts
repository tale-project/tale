/**
 * Real PostgreSQL proof of a dispatch that serves another project's board:
 * Development's pool (the Coder) and its Reviewer work Billing's ready
 * tasks. The lane saves the dispatch through the save's own checks, runs
 * passes against a stand-in host, assigns and locks agents across the two
 * boards, routes a review, judges people who edit only one of the two
 * projects, takes the served board away twice — by a lost right and by
 * archiving it — and deletes the Coder. Every agent turn, retry, park wake and
 * dispatch pass the two projects enqueue is held a day ahead
 * (`holdAgentJobs`), so the harness's worker launches nothing and every pass
 * is the lane's own.
 */
import { randomUUID } from 'node:crypto';

import { transactSerializable } from '@tale/shared/db/serializable';
import type { ProjectDispatch } from '@tale/shared/schemas/project-dispatch';
import type { Sql } from 'postgres';

import {
  memberSessionIdForProjectAgent,
  standingSessionIdForProjectAgent,
} from '../../core/sandbox/session_naming.ts';
import { deleteProjectAgent, loadProjectOrThrow } from '../projects/service.ts';
import type { ProjectAuthContext } from '../projects/service.ts';
import { holdAgentJobs } from './delegated-start.integration.ts';
import {
  checkProjectDispatch,
  saveProjectDispatch,
} from './dispatch-config.ts';
import { runDispatchPass, type HostVerdict } from './dispatch-pass.ts';
import {
  agentReachesProject,
  agentsServingProject,
  dispatchesServing,
} from './dispatch-reach.ts';
import {
  readAgentsServingProject,
  readProjectDispatchStatus,
} from './dispatch-readback.ts';
import { raiseAgentWorkers } from './dispatch.integration.ts';
import { TaskError } from './errors.ts';
import { resolveTaskReviewer } from './reviews.ts';
import {
  dispatchMayActInProject,
  isTaskRunConfined,
  sessionIdForAgentRun,
} from './run-authority.ts';
import { snapshotRunInstructions } from './run-instructions.ts';
import { lockAgentForStart } from './run-start.ts';
import {
  assertAssigneeValid,
  loadTaskOrThrow,
  startTaskAgentRunManual,
} from './service.ts';

const ADMIT: HostVerdict = {
  admitted: true,
  retryAfterMs: null,
  reason: null,
  evidence: { stand_in: 'admit' },
};

export async function checkDispatchAcrossProjects(
  sql: Sql,
  ctx: { orgId: string; userId: string },
  record: (name: string, ok: boolean, detail: string) => void,
): Promise<void> {
  const { orgId, userId } = ctx;
  const suffix = randomUUID().slice(0, 8);
  const development = randomUUID();
  const billing = randomUUID();
  const agents = {
    coder: randomUUID(),
    reviewer: randomUUID(),
    reporter: randomUUID(),
    auditor: randomUUID(),
  };
  const tasks = {
    importer: randomUUID(),
    invoices: randomUUID(),
    releaseNotes: randomUUID(),
  };
  const model = `itest-across-${suffix}`;
  const now = Date.now();
  const release = await holdAgentJobs(
    sql,
    `across_${suffix}`,
    [development, billing],
    { extraQueues: ['tasks.dispatch_project', 'task.agent_park_wake'] },
  );
  const owner: ProjectAuthContext = {
    organizationId: orgId,
    userId,
    role: 'owner',
    teamIds: [],
  };
  const restoreQuota = await raiseAgentWorkers(sql, orgId, 10);
  // People who edit one of the two projects only (step 8): Bea, in Billing's
  // team, and Dan, in Development's while it is shared with that team alone.
  const billingTeam = `itest-billing-team-${suffix}`;
  const devTeam = `itest-dev-team-${suffix}`;
  const bea = `itest-bea-${suffix}`;
  const dan = `itest-dan-${suffix}`;
  try {
    // Billing is shared with one team only: an editor outside it may not
    // edit it.
    await sql`
      INSERT INTO app.projects (id, org_id, name, key, instructions,
        created_by, created_at_ms, updated_at_ms)
      VALUES (${development}, ${orgId}, 'Development', ${`DEV-${suffix}`},
        'Open a draft pull request for every change.', ${userId}, ${now}, ${now})
    `;
    await sql`
      INSERT INTO app.projects (id, org_id, name, key, instructions, team_ids,
        created_by, created_at_ms, updated_at_ms)
      VALUES (${billing}, ${orgId}, 'Billing', ${`BIL-${suffix}`},
        'Every task names its customer.', ${[billingTeam]}, ${userId},
        ${now}, ${now})
    `;
    const insertAgent = async (args: {
      id: string;
      projectId: string;
      name: string;
      tools: string[];
    }) => {
      await sql`
        INSERT INTO app.project_agents (id, org_id, project_id, name, harness,
          model, tools, created_by, created_at_ms, updated_at_ms)
        VALUES (${args.id}, ${orgId}, ${args.projectId}, ${args.name}, 'codex',
          ${model}, ${args.tools}, ${userId}, ${now}, ${now})
      `;
    };
    await insertAgent({
      id: agents.coder,
      projectId: development,
      name: 'Coder',
      tools: ['task_comment'],
    });
    await insertAgent({
      id: agents.reviewer,
      projectId: development,
      name: 'Reviewer',
      tools: ['task_find', 'task_get', 'task_review'],
    });
    await insertAgent({
      id: agents.reporter,
      projectId: development,
      name: 'Reporter',
      tools: ['task_comment'],
    });
    await insertAgent({
      id: agents.auditor,
      projectId: billing,
      name: 'Auditor',
      tools: ['task_find', 'task_get', 'task_review'],
    });
    // Billing's own default reviewer: the dispatch's reviewer goes first.
    await sql`
      UPDATE app.projects SET default_task_reviewer_agent_id = ${agents.auditor}
      WHERE id = ${billing}
    `;
    const insertTask = async (args: {
      id: string;
      projectId: string;
      title: string;
      priority: string;
      rank: string;
    }) => {
      await sql`
        INSERT INTO app.tasks (id, org_id, project_id, title, status, priority,
          rank, created_by, created_by_type, created_at_ms, updated_at_ms)
        VALUES (${args.id}, ${orgId}, ${args.projectId}, ${args.title}, 'todo',
          ${args.priority}, ${args.rank}, ${userId}, 'user', ${now}, ${now})
      `;
    };
    await insertTask({
      id: tasks.importer,
      projectId: billing,
      title: 'Fix the importer',
      priority: 'p0',
      rank: 'a',
    });
    await insertTask({
      id: tasks.invoices,
      projectId: billing,
      title: 'Archive old invoices',
      priority: 'p3',
      rank: 'b',
    });
    await insertTask({
      id: tasks.releaseNotes,
      projectId: development,
      title: 'Release notes',
      priority: 'p2',
      rank: 'a',
    });

    const dispatch: ProjectDispatch = {
      enabled: true,
      agents: [agents.coder],
      maxConcurrentRuns: 1,
      perAgentConcurrency: 1,
      statuses: ['todo'],
      assignment: 'pool',
      admission: { preset: 'default', startSpacingSeconds: 0 },
      sources: [{ projectId: billing }],
      reviewers: [agents.reviewer],
    };

    // 1. Serving Billing needs the right to edit it: an editor outside its
    // team is refused at the source, the owner saves it.
    const outsider: ProjectAuthContext = {
      organizationId: orgId,
      userId: `itest-editor-${suffix}`,
      role: 'editor',
      teamIds: [],
    };
    const refused = await checkProjectDispatch(sql, {
      organizationId: orgId,
      projectId: development,
      dispatch,
      auth: outsider,
    });
    const accepted = await checkProjectDispatch(sql, {
      organizationId: orgId,
      projectId: development,
      dispatch,
      auth: owner,
    });
    const own = await checkProjectDispatch(sql, {
      organizationId: orgId,
      projectId: development,
      dispatch: { ...dispatch, sources: [{ projectId: development }] },
      auth: owner,
    });
    await transactSerializable(sql, (tx) =>
      saveProjectDispatch(tx, owner, {
        projectId: development,
        dispatch,
        expectedHash: null,
      }),
    );
    record(
      'dispatch across projects: a dispatch serves another board only when its writer may edit that board [TASK-R70]',
      refused.length === 1 &&
        refused[0]?.path === 'sources.0.projectId' &&
        accepted.length === 0 &&
        own.some((issue) => issue.path === 'sources.0.projectId'),
      `refused=${JSON.stringify(refused)} accepted=${JSON.stringify(accepted)} own=${JSON.stringify(own)}`,
    );

    const pass = () =>
      runDispatchPass(
        sql,
        {
          organizationId: orgId,
          projectId: development,
          trigger: 'manual',
        },
        { askHost: () => Promise.resolve(ADMIT) },
      );
    const liveRuns = () =>
      sql<
        {
          id: string;
          execId: string;
          taskId: string;
          agentId: string;
          projectId: string;
          agentProjectId: string | null;
          startedBy: string;
        }[]
      >`
        SELECT id, exec_id AS "execId", task_id AS "taskId",
               agent_id AS "agentId", project_id AS "projectId",
               agent_project_id AS "agentProjectId",
               started_by AS "startedBy"
        FROM app.project_agent_runs
        WHERE project_id = ANY(${[development, billing]})
          AND status IN ('queued', 'running')
      `;

    // 2. One order across both boards: Billing's p0 task goes before
    // Development's p2 one, and the run is Billing's, recording the Coder's
    // own project.
    const first = await pass();
    const afterFirst = await liveRuns();
    const importerRun = afterFirst.find((run) => run.taskId === tasks.importer);
    const importer = await loadTaskOrThrow(sql, tasks.importer, orgId);
    record(
      'dispatch across projects: one pass ranks the ready work of every board it serves in one order [TASK-R71]',
      first !== null &&
        first.started.length === 1 &&
        first.started[0]?.taskId === tasks.importer &&
        afterFirst.length === 1 &&
        importerRun?.agentId === agents.coder &&
        importerRun.startedBy === `dispatch:${development}` &&
        importer.assigneeId === agents.coder &&
        importer.status === 'in_progress',
      `first=${JSON.stringify(first)} runs=${JSON.stringify(afterFirst)} importer=${JSON.stringify({ assigneeId: importer.assigneeId, status: importer.status })}`,
    );
    record(
      "dispatch across projects: a run on another board belongs to the task's project and records the agent's own [TASK-R74]",
      importerRun?.projectId === billing &&
        importerRun.agentProjectId === development,
      `run=${JSON.stringify(importerRun)}`,
    );

    // 3. The Coder's run on Billing counts against its limit: the next pass
    // starts nothing on Development.
    const second = await pass();
    record(
      "dispatch across projects: an agent's runs on every board count against its limit and the pool's [TASK-R71]",
      second !== null &&
        second.started.length === 0 &&
        (await liveRuns()).length === 1,
      `second=${JSON.stringify(second)}`,
    );

    // 4. The run's turn opens with both projects' instructions, and records
    // the digest of each.
    if (importerRun === undefined)
      throw new Error('itest: importer run missing');
    const handed = await snapshotRunInstructions(sql, {
      organizationId: orgId,
      runId: importerRun.id,
      taskId: tasks.importer,
      execId: importerRun.execId,
      agentInstructions: null,
    });
    record(
      "dispatch across projects: a run on another board follows both projects' instructions, each on its own ground [TASK-R74]",
      handed.projectBlock !== null &&
        handed.projectBlock.includes('Every task names its customer.') &&
        handed.projectBlock.includes(
          'Open a draft pull request for every change.',
        ) &&
        handed.projectBlock.indexOf('Every task names') <
          handed.projectBlock.indexOf('Open a draft') &&
        typeof handed.snapshot.project === 'string' &&
        typeof handed.snapshot.agentProject === 'string',
      `block=${JSON.stringify(handed.projectBlock)} snapshot=${JSON.stringify(handed.snapshot)}`,
    );

    // 5. Billing's tasks take the dispatch's agents as assignees and starts;
    // the Reporter, outside the dispatch, is refused.
    const billingProject = await loadProjectOrThrow(sql, billing);
    const assignOutcome = async (agentId: string) => {
      try {
        await transactSerializable(sql, (tx) =>
          assertAssigneeValid(tx, {
            project: billingProject,
            auth: { organizationId: orgId, userId },
            assignee: { assigneeType: 'agent', assigneeId: agentId },
          }),
        );
        return 'accepted';
      } catch (error) {
        if (error instanceof TaskError) return error.code;
        throw error;
      }
    };
    const lockOutcome = (agentId: string) =>
      transactSerializable(sql, async (tx) => {
        const locked = await lockAgentForStart(tx, {
          organizationId: orgId,
          agentId,
          projectId: billing,
        });
        return locked?.projectId ?? null;
      });
    const coderAssigned = await assignOutcome(agents.coder);
    const reviewerAssigned = await assignOutcome(agents.reviewer);
    const reporterAssigned = await assignOutcome(agents.reporter);
    const coderLocked = await lockOutcome(agents.coder);
    const reporterLocked = await lockOutcome(agents.reporter);
    record(
      'dispatch across projects: the agents of a dispatch are assigned and started on the boards it serves, and no other agent is [TASK-R73]',
      coderAssigned === 'accepted' &&
        reviewerAssigned === 'accepted' &&
        reporterAssigned === 'AGENT_NOT_ALLOWED_IN_PROJECT' &&
        coderLocked === development &&
        reporterLocked === null,
      `assigned=${JSON.stringify({ coderAssigned, reviewerAssigned, reporterAssigned })} locked=${JSON.stringify({ coderLocked, reporterLocked })}`,
    );

    // 6. The Coder's work on Billing goes to Development's Reviewer, ahead
    // of Billing's own default reviewer; a task that names its reviewer
    // keeps it.
    const routed = await resolveTaskReviewer(sql, importer);
    const named = await resolveTaskReviewer(sql, {
      ...importer,
      reviewerAgentId: agents.auditor,
    });
    record(
      "dispatch across projects: a dispatch's reviewers review its pool's work on every board it serves [TASK-R75]",
      routed?.kind === 'agent' &&
        routed.agentId === agents.reviewer &&
        named?.kind === 'agent' &&
        named.agentId === agents.auditor,
      `routed=${JSON.stringify(routed)} named=${JSON.stringify(named)}`,
    );

    // 7. Billing names who serves it and the agents put to work there.
    const servedBy = await dispatchesServing(sql, {
      organizationId: orgId,
      projectId: billing,
    });
    const serving = await agentsServingProject(sql, {
      organizationId: orgId,
      projectId: billing,
    });
    const billingStatus = await readProjectDispatchStatus(sql, owner, billing);
    record(
      'dispatch across projects: a board says which dispatches serve it and names their agents [TASK-R76]',
      servedBy.length === 1 &&
        servedBy[0]?.projectId === development &&
        servedBy[0].reachable &&
        billingStatus.servedBy.length === 1 &&
        !billingStatus.configured &&
        serving
          .map((agent) => agent.agentId)
          .sort()
          .join() === [agents.coder, agents.reviewer].sort().join() &&
        serving.every((agent) => agent.projectName === 'Development'),
      `servedBy=${JSON.stringify(servedBy)} serving=${JSON.stringify(serving)}`,
    );

    // 8. A person's run of the Coder on Billing answers to both projects.
    // Development is shared with one team for now: Bea edits Billing alone,
    // Dan edits Development alone, and the owner edits both. Bea starts the
    // Coder on "Archive old invoices" → the run is confined, in a workspace
    // of hers; Dan's would be too; the owner's gets the standing one.
    for (const [teamId, member] of [
      [billingTeam, bea],
      [devTeam, dan],
    ] as const) {
      await sql`
        INSERT INTO "user" ("id", "name", "email", "emailVerified",
                            "createdAt", "updatedAt")
        VALUES (${member}, ${member}, ${`${member}@example.com`}, true,
                ${new Date()}, ${new Date()})
      `;
      await sql`
        INSERT INTO "member" ("id", "organizationId", "userId", "role",
                              "createdAt")
        VALUES (${`m-${member}`}, ${orgId}, ${member}, 'editor', ${new Date()})
      `;
      await sql`
        INSERT INTO "team" ("id", "name", "organizationId", "createdAt",
                            "updatedAt")
        VALUES (${teamId}, ${teamId}, ${orgId}, ${new Date()}, ${new Date()})
      `;
      await sql`
        INSERT INTO "teamMember" ("id", "teamId", "userId", "createdAt")
        VALUES (${`tm-${member}`}, ${teamId}, ${member}, ${new Date()})
      `;
    }
    await sql`
      UPDATE app.projects SET team_ids = ${[devTeam]} WHERE id = ${development}
    `;
    const beaAuth: ProjectAuthContext = {
      organizationId: orgId,
      userId: bea,
      role: 'editor',
      teamIds: [billingTeam],
    };
    const danAuth: ProjectAuthContext = {
      organizationId: orgId,
      userId: dan,
      role: 'editor',
      teamIds: [devTeam],
    };
    await sql`
      UPDATE app.tasks SET assignee_type = 'agent', assignee_id = ${agents.coder}
      WHERE id = ${tasks.invoices}
    `;
    const beaStart = await transactSerializable(sql, (tx) =>
      startTaskAgentRunManual(tx, beaAuth, tasks.invoices),
    );
    const beaRun = (
      await sql<{ id: string; sessionId: string; startedBy: string }[]>`
        SELECT id, session_id AS "sessionId", started_by AS "startedBy"
        FROM app.project_agent_runs
        WHERE task_id = ${tasks.invoices} AND status IN ('queued', 'running')
      `
    )[0];
    const onBilling = {
      organizationId: orgId,
      projectId: billing,
      agentId: agents.coder,
    };
    const beaConfined =
      beaRun !== undefined &&
      (await isTaskRunConfined(sql, { ...onBilling, ...beaRun }));
    // Even in the Coder's standing workspace, her run acts for her alone.
    const beaStandingConfined = await isTaskRunConfined(sql, {
      ...onBilling,
      sessionId: standingSessionIdForProjectAgent(agents.coder),
      startedBy: bea,
    });
    const danSession = await sessionIdForAgentRun(sql, {
      ...onBilling,
      startedBy: dan,
    });
    const ownerSession = await sessionIdForAgentRun(sql, {
      ...onBilling,
      startedBy: userId,
    });
    record(
      "dispatch across projects: a person's run of another project's agent gets its equipment only from who may edit both projects [TASK-R79]",
      beaStart.started &&
        beaRun?.sessionId ===
          memberSessionIdForProjectAgent(agents.coder, bea) &&
        beaConfined &&
        beaStandingConfined &&
        danSession === memberSessionIdForProjectAgent(agents.coder, dan) &&
        ownerSession === standingSessionIdForProjectAgent(agents.coder),
      `start=${JSON.stringify(beaStart)} run=${JSON.stringify(beaRun)} confined=${beaConfined} standingConfined=${beaStandingConfined} dan=${danSession} owner=${ownerSession}`,
    );

    // 9. Dan reads Development but not Billing: its Dispatch page counts the
    // Coder's two Billing runs and lists neither, and names Billing to
    // nobody but who may read it. Bea, who does not read Development, is
    // not told whose dispatch serves her board.
    const danStatus = await readProjectDispatchStatus(
      sql,
      danAuth,
      development,
    );
    const ownerStatus = await readProjectDispatchStatus(
      sql,
      owner,
      development,
    );
    const coderOf = (status: typeof danStatus) =>
      status.pool.find((agent) => agent.agentId === agents.coder);
    const beaServing = await readAgentsServingProject(sql, beaAuth, billing);
    const beaBillingStatus = await readProjectDispatchStatus(
      sql,
      beaAuth,
      billing,
    );
    const danText = JSON.stringify(danStatus);
    record(
      'dispatch across projects: the readback names another project and its tasks only to who may read it [TASK-R80]',
      coderOf(danStatus)?.runCounts.total === 2 &&
        coderOf(danStatus)?.runs.length === 0 &&
        danStatus.sources[0]?.name === null &&
        !danText.includes('Fix the importer') &&
        !danText.includes('Archive old invoices') &&
        !danText.includes('"Billing"') &&
        (coderOf(ownerStatus)?.runs ?? []).some(
          (run) => run.taskTitle === 'Fix the importer',
        ) &&
        ownerStatus.sources[0]?.name === 'Billing' &&
        beaServing.agents.length === 2 &&
        beaServing.agents.every((agent) => agent.projectName === null) &&
        beaBillingStatus.servedBy[0]?.name === null,
      `dan=${JSON.stringify({ coder: coderOf(danStatus), sources: danStatus.sources })} owner=${JSON.stringify(coderOf(ownerStatus)?.runs)} serving=${JSON.stringify(beaServing)} servedBy=${JSON.stringify(beaBillingStatus.servedBy)}`,
    );
    if (beaRun !== undefined) {
      await sql`
        UPDATE app.project_agent_runs SET status = 'cancelled',
          settled_at_ms = ${Date.now()}, updated_at_ms = ${Date.now()}
        WHERE id = ${beaRun.id}
      `;
    }
    await sql`
      UPDATE app.projects SET team_ids = '{}' WHERE id = ${development}
    `;

    // 10. Whoever last saved the dispatch loses the right: Billing is
    // skipped, with why, nobody else's right stands in, and nobody starts
    // the dispatch's agents there any more.
    await sql`
      UPDATE app.project_dispatch SET updated_by = ${`itest-gone-${suffix}`}
      WHERE project_id = ${development}
    `;
    await sql`
      UPDATE app.project_agent_runs SET status = 'cancelled',
        settled_at_ms = ${Date.now()}, updated_at_ms = ${Date.now()}
      WHERE id = ${importerRun.id}
    `;
    const lost = await pass();
    // The Coder stays assigned to "Fix the importer", but a person's Start
    // agent no longer puts it to work there.
    const lostStart = await transactSerializable(sql, (tx) =>
      startTaskAgentRunManual(tx, owner, tasks.importer),
    );
    const lostRuns = await liveRuns();
    const lostStatus = await readProjectDispatchStatus(sql, owner, development);
    const lostReach = await agentReachesProject(sql, {
      organizationId: orgId,
      agentId: agents.coder,
      projectId: billing,
    });
    const lostAct = await dispatchMayActInProject(sql, {
      organizationId: orgId,
      projectId: billing,
      dispatchProjectId: development,
    });
    record(
      'dispatch across projects: a board whose right was lost is skipped, the pass and the readback say why [TASK-R72]',
      lost !== null &&
        lost.held.some(
          (hold) =>
            hold.reason === 'source_no_authority' && hold.projectId === billing,
        ) &&
        lostRuns.every((run) => run.projectId !== billing) &&
        lostStatus.sources[0]?.skipped === 'no_authority' &&
        !lostReach &&
        !lostAct &&
        !lostStart.started &&
        lostStart.reason === 'agent_out_of_reach',
      `pass=${JSON.stringify(lost)} start=${JSON.stringify(lostStart)} runs=${JSON.stringify(lostRuns)} sources=${JSON.stringify(lostStatus.sources)} reach=${lostReach} act=${lostAct}`,
    );

    // 11. Saved again by the owner, unchanged, it serves Billing on the
    // owner's right; archiving Billing then skips it again.
    const resaved = await transactSerializable(sql, (tx) =>
      saveProjectDispatch(tx, owner, { projectId: development, dispatch }),
    );
    const regained = await agentReachesProject(sql, {
      organizationId: orgId,
      agentId: agents.coder,
      projectId: billing,
    });
    await sql`
      UPDATE app.projects SET archived_at_ms = ${Date.now()} WHERE id = ${billing}
    `;
    const archivedPass = await pass();
    const archivedReach = await agentReachesProject(sql, {
      organizationId: orgId,
      agentId: agents.coder,
      projectId: billing,
    });
    const archivedLock = await lockOutcome(agents.coder);
    record(
      'dispatch across projects: a board saved again by who may edit it is served again, and an archived one is skipped [TASK-R72]',
      resaved.changed &&
        regained &&
        archivedPass !== null &&
        archivedPass.held.some(
          (hold) =>
            hold.reason === 'source_archived' && hold.projectId === billing,
        ) &&
        !archivedReach &&
        archivedLock === null,
      `resaved=${JSON.stringify(resaved)} regained=${regained} pass=${JSON.stringify(archivedPass)} reach=${archivedReach} lock=${archivedLock}`,
    );

    // 12. Deleting the Coder takes it off the Billing cards it held, each
    // with a line in Billing's own history.
    await transactSerializable(sql, (tx) =>
      deleteProjectAgent(tx, owner, agents.coder),
    );
    const heldCards = await sql<
      { id: string; assigneeType: string | null; assigneeId: string | null }[]
    >`
      SELECT id, assignee_type AS "assigneeType", assignee_id AS "assigneeId"
      FROM app.tasks WHERE id = ANY(${[tasks.importer, tasks.invoices]})
    `;
    const unassignedLines = await sql<{ taskId: string; projectId: string }[]>`
      SELECT task_id AS "taskId", project_id AS "projectId"
      FROM app.task_activity
      WHERE task_id = ANY(${[tasks.importer, tasks.invoices]})
        AND action = 'assignee.changed' AND from_value = ${agents.coder}
        AND to_value IS NULL
    `;
    record(
      'dispatch across projects: deleting an agent clears it from the cards it held on the boards its dispatch served [PROJ-R12]',
      heldCards.length === 2 &&
        heldCards.every(
          (card) => card.assigneeType === null && card.assigneeId === null,
        ) &&
        unassignedLines.length === 2 &&
        unassignedLines.every((line) => line.projectId === billing),
      `cards=${JSON.stringify(heldCards)} lines=${JSON.stringify(unassignedLines)}`,
    );
  } finally {
    await sql`
      UPDATE app.project_dispatch SET enabled = false
      WHERE project_id = ${development}
    `;
    await sql`
      UPDATE app.project_agent_runs SET status = 'cancelled',
        settled_at_ms = ${Date.now()}, updated_at_ms = ${Date.now()}
      WHERE project_id = ANY(${[development, billing]})
        AND status IN ('queued', 'running')
    `;
    await sql`DELETE FROM "teamMember" WHERE "userId" = ANY(${[bea, dan]})`;
    await sql`DELETE FROM "team" WHERE "id" = ANY(${[billingTeam, devTeam]})`;
    await sql`DELETE FROM "member" WHERE "userId" = ANY(${[bea, dan]})`;
    await sql`DELETE FROM "user" WHERE "id" = ANY(${[bea, dan]})`;
    await restoreQuota();
    await release();
  }
}
