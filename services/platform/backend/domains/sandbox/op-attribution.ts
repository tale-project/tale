import type { Sql, TransactionSql } from 'postgres';

/**
 * Who a sandbox session op spends on behalf of — the usage ledger's
 * attribution axes (`user_id`, `agent_slug`) derived from the run the op
 * serves, so the hosts stay lane-neutral:
 *
 *  - a task-agent op is one project-agent run: the person who started the
 *    run (a retry continues its starter's kick), under the agent's name;
 *  - a workflow-agent op runs in a per-execution session whose owner is the
 *    automation run: the person who started the run, under the automation.
 *
 * The op row's own `user_id`/`agent_slug` (stamped by the reservation) are
 * the fallback for an op whose run row is already gone.
 */
export interface SessionOpAttribution {
  userId: string;
  agentSlug?: string;
}

export async function resolveSessionOpAttribution(
  sql: Sql | TransactionSql,
  args: {
    organizationId: string;
    sessionId: string;
    execId: string;
    kind: string;
  },
): Promise<SessionOpAttribution | null> {
  if (args.kind === 'task-agent') {
    const rows = await sql<{ startedBy: string; agentName: string | null }[]>`
      SELECT r.started_by AS "startedBy", a.name AS "agentName"
      FROM app.project_agent_runs r
      LEFT JOIN app.project_agents a ON a.id = r.agent_id
      WHERE r.org_id = ${args.organizationId}
        AND r.session_id = ${args.sessionId} AND r.exec_id = ${args.execId}
      ORDER BY r.seq DESC
      LIMIT 1
    `;
    const row = rows[0];
    if (row !== undefined) {
      return {
        userId: row.startedBy,
        ...(row.agentName !== null ? { agentSlug: row.agentName } : {}),
      };
    }
  } else if (args.kind === 'workflow-agent') {
    const rows = await sql<{ startedBy: string; name: string }[]>`
      SELECT ar.started_by AS "startedBy", ar.name
      FROM app.sandbox_sessions s
      JOIN app.automation_runs ar
        ON ar.org_id = s.org_id AND ar.id = split_part(s.owner_id, ':', 1)
      WHERE s.org_id = ${args.organizationId}
        AND s.session_id = ${args.sessionId}
        AND s.owner_type = 'workflow_run'
      ORDER BY s.created_at_ms DESC
      LIMIT 1
    `;
    const row = rows[0];
    if (row !== undefined)
      return { userId: row.startedBy, agentSlug: row.name };
  }
  const stamped = await sql<
    { userId: string | null; agentSlug: string | null }[]
  >`
    SELECT user_id AS "userId", agent_slug AS "agentSlug"
    FROM app.sandbox_session_ops
    WHERE session_id = ${args.sessionId} AND exec_id = ${args.execId}
    LIMIT 1
  `;
  const op = stamped[0];
  if (op === undefined || op.userId === null) return null;
  return {
    userId: op.userId,
    ...(op.agentSlug !== null ? { agentSlug: op.agentSlug } : {}),
  };
}

/** The ledger's `provider`/`model` from an op's `model_ref`
 * (`<providerSlug>/<gatewayModel>`, the gateway model itself being
 * `<gatewayProvider>/<modelId>`): the connector slug and the catalog id. */
export function splitModelRef(
  modelRef: string,
): { provider: string; model: string } | null {
  const slash = modelRef.indexOf('/');
  if (slash <= 0) return null;
  const provider = modelRef.slice(0, slash);
  const gatewayModel = modelRef.slice(slash + 1);
  const inner = gatewayModel.indexOf('/');
  const model = inner >= 0 ? gatewayModel.slice(inner + 1) : gatewayModel;
  if (model === '') return null;
  return { provider, model };
}
