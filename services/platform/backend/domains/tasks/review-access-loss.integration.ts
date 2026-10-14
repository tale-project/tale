/** Real Postgres proof that a review waiting on a person who lost project
 * access goes on: through the members door's removal and role change, and the
 * team door's removal. It also proves what a fake cannot — other
 * organizations, decided, workflow-era and agent rows stay as they were, the
 * canonical and the legacy project audience both decide eligibility — and
 * that a reviewer change or a decision committed while the hand-over holds
 * its stale read is neither undone nor answered with a request. */
import { randomUUID } from 'node:crypto';

import { transactSerializable } from '@tale/shared/db/serializable';
import type { Sql } from 'postgres';

import {
  pauseFirstHandover,
  signal,
} from '../erasure/review-handover.integration.ts';
import { removeMember, updateMemberRole } from '../members/service.ts';
import { retargetPendingTaskReviewsForUser } from './reviews.ts';
import { updateTask, updateTaskStatus } from './service.ts';

type Recorder = (name: string, ok: boolean, detail: string) => void;

interface Person {
  userId: string;
  memberId: string;
}

interface Org {
  orgId: string;
  lead: Person;
}

async function insertOrg(sql: Sql, label: string): Promise<Org> {
  const orgId = randomUUID();
  await sql`
    INSERT INTO "organization" ("id", "name", "slug", "createdAt")
    VALUES (${orgId}, ${`Review access loss ${label}`}, ${`itest-loss-${label}-${orgId}`}, now())
  `;
  // The suite's own people, never the shared user: an organization the
  // shared user joins makes every later /api/v1 call on its keys answer
  // ORG_SLUG_REQUIRED.
  return { orgId, lead: await insertMember(sql, orgId, 'lead', 'owner') };
}

async function insertMember(
  sql: Sql,
  orgId: string,
  name: string,
  role: string,
  userId = `access-loss-${name}-${randomUUID()}`,
): Promise<Person> {
  const memberId = randomUUID();
  await sql`
    INSERT INTO "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
    VALUES (${userId}, ${name}, ${`${userId}@example.com`}, true, now(), now())
    ON CONFLICT ("id") DO NOTHING
  `;
  await sql`
    INSERT INTO "member" ("id", "organizationId", "userId", "role", "createdAt")
    VALUES (${memberId}, ${orgId}, ${userId}, ${role}, now())
  `;
  return { userId, memberId };
}

async function insertTeam(
  sql: Sql,
  orgId: string,
  name: string,
  members: readonly string[],
): Promise<string> {
  const teamId = randomUUID();
  await sql`
    INSERT INTO "team" ("id", "name", "organizationId", "createdAt", "updatedAt")
    VALUES (${teamId}, ${name}, ${orgId}, ${new Date()}, ${new Date()})
  `;
  for (const userId of members) {
    await sql`
      INSERT INTO "teamMember" ("id", "teamId", "userId", "createdAt")
      VALUES (${randomUUID()}, ${teamId}, ${userId}, ${new Date()})
    `;
  }
  return teamId;
}

/** `teamIds` is the audience the application writes; the legacy pair is what
 * the previous image still writes during a roll (the array stays empty). */
async function insertProject(
  sql: Sql,
  orgId: string,
  createdBy: string,
  audience: {
    teamIds?: string[];
    legacy?: { teamId: string; shared: string[] };
  } = {},
): Promise<string> {
  const projectId = randomUUID();
  const now = Date.now();
  await sql`
    INSERT INTO app.projects (id, org_id, name, created_by, created_at_ms,
      updated_at_ms, team_ids, team_id, shared_with_team_ids)
    VALUES (${projectId}, ${orgId}, 'Review access loss', ${createdBy}, ${now},
      ${now}, ${audience.teamIds ?? []}, ${audience.legacy?.teamId ?? null},
      ${audience.legacy?.shared ?? []})
  `;
  return projectId;
}

