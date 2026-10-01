import type { TransactionSql } from 'postgres';

import { addJobInTx } from '../../jobs/enqueue.ts';

/**
 * Where an owner's deletion queues the deletion of its sandbox workspaces —
 * inside the deleting transaction, so the job becomes visible only once the
 * owner is gone (and never, if the deletion rolls back). Kept free of the
 * cleanup itself (`workspace-cleanup.ts`, which the jobs run) so the doors
 * that delete owners import nothing but the queue.
 */

/** Workspaces one retirement job carries: an organization with a long
 * history is split over several jobs. */
const JOB_SESSION_LIMIT = 500;

/** Deleted project agents: their standing workspaces and every member's. */
export async function scheduleAgentWorkspaceRetirement(
  tx: TransactionSql,
  args: { organizationId: string; agentIds: readonly string[] },
): Promise<void> {
  if (args.agentIds.length === 0) return;
  await addJobInTx(tx, 'sandbox.retire_workspaces', {
    organizationId: args.organizationId,
    reason: 'agent_deleted',
    agentIds: [...args.agentIds],
  });
}

/** A member who left: their workspaces with every agent of the
 * organization. Re-checked when the job runs — a member re-added in the
 * meantime keeps them. */
export async function scheduleMemberWorkspaceRetirement(
  tx: TransactionSql,
  args: { organizationId: string; userId: string },
): Promise<void> {
  await addJobInTx(tx, 'sandbox.retire_workspaces', {
    organizationId: args.organizationId,
    reason: 'member_removed',
    userId: args.userId,
  });
}

/**
 * A deleted organization: what its sandboxes leave behind, read BEFORE the
 * deletion's cascade removes the rows naming it — the workspaces its rows
 * may still hold, the gateway keys minted for its sessions, and its devices.
 * One job per slice of workspaces; the first also carries the keys, and the
 * last releases the devices and tears the organization down on the spawner
 * once every other slice has finished.
 */
export async function scheduleOrganizationSandboxRetirement(
  tx: TransactionSql,
  organizationId: string,
): Promise<void> {
  // Every workspace its rows may still hold — a project agent's even when
  // all of them read destroyed: a phantom heal settles a row whose container
  // vanished while the spawner keeps the workspace for the next turn.
  const sessions = await tx<{ sessionId: string }[]>`
    SELECT session_id AS "sessionId" FROM app.sandbox_sessions
    WHERE org_id = ${organizationId}
    GROUP BY session_id
    HAVING bool_or(status <> 'destroyed') OR bool_or(owner_type = 'project_agent')
  `;
  const keys = await tx<{ keyId: string }[]>`
    SELECT llm_gateway_key_id AS "keyId" FROM app.sandbox_session_tokens
    WHERE org_id = ${organizationId} AND revoked_at_ms IS NULL
      AND llm_gateway_key_id IS NOT NULL
    UNION
    SELECT llm_gateway_key_id FROM app.sandbox_sessions
    WHERE org_id = ${organizationId} AND llm_gateway_key_id IS NOT NULL
    UNION
    SELECT minted_key_id FROM app.sandbox_session_ops
    WHERE org_id = ${organizationId} AND minted_key_id IS NOT NULL
      AND key_revoked_at_ms IS NULL
  `;
  const devices = await tx<{ deviceId: string }[]>`
    SELECT id AS "deviceId" FROM app.sandbox_devices
    WHERE org_id = ${organizationId} AND hub_released_at_ms IS NULL
  `;
  const sessionIds = sessions.map((row) => row.sessionId);
  const slices: string[][] = [];
  for (let at = 0; at < sessionIds.length; at += JOB_SESSION_LIMIT) {
    slices.push(sessionIds.slice(at, at + JOB_SESSION_LIMIT));
  }
  if (slices.length === 0) slices.push([]);
  for (const [index, slice] of slices.entries()) {
    await addJobInTx(tx, 'sandbox.retire_organization', {
      organizationId,
      sessionIds: slice,
      gatewayKeyIds: index === 0 ? keys.map((row) => row.keyId) : [],
      deviceIds:
        index === slices.length - 1 ? devices.map((row) => row.deviceId) : [],
      teardown: index === slices.length - 1,
    });
  }
}
