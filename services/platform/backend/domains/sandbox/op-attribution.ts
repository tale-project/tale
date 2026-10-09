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
 *    run (a retry continues its starter's kick), under the agent's ID — or
 *    `__automation__` when a schedule began it (`trigger:<id>`);
 *  - a workflow-agent op runs in a per-execution session whose owner is the
 *    automation run: the person the run's starter names, under the
 *    automation's name, plus the API key when a keyed door started it; a run
 *    a TRIGGER started names nobody and books under `__automation__`.
 *
 * Either run's spend is its project's too, whoever started it, which a
 * `project` budget rule measures: the project an agent's run is in, and the
 * project an automation run names — or, for a run that names none, every
 * project its automation is bound to, as such a run acts in each of them
 * (its language context, its skills and its session's reach read the same
 * binding set). An automation bound to none spends in no project.
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
  projectIds?: readonly string[];
}

/** The projects a run's spend belongs to; nothing for none. */
function inProjects(projectIds: readonly (string | null)[] | null): {
  projectIds?: readonly string[];
} {
  const ids = (projectIds ?? []).filter((id): id is string => id != null);
  return ids.length > 0 ? { projectIds: [...new Set(ids)] } : {};
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
    const rows = await sql<
      { startedBy: string; agentId: string; projectId: string | null }[]
    >`
      SELECT r.started_by AS "startedBy", r.agent_id AS "agentId",
             r.project_id AS "projectId"
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
        return {
          userId: starter.userId,
          agentSlug: row.agentId,
          ...inProjects([row.projectId]),
        };
      }
      // A run a schedule began (an automation's start step, or an agent
      // that run delegated to) names no person: like every run a trigger
      // starts, it books under the automation subject.
      if (starter.kind === 'trigger') {
        return {
          userId: AUTOMATION_SUBJECT_ID,
          agentSlug: row.agentId,
          ...inProjects([row.projectId]),
        };
      }
    }
  } else if (args.kind === 'workflow-agent') {
    const runs = await sql<{ runId: string }[]>`
      SELECT ar.id AS "runId"
      FROM app.sandbox_sessions s
      JOIN app.automation_runs ar
        ON ar.org_id = s.org_id AND ar.id = split_part(s.owner_id, ':', 1)
      WHERE s.org_id = ${args.organizationId}
        AND s.session_id = ${args.sessionId}
        AND s.owner_type = 'workflow_run'
      ORDER BY s.created_at_ms DESC
      LIMIT 1
    `;
    const run = runs[0];
    const attribution =
      run !== undefined
        ? await resolveAutomationRunAttribution(sql, {
            organizationId: args.organizationId,
            runId: run.runId,
          })
        : null;
    if (attribution !== null) return attribution;
  }
  const stamped = await sql<
    {
      userId: string | null;
      agentSlug: string | null;
      apiKeyId: string | null;
      projectIds: string[] | null;
    }[]
  >`
    SELECT user_id AS "userId", agent_slug AS "agentSlug",
           api_key_id AS "apiKeyId", project_ids AS "projectIds"
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
    ...inProjects(op.projectIds),
  };
}

/** What an automation run's billing subject is read from. */
interface AutomationRunRow {
  startedBy: string;
  name: string;
  apiKeyId: string | null;
  projectId: string | null;
  boundProjectIds: string[] | null;
}

/** An automation run's billing subject — the one mapping its agent steps'
 * ops and its `llm` steps are both booked through. Null for a starter no
 * door writes. */
function automationRunAttribution(
  row: AutomationRunRow,
): SessionOpAttribution | null {
  const starter = parseRunStarter(row.startedBy);
  // The run's own project, or every project its automation is bound to.
  const projects = inProjects(
    row.projectId != null ? [row.projectId] : row.boundProjectIds,
  );
  switch (starter.kind) {
    case 'user':
      return { userId: starter.userId, agentSlug: row.name, ...projects };
    case 'api-key':
      return {
        userId: starter.userId,
        agentSlug: row.name,
        ...(row.apiKeyId !== null ? { apiKeyId: row.apiKeyId } : {}),
        ...projects,
      };
    case 'trigger':
      return {
        userId: AUTOMATION_SUBJECT_ID,
        agentSlug: row.name,
        ...projects,
      };
    case 'unknown':
      break;
  }
  return null;
}

/**
 * The billing subject of an automation run itself, for the spend its steps
 * make outside a sandbox session — an `llm` step's model call: the same
 * person (or `__automation__`), automation name, key and projects its
 * agent steps' ops are attributed to. Null when the run is gone or its
 * starter is unreadable.
 */
export async function resolveAutomationRunAttribution(
  sql: Sql | TransactionSql,
  args: { organizationId: string; runId: string },
): Promise<SessionOpAttribution | null> {
  const rows = await sql<AutomationRunRow[]>`
    SELECT ar.started_by AS "startedBy", ar.name,
           ar.api_key_id AS "apiKeyId", ar.project_id AS "projectId",
           (SELECT array_agg(b.project_id ORDER BY b.project_id)
            FROM app.automation_project_bindings b
            WHERE b.org_id = ar.org_id AND b.automation_name = ar.name)
             AS "boundProjectIds"
    FROM app.automation_runs ar
    WHERE ar.org_id = ${args.organizationId} AND ar.id = ${args.runId}
    LIMIT 1
  `;
  const row = rows[0];
  return row !== undefined ? automationRunAttribution(row) : null;
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