async function insertTask(
  sql: Sql,
  args: {
    orgId: string;
    projectId: string;
    createdBy: string;
    status: string;
    reviewer?: string;
    archived?: boolean;
  },
): Promise<string> {
  const taskId = randomUUID();
  const now = Date.now();
  await sql`
    INSERT INTO app.tasks (id, org_id, project_id, title, status, rank,
      reviewer_user_id, created_by, created_by_type, created_at_ms,
      updated_at_ms, archived_at_ms)
    VALUES (${taskId}, ${args.orgId}, ${args.projectId}, ${`Task ${taskId.slice(0, 8)}`},
      ${args.status}, 'a0', ${args.reviewer ?? null}, ${args.createdBy}, 'user',
      ${now}, ${now}, ${args.archived === true ? now : null})
  `;
  return taskId;
}

/** A review row the way the gate writes it: the legacy human mirror and the
 * typed recipient side by side. */
async function insertApproval(
  sql: Sql,
  args: {
    orgId: string;
    taskId: string;
    projectId: string;
    status?: 'pending' | 'completed' | 'rejected';
    recipient:
      | { kind: 'user'; userId: string }
      | { kind: 'agent'; agentId: string };
    workflowExecution?: string;
  },
): Promise<string> {
  const approvalId = randomUUID();
  await sql`
    INSERT INTO app.approvals (id, org_id, resource_type, resource_id, status,
      wf_execution_id, metadata, created_at_ms)
    VALUES (${approvalId}, ${args.orgId}, 'task_review', ${args.taskId},
      ${args.status ?? 'pending'}, ${args.workflowExecution ?? null},
      ${sql.json({
        taskId: args.taskId,
        projectId: args.projectId,
        requestedFor:
          args.recipient.kind === 'user' ? args.recipient.userId : null,
        reviewer: args.recipient,
        round: 0,
        question: null,
      })}, ${Date.now()})
  `;
  return approvalId;
}

interface TaskState {
  designation: string | null;
  status: string;
  review: {
    status: string;
    recipient: string | null;
    typed: string | null;
    approvedBy: string | null;
  } | null;
}

async function stateOf(
  sql: Sql,
  orgId: string,
  taskId: string,
): Promise<TaskState> {
  const [task] = await sql<{ designation: string | null; status: string }[]>`
    SELECT reviewer_user_id AS designation, status FROM app.tasks
    WHERE id = ${taskId} AND org_id = ${orgId}
  `;
  const [review] = await sql<
    {
      status: string;
      recipient: string | null;
      typed: string | null;
      approvedBy: string | null;
    }[]
  >`
    SELECT status, metadata->>'requestedFor' AS recipient,
      metadata->'reviewer'->>'userId' AS typed, approved_by AS "approvedBy"
    FROM app.approvals
    WHERE org_id = ${orgId} AND resource_type = 'task_review'
      AND resource_id = ${taskId}
    ORDER BY seq DESC LIMIT 1
  `;
  return {
    designation: task?.designation ?? null,
    status: task?.status ?? 'missing',
    review: review ?? null,
  };
}

/** The system's hand-over rows in the organization, by task. */
async function handOvers(
  sql: Sql,
  orgId: string,
): Promise<Map<string, { cause: unknown; approvalId: unknown }[]>> {
  const rows = await sql<
    {
      taskId: string;
      cause: string | null;
      previous: { approvalId?: string | null };
      actorType: string;
    }[]
  >`
    SELECT resource_id AS "taskId", metadata->>'cause' AS cause,
      previous_state AS previous, actor_type AS "actorType"
    FROM app.audit_logs
    WHERE org_id = ${orgId} AND action = 'task.review_retargeted'
      AND actor_type = 'system'
    ORDER BY id
  `;
  const byTask = new Map<string, { cause: unknown; approvalId: unknown }[]>();
  for (const row of rows) {
    byTask.set(row.taskId, [
      ...(byTask.get(row.taskId) ?? []),
      { cause: row.cause, approvalId: row.previous.approvalId ?? null },
    ]);
  }
  return byTask;
}

