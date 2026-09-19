import type { Sql, TransactionSql } from 'postgres';

import { AUTOMATION_SUBJECT_ID } from '../../../lib/shared/constants/usage.ts';
import { parseRunStarter } from '../../../lib/shared/run-starter.ts';

/**
 * The billing subject of a sandbox session op — the usage ledger's
 * attribution axes (`user_id`, `agent_slug`, `api_key_id`) derived from the
 * run the op serves, so the hosts stay lane-neutral. The contract is
 * `domains/governance/README.md`; in short:
 *
 *  - a task-agent op is one project-agent run: the person who started the
 *    run (a retry continues its starter's kick), under the agent's ID;
 *  - a workflow-agent op runs in a per-execution session whose owner is the
 *    automation run: the person the run's starter names, under the
 *    automation's name, plus the API key when a keyed door started it; a run
 *    a TRIGGER started names nobody and books under `__automation__`.
 *
 * `started_by` is the door (`user:`/`api-key:`/`trigger:`), never copied
 * into the ledger as it is — `parseRunStarter` is the one reader of that
 * format. The op row's own stamp (written by the reservation from this very
 * resolver) is the fallback for an op whose run row is already gone.
 */
export interface SessionOpAttribution {
  userId: string;
  agentSlug?: string;
  apiKeyId?: string;
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
    const rows = await sql<{ startedBy: string; agentId: string }[]>`
      SELECT r.started_by AS "startedBy", r.agent_id AS "agentId"
      FROM app.project_agent_runs r
      WHERE r.org_id = ${args.organizationId}
        AND r.session_id = ${args.sessionId} AND r.exec_id = ${args.execId}
      ORDER BY r.seq DESC
      LIMIT 1
    `;
    const row = rows[0];
    if (row !== undefined) {
      const starter = parseRunStarter(row.startedBy);
      if (starter.kind === 'user' || starter.kind === 'api-key') {
        return { userId: starter.userId, agentSlug: row.agentId };
      }
    }
  } else if (args.kind === 'workflow-agent') {
    const rows = await sql<
      { startedBy: string; name: string; apiKeyId: string | null }[]
    >`
      SELECT ar.started_by AS "startedBy", ar.name,
             ar.api_key_id AS "apiKeyId"
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
    if (row !== undefined) {
      const starter = parseRunStarter(row.startedBy);
      switch (starter.kind) {
        case 'user':
          return { userId: starter.userId, agentSlug: row.name };
        case 'api-key':
          return {
            userId: starter.userId,
            agentSlug: row.name,
            ...(row.apiKeyId !== null ? { apiKeyId: row.apiKeyId } : {}),
          };
        case 'trigger':
          return { userId: AUTOMATION_SUBJECT_ID, agentSlug: row.name };
        case 'unknown':
          break;
      }
    }
  }
  const stamped = await sql<
    {
      userId: string | null;
      agentSlug: string | null;
      apiKeyId: string | null;
    }[]
  >`
    SELECT user_id AS "userId", agent_slug AS "agentSlug",
           api_key_id AS "apiKeyId"
    FROM app.sandbox_session_ops
    WHERE session_id = ${args.sessionId} AND exec_id = ${args.execId}
    LIMIT 1
  `;
  const op = stamped[0];
  if (op === undefined || op.userId === null) return null;
  return {
    userId: op.userId,
    ...(op.agentSlug !== null ? { agentSlug: op.agentSlug } : {}),
    ...(op.apiKeyId !== null ? { apiKeyId: op.apiKeyId } : {}),
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
