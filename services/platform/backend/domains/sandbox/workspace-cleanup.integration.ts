/** Real Postgres: what the workspace cleanup selects, decides again under
 * the admission lock, keeps for a hold, and settles. The spawner is
 * scripted; every row lives in a private organization scope. */
import { randomUUID } from 'node:crypto';

import type { Sql } from 'postgres';

import type { SandboxWorkspaceInventory } from '../../core/node_only/sandbox/helpers/session_client.ts';
import {
  memberSessionIdForProjectAgent,
  standingSessionIdForProjectAgent,
} from '../../core/sandbox/session_naming.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import { scheduleOrganizationSandboxRetirement } from './retirement-schedule.ts';
import { setSessionPinned } from './sessions.ts';
import {
  eraseMemberWorkspaces,
  pendingOrganizationSlices,
  retireOwnerWorkspaces,
  retireWorkspace,
  runWorkspaceCleanup,
  unusedWorkspaceDeletions,
  type WorkspaceDestroyMode,
  type WorkspaceSpawner,
} from './workspace-cleanup.ts';

const DAY = 24 * 60 * 60 * 1000;

class RollbackProbe extends Error {}

export async function checkWorkspaceCleanup(
  sql: Sql,
  ctx: { orgId: string; userId: string },
  record: (name: string, ok: boolean, detail: string) => void,
): Promise<void> {
  // A real organization of its own (the unused-workspace rule applies only
  // to one that exists), so no other lane's rows are ever judged.
  const orgId: string = randomUUID();
  const now = Date.now();
  const old = now - 40 * DAY;
  const projectId = randomUUID();
  const taskId = randomUUID();
  const liveAgent = randomUUID();
  const pinnedAgent = randomUUID();
  const queuedAgent = randomUUID();
  const goneAgent = randomUUID();
  const busyGoneAgent = randomUUID();
  // An organization this deployment deleted: only its tombstone is left.
  const deletedOrg = randomUUID();

  const destroyCalls: Array<[string, WorkspaceDestroyMode]> = [];
  const unpinCalls: string[] = [];
  let inventory: SandboxWorkspaceInventory | null = null;
  /** How far the spawner reports a workspace's deletion — `done` unless
   * scripted; `legacy` is a spawner older than the contract, whose answer
   * carries no deletion state at all. */
  const deletionOf = new Map<
    string,
    'done' | 'pending' | 'failed' | 'handed_off' | 'legacy'
  >();
  const spawner: WorkspaceSpawner = {
    destroy: async (sessionId, mode) => {
      destroyCalls.push([sessionId, mode]);
      const deletion = deletionOf.get(sessionId) ?? 'done';
      return {
        destroyed: true,
        busy: false,
        ...(deletion === 'legacy' ? {} : { deletion }),
      };
    },
    inventory: async () => inventory,
    teardownOrganization: async () => null,
    disconnectDevice: async () => ({}),
    revokeKey: async () => {},
    removeOrganizationFromGateway: async () => ({ records: 0, keys: 0 }),
    unpin: async (sessionId) => {
      unpinCalls.push(sessionId);
    },
  };
  const destroyedWith = (sessionId: string) =>
    destroyCalls.filter(([id]) => id === sessionId).map(([, mode]) => mode);

  const session = async (
    sessionId: string,
    fields: {
      ownerId: string;
      ownerType?: string;
      status?: string;
      pinned?: boolean;
      at?: number;
      org?: string;
    },
  ) => {
    const at = fields.at ?? old;
    await sql`
      INSERT INTO app.sandbox_sessions (
        org_id, session_id, profile, status, owner_type, owner_id,
        created_by, pinned, created_at_ms, expires_at_ms, last_activity_at_ms
      ) VALUES (
        ${fields.org ?? orgId}, ${sessionId}, '"agent"'::jsonb,
        ${fields.status ?? 'stopped'}, ${fields.ownerType ?? 'project_agent'},
        ${fields.ownerId}, 'system:task-agent', ${fields.pinned ?? false},
        ${at}, ${at + DAY}, ${at}
      )
    `;
  };
  const op = async (
    sessionId: string,
    fields: { status: string; at: number; org?: string },
  ) => {
    await sql`
      INSERT INTO app.sandbox_session_ops (
        org_id, session_id, exec_id, kind, status, started_at_ms,
        finished_at_ms
      ) VALUES (
        ${fields.org ?? orgId}, ${sessionId}, ${randomUUID()}, 'task-agent',
        ${fields.status}, ${fields.at},
        ${fields.status === 'running' ? null : fields.at}
      )
    `;
  };
  const statusOf = async (sessionId: string, org = orgId) =>
    (
      await sql<{ status: string; pinned: boolean }[]>`
        SELECT status, pinned FROM app.sandbox_sessions
        WHERE org_id = ${org} AND session_id = ${sessionId}
        ORDER BY created_at_ms DESC, id DESC LIMIT 1
      `
    )[0];
  const audited = async (sessionId: string, org = orgId) =>
    (
      await sql<{ reason: string }[]>`
        SELECT metadata ->> 'reason' AS reason FROM app.audit_logs
        WHERE org_id = ${org} AND action = 'sandbox_workspace.deleted'
          AND resource_id = ${sessionId}
      `
    ).map((row) => row.reason);
  const auditDeletions = async (sessionId: string) =>
    (
      await sql<{ deletion: string | null }[]>`
        SELECT metadata ->> 'deletion' AS deletion FROM app.audit_logs
        WHERE org_id = ${orgId} AND action = 'sandbox_workspace.deleted'
          AND resource_id = ${sessionId}
      `
    ).map((row) => row.deletion);
  const auditStatuses = async (sessionId: string) =>
    (
      await sql<{ status: string }[]>`
        SELECT status FROM app.audit_logs
        WHERE org_id = ${orgId} AND action = 'sandbox_workspace.deleted'
          AND resource_id = ${sessionId}
      `
    )
      .map((row) => row.status)
      .sort();

  const agent = async (id: string) => {
    await sql`
      INSERT INTO app.project_agents (id, org_id, project_id, name, harness, model, created_by, created_at_ms, updated_at_ms)
      VALUES (${id}, ${orgId}, ${projectId}, 'Cleanup agent', 'opencode', 'itest', ${ctx.userId}, ${now}, ${now})
    `;
  };

  const standing = standingSessionIdForProjectAgent(liveAgent);
  const recent = memberSessionIdForProjectAgent(liveAgent, 'user-recent');
  const pinned = standingSessionIdForProjectAgent(pinnedAgent);
  const queued = standingSessionIdForProjectAgent(queuedAgent);
  const gone = standingSessionIdForProjectAgent(goneAgent);
  const busyGone = standingSessionIdForProjectAgent(busyGoneAgent);
  const held = memberSessionIdForProjectAgent(liveAgent, 'user-held');
  const left = memberSessionIdForProjectAgent(liveAgent, 'user-left');
  const erased = memberSessionIdForProjectAgent(liveAgent, 'user-erased');
  const stillMember = memberSessionIdForProjectAgent(liveAgent, ctx.userId);
  const raced = memberSessionIdForProjectAgent(liveAgent, 'user-raced');
  const orphanRun = `wf-${randomUUID()}`;
  try {
    await sql`
      INSERT INTO "organization" ("id", "name", "slug", "createdAt")
      VALUES (${orgId}, 'Cleanup proof', ${`cleanup-${orgId.slice(0, 8)}`}, now())
    `;
    await sql`
      INSERT INTO app.projects (id, org_id, name, created_by, created_at_ms, updated_at_ms)
      VALUES (${projectId}, ${orgId}, 'Cleanup proof', ${ctx.userId}, ${now}, ${now})
    `;
    for (const id of [liveAgent, pinnedAgent, queuedAgent]) await agent(id);
    await sql`
      INSERT INTO app.tasks (id, org_id, project_id, title, status, rank, created_by, created_by_type, created_at_ms, updated_at_ms)
      VALUES (${taskId}, ${orgId}, ${projectId}, 'Cleanup proof', 'in_progress', 'a0', ${ctx.userId}, 'user', ${now}, ${now})
    `;

    // 1. The sweep: owner gone, unused, and everything it must keep.
    await session(standing, { ownerId: liveAgent });
    await session(recent, { ownerId: liveAgent });
    await op(recent, { status: 'completed', at: now - DAY });
    await session(pinned, { ownerId: pinnedAgent, pinned: true });
    await session(queued, { ownerId: queuedAgent });
    await sql`
      INSERT INTO app.project_agent_runs (
        org_id, project_id, task_id, agent_id, exec_id, session_id, status,
        harness, model, started_by, started_at_ms, deadline_at_ms,
        updated_at_ms
      ) VALUES (
        ${orgId}, ${projectId}, ${taskId}, ${queuedAgent}, ${randomUUID()},
        ${queued}, 'queued', 'opencode', 'itest', ${ctx.userId}, ${old},
        ${now + DAY}, ${now}
      )
    `;
    await session(gone, {
      ownerId: goneAgent,
      status: 'active',
      pinned: true,
      at: now - 60_000,
    });
    await session(busyGone, { ownerId: busyGoneAgent, status: 'active' });
    await op(busyGone, { status: 'running', at: now - 60_000 });
    await session(held, { ownerId: liveAgent });
    await sql`
      INSERT INTO app.legal_holds (
        org_id, target_type, target_id, target_label, reason, placed_by,
        placed_at_ms
      ) VALUES (
        ${orgId}, 'userMembership', 'user-held', 'held@example.test',
        'itest custodian', ${ctx.userId}, ${now}
      )
    `;

    // A rule that has only just started applying (the first sweep after
    // the upgrade stamps it) deletes nothing for being unused yet — a
    // deleted agent's workspace goes regardless.
    const firstSweep = await runWorkspaceCleanup(sql, {
      spawner,
      organizationId: orgId,
    });
    const stamped = await sql<{ days: number; since: number }[]>`
      SELECT unused_days AS days, applies_since_ms::float8 AS since
      FROM app.sandbox_workspace_retention WHERE org_id = ${orgId}
    `;
    record(
      'workspace cleanup: a rule that just took effect waits a full window before deleting unused workspaces',
      firstSweep.retired.unused === undefined &&
        firstSweep.retired.agent_deleted === 1 &&
        destroyedWith(standing).length === 0 &&
        (await statusOf(standing))?.status === 'stopped' &&
        stamped[0]?.days === 30 &&
        Math.abs((stamped[0]?.since ?? 0) - now) < 10 * 60_000,
      JSON.stringify({ firstSweep, stamped }),
    );
    // The rule has been in force for longer than the window.
    await sql`
      UPDATE app.sandbox_workspace_retention SET applies_since_ms = ${old}
      WHERE org_id = ${orgId}
    `;
    const swept = await runWorkspaceCleanup(sql, {
      spawner,
      organizationId: orgId,
    });
    const after = {
      standing: await statusOf(standing),
      recent: await statusOf(recent),
      pinned: await statusOf(pinned),
      queued: await statusOf(queued),
      gone: await statusOf(gone),
      busyGone: await statusOf(busyGone),
      held: await statusOf(held),
    };
    record(
      'workspace cleanup: the sweep deletes an unused workspace and a deleted agent’s, keeps the rest',
      after.standing?.status === 'destroyed' &&
        destroyedWith(standing).join() === 'stopped' &&
        after.gone?.status === 'destroyed' &&
        !after.gone.pinned &&
        destroyedWith(gone).join() === 'idle' &&
        after.busyGone?.status === 'active' &&
        destroyedWith(busyGone).length === 0 &&
        after.recent?.status === 'stopped' &&
        after.pinned?.status === 'stopped' &&
        after.queued?.status === 'stopped' &&
        after.held?.status === 'stopped' &&
        destroyedWith(recent).length +
          destroyedWith(pinned).length +
          destroyedWith(queued).length +
          destroyedWith(held).length ===
          0 &&
        swept.retired.unused === 1 &&
        swept.deferred === 1 &&
        (await audited(standing)).join() === 'unused' &&
        (await audited(gone)).join() === 'agent_deleted' &&
        // Its spawner pin went first, so a refused destroy leaves nothing
        // the reaper must not touch.
        unpinCalls.join() === gone,
      JSON.stringify({ after, destroyCalls, unpinCalls, swept }),
    );

    // 2. A turn that resumed the workspace after it was judged keeps it:
    // the claim finds compute-holding rows and changes nothing.
    await session(raced, { ownerId: liveAgent, status: 'active' });
    const racedOutcome = await retireWorkspace(
      sql,
      {
        organizationId: orgId,
        sessionId: raced,
        reason: 'unused',
        mode: 'stopped',
      },
      spawner,
    );
    record(
      'workspace cleanup: a workspace resumed after it was judged stays',
      racedOutcome === 'busy' &&
        (await statusOf(raced))?.status === 'active' &&
        destroyedWith(raced).length === 0,
      `outcome ${racedOutcome}, status ${(await statusOf(raced))?.status}`,
    );

    // 2b. A turn after the claim starts a fresh incarnation under the same
    // id (its create waits for the destroy): the deletion settles only the
    // rows it claimed, never the fresh one.
    const reborn = memberSessionIdForProjectAgent(liveAgent, 'user-reborn');
    await session(reborn, { ownerId: liveAgent });
    const rebornOutcome = await retireWorkspace(
      sql,
      {
        organizationId: orgId,
        sessionId: reborn,
        reason: 'unused',
        mode: 'stopped',
      },
      {
        ...spawner,
        destroy: async (sessionId, mode) => {
          await session(sessionId, {
            ownerId: liveAgent,
            status: 'creating',
            at: Date.now(),
          });
          return spawner.destroy(sessionId, mode);
        },
      },
    );
    const rebornRows = await sql<{ status: string }[]>`
      SELECT status FROM app.sandbox_sessions
      WHERE org_id = ${orgId} AND session_id = ${reborn}
      ORDER BY created_at_ms ASC
    `;
    record(
      'workspace cleanup: a fresh incarnation started during the deletion is not settled with it',
      rebornOutcome === 'destroyed' &&
        rebornRows.map((row) => row.status).join() === 'destroyed,creating',
      JSON.stringify({ rebornOutcome, rebornRows }),
    );

    // 3. The date the Sandboxes page shows for an unused workspace.
    const deletions = await unusedWorkspaceDeletions(
      sql,
      orgId,
      [recent, pinned, held],
      now,
    );
    const recentDeletion = deletions.get(recent) ?? 0;
    record(
      'workspace cleanup: the page dates an unused workspace’s deletion, not a pinned or held one’s',
      Math.abs(recentDeletion - (now - DAY + 30 * DAY)) < 60_000 &&
        !deletions.has(pinned) &&
        !deletions.has(held),
      JSON.stringify([...deletions]),
    );

    // 3b. A long-pinned workspace that is unpinned gets a full window from
    // the unpin, not a deletion within the hour.
    const unpinned = memberSessionIdForProjectAgent(liveAgent, 'user-unpinned');
    await session(unpinned, { ownerId: liveAgent, pinned: true });
    await setSessionPinned(sql, {
      organizationId: orgId,
      sessionId: unpinned,
      pinned: false,
    });
    const unpinnedDeletion =
      (await unusedWorkspaceDeletions(sql, orgId, [unpinned], now)).get(
        unpinned,
      ) ?? 0;
    record(
      'workspace cleanup: unpinning a long-pinned workspace starts its window over',
      unpinnedDeletion - now > 29 * DAY,
      `deletes at ${unpinnedDeletion}, now ${now}`,
    );

    // 4. A member who left: their workspace goes; one who is (again) a
    // member of the organization keeps theirs.
    await session(left, { ownerId: liveAgent, status: 'active' });
    const leftResult = await retireOwnerWorkspaces(
      sql,
      { organizationId: orgId, reason: 'member_removed', userId: 'user-left' },
      spawner,
    );
    await session(stillMember, {
      ownerId: liveAgent,
      org: ctx.orgId,
    });
    const memberResult = await retireOwnerWorkspaces(
      sql,
      {
        organizationId: ctx.orgId,
        reason: 'member_removed',
        userId: ctx.userId,
      },
      spawner,
    );
    record(
      'workspace cleanup: a departed member’s workspace goes, a member’s stays',
      leftResult.retired === 1 &&
        (await statusOf(left))?.status === 'destroyed' &&
        destroyedWith(left).join() === 'idle' &&
        (await audited(left)).join() === 'member_removed' &&
        memberResult.retired === 0 &&
        memberResult.kept >= 1 &&
        (await statusOf(stillMember, ctx.orgId))?.status === 'stopped',
      JSON.stringify({ leftResult, memberResult }),
    );

    // 4b. A deleted agent's workspaces go at once — except a held member's
    // own, which its custodian hold keeps as the sweep would.
    const jobGoneAgent = randomUUID();
    const jobStanding = standingSessionIdForProjectAgent(jobGoneAgent);
    const jobHeld = memberSessionIdForProjectAgent(jobGoneAgent, 'user-held');
    const jobFree = memberSessionIdForProjectAgent(jobGoneAgent, 'user-free');
    for (const sessionId of [jobStanding, jobHeld, jobFree]) {
      await session(sessionId, { ownerId: jobGoneAgent });
    }
    const agentJob = await retireOwnerWorkspaces(
      sql,
      {
        organizationId: orgId,
        reason: 'agent_deleted',
        agentIds: [jobGoneAgent],
      },
      spawner,
    );
    record(
      'workspace cleanup: a deleted agent’s workspaces go, a held member’s own stays',
      agentJob.retired === 2 &&
        agentJob.kept === 1 &&
        (await statusOf(jobStanding))?.status === 'destroyed' &&
        (await statusOf(jobFree))?.status === 'destroyed' &&
        destroyedWith(jobFree).join() === 'idle' &&
        (await statusOf(jobHeld))?.status === 'stopped' &&
        destroyedWith(jobHeld).length === 0 &&
        (await audited(jobFree)).join() === 'agent_deleted',
      JSON.stringify(agentJob),
    );

    // 4c. The sweep backs the removal job up: a workspace whose runs a
    // departed person started goes; one of a member's runs, or of a
    // schedule's, never does.
    await sql`
      INSERT INTO "member" ("id", "organizationId", "userId", "role", "createdAt")
      VALUES (${randomUUID()}, ${orgId}, ${ctx.userId}, 'member', now())
    `;
    const departed = memberSessionIdForProjectAgent(liveAgent, 'user-departed');
    const present = memberSessionIdForProjectAgent(liveAgent, ctx.userId);
    const scheduled = memberSessionIdForProjectAgent(
      liveAgent,
      'trigger:schedule-1',
    );
    for (const [sessionId, startedBy] of [
      [departed, 'user:user-departed'],
      [present, ctx.userId],
      [scheduled, 'trigger:schedule-1'],
    ] as const) {
      await session(sessionId, { ownerId: liveAgent, at: now - 60_000 });
      await sql`
        INSERT INTO app.project_agent_runs (
          org_id, project_id, task_id, agent_id, exec_id, session_id, status,
          harness, model, started_by, started_at_ms, deadline_at_ms,
          updated_at_ms
        ) VALUES (
          ${orgId}, ${projectId}, ${taskId}, ${liveAgent}, ${randomUUID()},
          ${sessionId}, 'settled', 'opencode', 'itest', ${startedBy},
          ${now - 60_000}, ${now + DAY}, ${now}
        )
      `;
    }
    const memberSweep = await runWorkspaceCleanup(sql, {
      spawner,
      organizationId: orgId,
    });
    record(
      'workspace cleanup: the sweep deletes a departed member’s workspace, never a member’s or a schedule’s',
      (await statusOf(departed))?.status === 'destroyed' &&
        destroyedWith(departed).join() === 'idle' &&
        (await audited(departed)).join() === 'member_removed' &&
        (await statusOf(present))?.status === 'stopped' &&
        destroyedWith(present).length === 0 &&
        (await statusOf(scheduled))?.status === 'stopped' &&
        destroyedWith(scheduled).length === 0,
      JSON.stringify(memberSweep),
    );

    // 5. An erasure takes the subject's workspace whatever runs in it.
    await session(erased, { ownerId: liveAgent, status: 'active' });
    await op(erased, { status: 'running', at: now - 60_000 });
    const erasedCount = await eraseMemberWorkspaces(
      sql,
      { organizationId: orgId, userId: 'user-erased' },
      spawner,
    );
    record(
      'workspace cleanup: an erasure deletes the subject’s workspace while a turn runs in it',
      erasedCount === 1 &&
        (await statusOf(erased))?.status === 'destroyed' &&
        destroyedWith(erased).join() === 'force',
      `erased ${erasedCount}`,
    );

    // 5b. Out of use is not erased: while the spawner is still deleting the
    // workspace's files, or their deletion keeps failing, the pass throws
    // (the receipt reads partial) and nothing settles; a Retry once they
    // are gone does.
    const slow = memberSessionIdForProjectAgent(liveAgent, 'user-erased-slow');
    await session(slow, { ownerId: liveAgent, status: 'active' });
    const erase = () =>
      eraseMemberWorkspaces(
        sql,
        { organizationId: orgId, userId: 'user-erased-slow' },
        spawner,
      ).then(
        (count) => `erased ${count}`,
        (error: unknown) => (error instanceof Error ? error.message : 'threw'),
      );
    deletionOf.set(slow, 'pending');
    const whileDeleting = {
      pass: await erase(),
      status: (await statusOf(slow))?.status,
      audits: await auditStatuses(slow),
    };
    deletionOf.set(slow, 'failed');
    const whileFailing = {
      pass: await erase(),
      status: (await statusOf(slow))?.status,
      audits: await auditStatuses(slow),
    };
    deletionOf.set(slow, 'done');
    const retried = {
      pass: await erase(),
      status: (await statusOf(slow))?.status,
      audits: await auditStatuses(slow),
      reasons: await audited(slow),
    };
    record(
      'workspace cleanup: an erasure is not done while the workspace’s files are still being deleted or their deletion fails; its Retry settles it',
      whileDeleting.pass.includes(`${slow} (deleting)`) &&
        whileDeleting.status === 'expired' &&
        whileDeleting.audits.length === 0 &&
        whileFailing.pass.includes(`${slow} (deletion_failed)`) &&
        whileFailing.status === 'expired' &&
        whileFailing.audits.join() === 'failure' &&
        retried.pass === 'erased 1' &&
        retried.status === 'destroyed' &&
        retried.audits.join() === 'failure,success' &&
        retried.reasons.every((reason) => reason === 'member_erased') &&
        destroyedWith(slow).join() === 'force,force,force',
      JSON.stringify({ whileDeleting, whileFailing, retried }),
    );

    // 5c. A spawner or device older than the deletion contract answers
    // without a deletion state, though it deletes in the background (or
    // fails to): unconfirmed, never erased. Once it is updated and answers,
    // the Retry settles. Kubernetes' explicit hand-off of the volume settles
    // under its own contract, and the audit row says which.
    const legacy = memberSessionIdForProjectAgent(
      liveAgent,
      'user-erased-legacy',
    );
    const handedOff = memberSessionIdForProjectAgent(
      liveAgent,
      'user-erased-k8s',
    );
    await session(legacy, { ownerId: liveAgent, status: 'stopped' });
    await session(handedOff, { ownerId: liveAgent, status: 'stopped' });
    const eraseUser = (userId: string) =>
      eraseMemberWorkspaces(
        sql,
        { organizationId: orgId, userId },
        spawner,
      ).then(
        (count) => `erased ${count}`,
        (error: unknown) => (error instanceof Error ? error.message : 'threw'),
      );
    deletionOf.set(legacy, 'legacy');
    const whileLegacy = {
      pass: await eraseUser('user-erased-legacy'),
      status: (await statusOf(legacy))?.status,
      audits: await auditStatuses(legacy),
    };
    deletionOf.set(legacy, 'done');
    const afterUpdate = {
      pass: await eraseUser('user-erased-legacy'),
      status: (await statusOf(legacy))?.status,
      deletions: await auditDeletions(legacy),
    };
    deletionOf.set(handedOff, 'handed_off');
    const kubernetes = {
      pass: await eraseUser('user-erased-k8s'),
      status: (await statusOf(handedOff))?.status,
      deletions: await auditDeletions(handedOff),
    };
    record(
      'workspace cleanup: an older spawner’s answer without a deletion state never settles an erasure; an update does, and Kubernetes’ hand-off is recorded as such',
      whileLegacy.pass.includes(`${legacy} (deletion_unconfirmed)`) &&
        whileLegacy.status === 'expired' &&
        whileLegacy.audits.length === 0 &&
        afterUpdate.pass === 'erased 1' &&
        afterUpdate.status === 'destroyed' &&
        afterUpdate.deletions.join() === 'done' &&
        kubernetes.pass === 'erased 1' &&
        kubernetes.status === 'destroyed' &&
        kubernetes.deletions.join() === 'handed_off',
      JSON.stringify({ whileLegacy, afterUpdate, kubernetes }),
    );

    // 6. An organization hold keeps everything; released, the sweep resumes.
    const holdSession = standingSessionIdForProjectAgent(randomUUID());
    await session(holdSession, { ownerId: liveAgent });
    const holdId = randomUUID();
    await sql`
      INSERT INTO app.legal_holds (
        id, org_id, target_type, target_id, target_label, reason, placed_by,
        placed_at_ms
      ) VALUES (
        ${holdId}, ${orgId}, 'org', ${orgId}, 'Cleanup org', 'itest hold',
        ${ctx.userId}, ${now}
      )
    `;
    await runWorkspaceCleanup(sql, { spawner, organizationId: orgId });
    const heldBack = (await statusOf(holdSession))?.status;
    await sql`
      UPDATE app.legal_holds SET released_at_ms = ${Date.now()},
        released_by = ${ctx.userId}, release_reason = 'itest'
      WHERE id = ${holdId}
    `;
    await runWorkspaceCleanup(sql, { spawner, organizationId: orgId });
    record(
      'workspace cleanup: an organization hold keeps its workspaces until released',
      heldBack === 'stopped' &&
        (await statusOf(holdSession))?.status === 'destroyed',
      `held ${heldBack}, released ${(await statusOf(holdSession))?.status}`,
    );

    // 7. The inventory: an ended run's workspace whose row healed away goes;
    // a recent, an active and a pinned one are left alone.
    await session(orphanRun, {
      ownerId: `${randomUUID()}:@workflow`,
      ownerType: 'workflow_run',
      status: 'destroyed',
    });
    const quiet = { active: false, pinned: false, organizationId: orgId };
    const untouched = [`fresh-${randomUUID()}`, `warm-${randomUUID()}`];
    for (const sessionId of untouched) {
      await session(sessionId, {
        ownerId: `${randomUUID()}:@workflow`,
        ownerType: 'workflow_run',
        status: 'destroyed',
      });
    }
    inventory = {
      backend: 'docker',
      workspaces: [
        { sessionId: orphanRun, touchedAtMs: now - 2 * DAY, ...quiet },
        { sessionId: untouched[0] ?? '', touchedAtMs: now - 60_000, ...quiet },
        {
          sessionId: untouched[1] ?? '',
          touchedAtMs: now - 2 * DAY,
          ...quiet,
          active: true,
        },
      ],
      organizations: [],
    };
    const inventorySweep = await runWorkspaceCleanup(sql, {
      spawner,
      organizationId: orgId,
    });
    record(
      'workspace cleanup: the inventory deletes an ended run’s leftover workspace only',
      inventorySweep.inventory === 'read' &&
        destroyedWith(orphanRun).join() === 'stopped' &&
        untouched.every((id) => destroyedWith(id).length === 0) &&
        (await audited(orphanRun)).join() === 'orphaned',
      JSON.stringify(inventorySweep),
    );

    // 7b. Workspaces no row names: this organization's go — unless their
    // agent still exists — and another deployment's are never touched;
    // a deleted organization's go.
    const restored = memberSessionIdForProjectAgent(liveAgent, 'user-restored');
    const rowlessGone = standingSessionIdForProjectAgent(randomUUID());
    const rowlessRun = `wf-${randomUUID().slice(0, 24)}-0123456789abcdef`;
    const foreignOrg = randomUUID();
    const foreign = standingSessionIdForProjectAgent(randomUUID());
    const deletedLeftover = standingSessionIdForProjectAgent(randomUUID());
    await sql`
      INSERT INTO app.organization_tombstones (slug, org_id, deleted_at_ms)
      VALUES (${`cleanup-gone-${deletedOrg.slice(0, 8)}`}, ${deletedOrg}, ${now})
    `;
    const stale = { touchedAtMs: now - 2 * DAY, active: false, pinned: false };
    inventory = {
      backend: 'kubernetes',
      workspaces: [
        { sessionId: restored, organizationId: orgId, ...stale },
        { sessionId: rowlessGone, organizationId: orgId, ...stale },
        { sessionId: rowlessRun, organizationId: orgId, ...stale },
        { sessionId: foreign, organizationId: foreignOrg, ...stale },
        { sessionId: deletedLeftover, organizationId: deletedOrg, ...stale },
      ],
      organizations: [],
    };
    const ownSweep = await runWorkspaceCleanup(sql, {
      spawner,
      organizationId: orgId,
    });
    const foreignSweep = await runWorkspaceCleanup(sql, {
      spawner,
      organizationId: foreignOrg,
    });
    const deletedSweep = await runWorkspaceCleanup(sql, {
      spawner,
      organizationId: deletedOrg,
    });
    record(
      'workspace cleanup: of the workspaces no row names, only this deployment’s go',
      destroyedWith(restored).length === 0 &&
        destroyedWith(rowlessGone).join() === 'stopped' &&
        destroyedWith(rowlessRun).join() === 'stopped' &&
        (await audited(rowlessGone)).join() === 'orphaned' &&
        ownSweep.unattributed === 0 &&
        destroyedWith(foreign).length === 0 &&
        foreignSweep.unattributed === 1 &&
        destroyedWith(deletedLeftover).join() === 'stopped' &&
        deletedSweep.unattributed === 0,
      JSON.stringify({ ownSweep, foreignSweep, deletedSweep }),
    );

    // 8. A workspace no row of any organization names.
    const nameless = `nameless-${randomUUID()}`;
    const namelessOutcome = await retireWorkspace(
      sql,
      {
        organizationId: null,
        sessionId: nameless,
        reason: 'orphaned',
        mode: 'stopped',
      },
      spawner,
    );
    record(
      'workspace cleanup: a workspace no row names is deleted when stopped',
      namelessOutcome === 'destroyed' &&
        destroyedWith(nameless).join() === 'stopped',
      `outcome ${namelessOutcome}`,
    );

    // 9. An organization's deletion reads what its sandboxes leave behind
    // before the cascade removes the rows naming it.
    const kept = `pa-${randomUUID()}`;
    // A phantom heal settled its row, while the spawner kept the workspace.
    const healed = `pa-${randomUUID()}`;
    const settledRun = `wf-${randomUUID().slice(0, 24)}-0123456789abcdef`;
    await session(kept, { ownerId: liveAgent, status: 'stopped' });
    await session(healed, { ownerId: liveAgent, status: 'destroyed' });
    await session(settledRun, {
      ownerId: `${randomUUID()}:@workflow`,
      ownerType: 'workflow_run',
      status: 'destroyed',
    });
    await sql`
      INSERT INTO app.sandbox_session_tokens (
        org_id, session_id, token_hash, llm_gateway_key_id, scope,
        created_at_ms, expires_at_ms
      ) VALUES (
        ${orgId}, ${kept}, ${randomUUID()}, 'itest-token-key', '{}'::jsonb,
        ${now}, ${now + DAY}
      )
    `;
    let retirementJobs: Array<{
      sessionIds: string[];
      gatewayKeyIds: string[];
      teardown: boolean;
    }> = [];
    let pendingAlone = -1;
    let pendingBeside = -1;
    try {
      await sql.begin(async (tx) => {
        await scheduleOrganizationSandboxRetirement(tx, orgId);
        retirementJobs = await tx<
          { sessionIds: string[]; gatewayKeyIds: string[]; teardown: boolean }[]
        >`
          SELECT data -> 'sessionIds' AS "sessionIds",
                 data -> 'gatewayKeyIds' AS "gatewayKeyIds",
                 (data ->> 'teardown')::boolean AS teardown
          FROM pgboss.job
          WHERE name = 'sandbox.retire_organization'
            AND data ->> 'organizationId' = ${orgId}
        `;
        // The last slice waits for the others before it lets go of the
        // devices: one retirementJobs beside it counts, it alone does not.
        pendingAlone = await pendingOrganizationSlices(tx, orgId);
        await addJobInTx(tx, 'sandbox.retire_organization', {
          organizationId: orgId,
          sessionIds: [],
          gatewayKeyIds: [],
          deviceIds: [],
          teardown: false,
        });
        pendingBeside = await pendingOrganizationSlices(tx, orgId);
        throw new RollbackProbe('probe only');
      });
    } catch (error) {
      if (!(error instanceof RollbackProbe)) throw error;
    }
    const job = retirementJobs[0];
    record(
      'workspace cleanup: an organization’s deletion queues the teardown of what it leaves behind',
      retirementJobs.length === 1 &&
        job !== undefined &&
        job.sessionIds.includes(kept) &&
        job.sessionIds.includes(healed) &&
        !job.sessionIds.includes(settledRun) &&
        job.gatewayKeyIds.includes('itest-token-key') &&
        job.teardown &&
        pendingAlone === 0 &&
        pendingBeside === 1,
      JSON.stringify({ retirementJobs, pendingAlone, pendingBeside }),
    );
  } finally {
    await sql`DELETE FROM "member" WHERE "organizationId" = ${orgId}`;
    await sql`DELETE FROM app.organization_tombstones WHERE org_id = ${deletedOrg}`;
    await sql`DELETE FROM app.legal_holds WHERE org_id = ${orgId}`;
    await sql`DELETE FROM app.sandbox_workspace_retention WHERE org_id = ${orgId}`;
    await sql`DELETE FROM app.project_agent_runs WHERE org_id = ${orgId}`;
    await sql`DELETE FROM app.projects WHERE org_id = ${orgId}`;
    await sql`DELETE FROM app.sandbox_session_ops WHERE org_id = ${orgId}`;
    await sql`DELETE FROM app.sandbox_session_tokens WHERE org_id = ${orgId}`;
    await sql`DELETE FROM app.sandbox_sessions WHERE org_id = ${orgId}`;
    await sql`
      DELETE FROM app.sandbox_sessions
      WHERE org_id = ${ctx.orgId} AND session_id = ${stillMember}
    `;
    await sql`DELETE FROM app.audit_logs WHERE org_id = ${orgId}`;
    await sql`DELETE FROM app.audit_chain_heads WHERE org_id = ${orgId}`;
    await sql`DELETE FROM pgboss.job WHERE data ->> 'organizationId' = ${orgId}`;
    await sql`DELETE FROM "organization" WHERE "id" = ${orgId}`;
  }
}