async function requestBells(
  sql: Sql,
  orgId: string,
  approvalId: string,
  userId: string,
): Promise<number> {
  const [row] = await sql<{ count: number }[]>`
    SELECT count(*)::int AS count FROM app.user_notifications
    WHERE org_id = ${orgId} AND resource_id = ${approvalId}
      AND type = 'task_review_requested' AND user_id = ${userId}
      AND read = false
  `;
  return row?.count ?? 0;
}

async function taskHints(
  sql: Sql,
  orgId: string,
  taskIds: readonly string[],
): Promise<number> {
  const [row] = await sql<{ count: number }[]>`
    SELECT count(DISTINCT entity_id)::int AS count FROM app_realtime.outbox
    WHERE org_id = ${orgId} AND entity = 'task' AND entity_id = ANY(${taskIds})
  `;
  return row?.count ?? 0;
}

const same = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

export async function checkReviewAccessLoss(
  sql: Sql,
  record: Recorder,
): Promise<void> {
  await checkRemoval(sql, record);
  await checkRoleChange(sql, record);
  await checkTeamRemoval(sql, record);
  await checkRaces(sql, record);
}

/** The members door removes bob; SCIM and the sign-in handler's hook run the
 * same cascade. */
async function checkRemoval(sql: Sql, record: Recorder): Promise<void> {
  const { orgId, lead } = await insertOrg(sql, 'removal');
  const bob = await insertMember(sql, orgId, 'bob', 'editor');
  const carol = await insertMember(sql, orgId, 'carol', 'editor');
  const projectId = await insertProject(sql, orgId, lead.userId);
  const task = (args: {
    status: string;
    reviewer?: string;
    createdBy?: string;
    archived?: boolean;
  }) =>
    insertTask(sql, {
      orgId,
      projectId,
      createdBy: args.createdBy ?? carol.userId,
      ...args,
    });
  const toBob = { kind: 'user', userId: bob.userId } as const;
  const approval = (
    taskId: string,
    extra: { status?: 'completed'; workflowExecution?: string } = {},
  ) =>
    insertApproval(sql, {
      orgId,
      taskId,
      projectId,
      recipient: toBob,
      ...extra,
    });

  const designated = await task({ status: 'todo', reviewer: bob.userId });
  const waiting = await task({ status: 'in_review', reviewer: bob.userId });
  const waitingReview = await approval(waiting);
  // The creator fallback names nobody on the task: only the review does.
  const fallback = await task({ status: 'in_review', createdBy: bob.userId });
  const fallbackReview = await approval(fallback);
  const agentOwned = await task({ status: 'in_review', reviewer: bob.userId });
  await insertApproval(sql, {
    orgId,
    taskId: agentOwned,
    projectId,
    recipient: { kind: 'agent', agentId: 'agent-1' },
  });
  const decided = await task({ status: 'done', reviewer: bob.userId });
  await approval(decided, { status: 'completed' });
  const workflow = await task({ status: 'in_review' });
  await approval(workflow, { workflowExecution: 'wf-1' });
  const archived = await task({
    status: 'in_review',
    reviewer: bob.userId,
    archived: true,
  });
  const archivedReview = await approval(archived);
  // The same person in another organization keeps everything there.
  const other = await insertOrg(sql, 'removal-other');
  await insertMember(sql, other.orgId, 'bob', 'editor', bob.userId);
  const otherProject = await insertProject(sql, other.orgId, other.lead.userId);
  const elsewhere = await insertTask(sql, {
    orgId: other.orgId,
    projectId: otherProject,
    createdBy: other.lead.userId,
    status: 'in_review',
    reviewer: bob.userId,
  });
  await insertApproval(sql, {
    orgId: other.orgId,
    taskId: elsewhere,
    projectId: otherProject,
    recipient: toBob,
  });
  const before = {
    agentOwned: await stateOf(sql, orgId, agentOwned),
    decided: await stateOf(sql, orgId, decided),
    workflow: await stateOf(sql, orgId, workflow),
    elsewhere: await stateOf(sql, other.orgId, elsewhere),
  };

  await transactSerializable(sql, (tx) =>
    removeMember(tx, { userId: lead.userId }, bob.memberId),
  );

  const after = {
    designated: await stateOf(sql, orgId, designated),
    waiting: await stateOf(sql, orgId, waiting),
    fallback: await stateOf(sql, orgId, fallback),
    agentOwned: await stateOf(sql, orgId, agentOwned),
    decided: await stateOf(sql, orgId, decided),
    workflow: await stateOf(sql, orgId, workflow),
    archived: await stateOf(sql, orgId, archived),
    elsewhere: await stateOf(sql, other.orgId, elsewhere),
  };
  const rows = await handOvers(sql, orgId);
  record(
    'review access loss: removing a member clears their designations and moves the reviews that waited on them',
    after.designated.designation === null &&
      after.waiting.designation === null &&
      after.waiting.review?.status === 'pending' &&
      after.waiting.review.recipient === carol.userId &&
      after.waiting.review.typed === carol.userId &&
      after.fallback.review?.recipient === lead.userId &&
      after.fallback.review.typed === lead.userId &&
      after.archived.designation === null &&
      after.archived.review?.recipient === carol.userId,
    `designated=${String(after.designated.designation)}, waiting→${String(after.waiting.review?.recipient === carol.userId ? 'creator' : after.waiting.review?.recipient)}, fallback→${String(after.fallback.review?.recipient === lead.userId ? 'project creator' : after.fallback.review?.recipient)}, archived→${String(after.archived.review?.recipient === carol.userId ? 'creator' : after.archived.review?.recipient)}`,
  );
  record(
    'review access loss: an agent review, a decided review, a workflow-era row and another organization keep what they had',
    same(after.agentOwned.review, before.agentOwned.review) &&
      same(after.decided.review, before.decided.review) &&
      after.decided.review?.recipient === bob.userId &&
      same(after.workflow, before.workflow) &&
      same(after.elsewhere, before.elsewhere) &&
      after.elsewhere.designation === bob.userId &&
      after.agentOwned.designation === null &&
      after.decided.designation === null,
    `agent=${after.agentOwned.review?.recipient ?? 'none'}/${after.agentOwned.review?.status}, decided=${after.decided.review?.status}/${String(after.decided.review?.recipient === bob.userId ? 'unchanged' : after.decided.review?.recipient)}, workflow=${same(after.workflow, before.workflow) ? 'unchanged' : 'changed'}, other org=${same(after.elsewhere, before.elsewhere) ? 'unchanged' : 'changed'}`,
  );
  const moved = [designated, waiting, fallback, agentOwned, decided, archived];
  record(
    'review access loss: every changed task has one system audit row naming the cause and one realtime hint, and nothing else has',
    moved.every((id) => rows.get(id)?.length === 1) &&
      !rows.has(workflow) &&
      rows.size === moved.length &&
      [...rows.values()].every((list) => list[0]?.cause === 'member_removed') &&
      (await taskHints(sql, orgId, moved)) === moved.length &&
      rows.get(waiting)?.[0]?.approvalId === waitingReview &&
      rows.get(designated)?.[0]?.approvalId === null &&
      (await handOvers(sql, other.orgId)).size === 0,
    `audit rows for ${rows.size} of ${moved.length} changed tasks (+ workflow ${rows.has(workflow) ? 'WRONGLY audited' : 'left alone'}), hints ${await taskHints(sql, orgId, moved)}/${moved.length}`,
  );
  record(
    'review access loss: the new reviewer is asked once, nobody is asked for a task hidden from the board',
    (await requestBells(sql, orgId, waitingReview, carol.userId)) === 1 &&
      (await requestBells(sql, orgId, fallbackReview, lead.userId)) === 1 &&
      (await requestBells(sql, orgId, archivedReview, carol.userId)) === 0 &&
      (await requestBells(sql, orgId, waitingReview, bob.userId)) === 0,
    `creator bell=${await requestBells(sql, orgId, waitingReview, carol.userId)} (want 1), project creator bell=${await requestBells(sql, orgId, fallbackReview, lead.userId)} (want 1), archived bell=${await requestBells(sql, orgId, archivedReview, carol.userId)} (want 0)`,
  );
}

/** A role that still edits the project keeps the review; the check is per
 * project, so an admin made an editor keeps an organization-wide project and
 * loses a team-restricted one they are not a team member of. */
async function checkRoleChange(sql: Sql, record: Recorder): Promise<void> {
  const { orgId, lead } = await insertOrg(sql, 'role');
  const carol = await insertMember(sql, orgId, 'carol', 'editor');
  const bob = await insertMember(sql, orgId, 'bob', 'editor');
  const alice = await insertMember(sql, orgId, 'alice', 'admin');
  const dana = await insertMember(sql, orgId, 'dana', 'editor');
  const finance = await insertTeam(sql, orgId, 'Finance', [
    bob.userId,
    dana.userId,
    carol.userId,
  ]);
  const open = await insertProject(sql, orgId, lead.userId);
  const restricted = await insertProject(sql, orgId, lead.userId, {
    teamIds: [finance],
  });
  const held = async (person: Person, projectId: string) => {
    const taskId = await insertTask(sql, {
      orgId,
      projectId,
      createdBy: carol.userId,
      status: 'in_review',
      reviewer: person.userId,
    });
    await insertApproval(sql, {
      orgId,
      taskId,
      projectId,
      recipient: { kind: 'user', userId: person.userId },
    });
    return taskId;
  };
  const bobOpen = await held(bob, open);
  const bobRestricted = await held(bob, restricted);
  const aliceOpen = await held(alice, open);
  const aliceRestricted = await held(alice, restricted);
  const danaOpen = await held(dana, open);
  const danaRestricted = await held(dana, restricted);
  const change = (person: Person, role: string) =>
    transactSerializable(sql, (tx) =>
      updateMemberRole(
        tx,
        { userId: lead.userId },
        { memberId: person.memberId, role },
      ),
    );

  await change(bob, 'member');
  const bobAfter = [
    await stateOf(sql, orgId, bobOpen),
    await stateOf(sql, orgId, bobRestricted),
  ];
  record(
    'review access loss: a role without project edit access hands every review on, an organization-wide project and a team-restricted one alike',
    bobAfter.every(
      (state) =>
        state.designation === null &&
        state.review?.status === 'pending' &&
        state.review.recipient === carol.userId,
    ),
    `bob→member: ${bobAfter.map((state) => String(state.designation)).join('/')} designated, reviews with ${bobAfter.map((state) => (state.review?.recipient === carol.userId ? 'creator' : String(state.review?.recipient))).join('/')}`,
  );

  await change(alice, 'editor');
  const aliceKept = await stateOf(sql, orgId, aliceOpen);
  const aliceLost = await stateOf(sql, orgId, aliceRestricted);
  record(
    'review access loss: an admin made an editor keeps the organization-wide project and loses the team project they are not in',
    aliceKept.designation === alice.userId &&
      aliceKept.review?.recipient === alice.userId &&
      aliceLost.designation === null &&
      aliceLost.review?.recipient === carol.userId,
    `open project: ${aliceKept.designation === alice.userId ? 'kept' : 'moved'}, restricted project: ${aliceLost.designation === null ? 'moved' : 'kept'}`,
  );

  await change(dana, 'developer');
  const danaKept = [
    await stateOf(sql, orgId, danaOpen),
    await stateOf(sql, orgId, danaRestricted),
  ];
  const rowsBefore = (await handOvers(sql, orgId)).size;
  await change(dana, 'disabled');
  const danaLost = [
    await stateOf(sql, orgId, danaOpen),
    await stateOf(sql, orgId, danaRestricted),
  ];
  const rows = await handOvers(sql, orgId);
  record(
    'review access loss: a role that still edits changes nothing, and Disabled moves everything',
    danaKept.every(
      (state) =>
        state.designation === dana.userId &&
        state.review?.recipient === dana.userId,
    ) &&
      danaLost.every(
        (state) =>
          state.designation === null &&
          state.review?.recipient === carol.userId,
      ) &&
      rowsBefore === 3 &&
      rows.size === 5 &&
      [...rows.values()].every((list) => list[0]?.cause === 'role_changed'),
    `developer: ${danaKept.map((state) => (state.designation === dana.userId ? 'kept' : 'moved')).join('/')}; disabled: ${danaLost.map((state) => (state.designation === null ? 'moved' : 'kept')).join('/')}; audit rows ${rowsBefore} then ${rows.size} (want 3 then 5)`,
  );
}

/** Leaving one team of two keeps the access; leaving the last team that
 * reaches the project loses it. The legacy audience pair counts the same. */
async function checkTeamRemoval(sql: Sql, record: Recorder): Promise<void> {
  const { orgId, lead } = await insertOrg(sql, 'team');
  const carol = await insertMember(sql, orgId, 'carol', 'editor');
  const bob = await insertMember(sql, orgId, 'bob', 'editor');
  const teamA = await insertTeam(sql, orgId, 'Team A', [
    bob.userId,
    carol.userId,
  ]);
  const teamB = await insertTeam(sql, orgId, 'Team B', [bob.userId]);
  const canonical = await insertProject(sql, orgId, lead.userId, {
    teamIds: [teamA, teamB],
  });
  const legacy = await insertProject(sql, orgId, lead.userId, {
    legacy: { teamId: teamA, shared: [teamB] },
  });
  const held = async (projectId: string) => {
    const taskId = await insertTask(sql, {
      orgId,
      projectId,
      createdBy: carol.userId,
      status: 'in_review',
      reviewer: bob.userId,
    });
    await insertApproval(sql, {
      orgId,
      taskId,
      projectId,
      recipient: { kind: 'user', userId: bob.userId },
    });
    return taskId;
  };
  const tasks = [await held(canonical), await held(legacy)];
  const leave = (teamId: string) =>
    transactSerializable(sql, async (tx) => {
      await tx`
        DELETE FROM "teamMember" WHERE "teamId" = ${teamId} AND "userId" = ${bob.userId}
      `;
      await retargetPendingTaskReviewsForUser(tx, {
        organizationId: orgId,
        userId: bob.userId,
        cause: 'team_removed',
      });
    });

  await leave(teamA);
  const kept = await Promise.all(tasks.map((id) => stateOf(sql, orgId, id)));
  const rowsAfterFirst = (await handOvers(sql, orgId)).size;
  await leave(teamB);
  const lost = await Promise.all(tasks.map((id) => stateOf(sql, orgId, id)));
  const rows = await handOvers(sql, orgId);
  record(
    'review access loss: leaving one of two teams that reach a project, in either audience spelling, keeps the review; leaving the last moves it',
    kept.every(
      (state) =>
        state.designation === bob.userId &&
        state.review?.recipient === bob.userId,
    ) &&
      rowsAfterFirst === 0 &&
      lost.every(
        (state) =>
          state.designation === null &&
          state.review?.recipient === carol.userId,
      ) &&
      rows.size === 2 &&
      [...rows.values()].every((list) => list[0]?.cause === 'team_removed'),
    `after Team A: ${kept.map((state) => (state.designation === bob.userId ? 'kept' : 'moved')).join('/')} (${rowsAfterFirst} audit rows, want 0); after Team B: ${lost.map((state) => (state.designation === null ? 'moved' : 'kept')).join('/')} (${rows.size} audit rows, want 2)`,
  );
}

/** The hand-over reads before it locks, so a reviewer change or a decision
 * that commits in between must win: the serializable door runs again on what
 * was committed. */
async function checkRaces(sql: Sql, record: Recorder): Promise<void> {
  for (const rival of ['designation', 'decision'] as const) {
    const { orgId, lead } = await insertOrg(
      sql,
      rival === 'designation' ? 'race-reviewer' : 'race-decision',
    );
    const bob = await insertMember(sql, orgId, 'bob', 'editor');
    const carol = await insertMember(sql, orgId, 'carol', 'editor');
    const alice = await insertMember(sql, orgId, 'alice', 'editor');
    const projectId = await insertProject(sql, orgId, lead.userId);
    const taskId = await insertTask(sql, {
      orgId,
      projectId,
      createdBy: carol.userId,
      status: 'in_review',
      reviewer: bob.userId,
    });
    const approvalId = await insertApproval(sql, {
      orgId,
      taskId,
      projectId,
      recipient: { kind: 'user', userId: bob.userId },
    });
    const auth = {
      organizationId: orgId,
      userId: lead.userId,
      role: 'owner',
      teamIds: [] as string[],
    };

    const reached = signal();
    const resume = signal();
    // Pause the hand-over just before it locks the task: it has read its
    // candidates and the person's access, and holds no lock yet.
    const pausedSql = pauseFirstHandover(
      sql,
      async () => {
        reached.release();
        await resume.promise;
      },
      /FROM app\.tasks WHERE id =\s*AND org_id =\s*FOR UPDATE/,
    );
    const handOver = transactSerializable(pausedSql, (tx) =>
      updateMemberRole(
        tx,
        { userId: lead.userId },
        { memberId: bob.memberId, role: 'member' },
      ),
    );
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        reached.promise,
        handOver.then(() => {
          throw new Error('The hand-over finished without reaching its lock');
        }),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new Error('The hand-over barrier timed out')),
            10_000,
          );
        }),
      ]);
      await transactSerializable(sql, async (tx) => {
        await tx`SET LOCAL statement_timeout = '10s'`;
        if (rival === 'designation') {
          await updateTask(tx, auth, {
            taskId,
            reviewerUserId: alice.userId,
          });
        } else {
          await updateTaskStatus(tx, auth, taskId, 'done');
        }
      });
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
      resume.release();
      await handOver;
    }

    const state = await stateOf(sql, orgId, taskId);
    const rows = await handOvers(sql, orgId);
    const [role] = await sql<{ role: string }[]>`
      SELECT role FROM "member" WHERE id = ${bob.memberId}
    `;
    const creatorBell = await requestBells(
      sql,
      orgId,
      approvalId,
      carol.userId,
    );
    const preserved =
      rival === 'designation'
        ? state.designation === alice.userId &&
          state.review?.status === 'pending' &&
          state.review.recipient === alice.userId &&
          rows.size === 0
        : state.status === 'done' &&
          state.review?.status === 'completed' &&
          state.review.approvedBy === lead.userId &&
          state.designation === null &&
          rows.get(taskId)?.length === 1 &&
          rows.get(taskId)?.[0]?.approvalId === null;
    record(
      `review access loss: a ${rival} committed while the hand-over held its read is kept, and the role change still lands`,
      preserved && creatorBell === 0 && role?.role === 'member',
      `task=${state.status}/${state.designation === alice.userId ? 'new reviewer' : String(state.designation)}, review=${state.review?.status}/${state.review?.recipient === alice.userId ? 'new reviewer' : state.review?.recipient === carol.userId ? 'creator' : String(state.review?.recipient)}, audit rows=${rows.size}, creator bells=${creatorBell} (want 0), role=${role?.role} (want member)`,
    );
  }
}
