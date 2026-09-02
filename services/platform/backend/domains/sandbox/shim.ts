import type { Sql } from 'postgres';

import { SANDBOX_SESSION_LIVE_STATUSES } from '../../core/sandbox/session_constants.ts';
import type { ShimHandlers } from '../../lib/ctx-shim.ts';
import { resolveAgentSecretsEnv } from '../agent_secrets/service.ts';
import { automationAskShimHandlers } from '../automations/ask-shim.ts';
import { chatShimHandlers } from '../chat/shim.ts';
import { findCredentialForRef } from '../connector_credentials/service.ts';
import { listDocumentsForAgent } from '../documents/agent-list.ts';
import { addTaskComment } from '../tasks/comments.ts';
import { getCurrentUser } from '../users/service.ts';
import { workspaceWriteShimHandlers } from './workspace-write-shim.ts';

/**
 * Handler map for the REUSED workspace-tool bridge
 * (`node_only/sandbox/workspace_tools_bridge.ts`) — everything the chat
 * lane's shim already answers (knowledge search, entity queries, the read
 * matrix, audit) plus the session-scoped seams the bridge adds: the
 * binding-derived access resolvers, the tool-call ledger, the trusted
 * agent-comment writer, the write lane (`workspace-write-shim.ts`), and the
 * ask lane (`automations/ask-shim.ts`).
 *
 * Binding resolution mirrors 0.4's `sandbox/workspace_access.sessionBinding`
 * for every owner 0.5 has:
 *
 *  - a `project_agent` session acts inside its agent's project;
 *  - a `workflow_run` session acts as its automation run — pinned to the
 *    run's project, or ORG-WIDE ACROSS THE AUTOMATION'S BOUND PROJECTS when
 *    the run carries none (an automation with no bindings is org-level, and
 *    reads the whole organization);
 *  - a user-keyed session may READ as that user.
 *
 * Fail-closed everywhere else: a run whose project row is gone resolves to
 * `none` rather than widening to the org.
 */

interface BindingResolution {
  kind: 'project' | 'org_run' | 'none';
  projectId?: string;
  actorId?: string;
  /** `org_run` only: the automation's bound projects, empty when it is truly
   * org-level. */
  boundProjectIds?: string[];
}

/**
 * The projects an org-wide automation run may act on — the deploy-time
 * bindings of the automation this run belongs to.
 *
 * Read STRAIGHT off the binding rows, never joined against `projects`: an
 * empty set means "org-level, unbounded", so a join that dropped a row would
 * WIDEN this run's authority. An id whose project is gone simply matches
 * nothing downstream, which is the fail-closed direction.
 */
async function boundProjectIdsOf(
  sql: Sql,
  organizationId: string,
  automationName: string,
): Promise<string[]> {
  const rows = await sql<{ projectId: string }[]>`
    SELECT project_id AS "projectId"
    FROM app.automation_project_bindings
    WHERE org_id = ${organizationId}
      AND automation_name = ${automationName}
  `;
  return rows.map((row) => row.projectId);
}

async function resolveSessionBinding(
  sql: Sql,
  organizationId: string,
  sessionId: string,
): Promise<BindingResolution> {
  const sessions = await sql<{ ownerType: string; ownerId: string }[]>`
    SELECT owner_type AS "ownerType", owner_id AS "ownerId"
    FROM app.sandbox_sessions
    WHERE session_id = ${sessionId} AND org_id = ${organizationId}
    ORDER BY created_at_ms DESC
    LIMIT 1
  `;
  const session = sessions[0];
  if (!session) return { kind: 'none' };
  if (session.ownerType === 'project_agent') {
    const agents = await sql<{ id: string; projectId: string }[]>`
      SELECT id, project_id AS "projectId" FROM app.project_agents
      WHERE id = ${session.ownerId} AND org_id = ${organizationId}
      LIMIT 1
    `;
    const agent = agents[0];
    if (agent) {
      const projects = await sql<{ id: string }[]>`
        SELECT id FROM app.projects
        WHERE id = ${agent.projectId} AND org_id = ${organizationId}
        LIMIT 1
      `;
      if (projects.length > 0) {
        return {
          kind: 'project',
          projectId: agent.projectId,
          actorId: agent.id,
        };
      }
    }
    return { kind: 'none' };
  }
  if (session.ownerType === 'workflow_run') {
    // Step-scoped owners are `${runId}:<suffix>` (the 0.4 spelling the
    // automation host still mints).
    const runId = session.ownerId.split(':')[0] ?? '';
    const runs = await sql<{ name: string; projectId: string | null }[]>`
      SELECT name, project_id AS "projectId" FROM app.automation_runs
      WHERE id = ${runId} AND org_id = ${organizationId}
      LIMIT 1
    `;
    const run = runs[0];
    if (!run) return { kind: 'none' };
    // Writes are attributed to the AUTOMATION, not to whoever started the
    // run — the same actor the engine's own task natives use.
    const actorId = `automation:${run.name}`;
    if (run.projectId !== null) {
      const projects = await sql<{ id: string }[]>`
        SELECT id FROM app.projects
        WHERE id = ${run.projectId} AND org_id = ${organizationId}
        LIMIT 1
      `;
      // A run pinned to a project whose row is gone stays fail-closed.
      if (projects.length === 0) return { kind: 'none' };
      return { kind: 'project', projectId: run.projectId, actorId };
    }
    return {
      kind: 'org_run',
      actorId,
      boundProjectIds: await boundProjectIdsOf(sql, organizationId, run.name),
    };
  }
  return { kind: 'none' };
}

/** The project's readable team set for a project-bound knowledge scope. */
async function projectKnowledgeScope(
  sql: Sql,
  organizationId: string,
  projectId: string,
): Promise<{
  teamIds: string[];
  projectIds: string[];
  includeHub: boolean;
  archivedProjectIds: string[];
}> {
  const rows = await sql<
    { teamId: string | null; shared: string[]; archivedAt: number | null }[]
  >`
    SELECT team_id AS "teamId", shared_with_team_ids AS shared,
           archived_at_ms::float8 AS "archivedAt"
    FROM app.projects
    WHERE id = ${projectId} AND org_id = ${organizationId}
    LIMIT 1
  `;
  const row = rows[0];
  const teamIds = new Set<string>([`org_${organizationId}`]);
  if (row?.teamId != null) teamIds.add(row.teamId);
  for (const teamId of row?.shared ?? []) teamIds.add(teamId);
  return {
    teamIds: [...teamIds],
    projectIds: [projectId],
    includeHub: true,
    archivedProjectIds: row?.archivedAt != null ? [projectId] : [],
  };
}

export function sandboxToolShimHandlers(sql: Sql): ShimHandlers {
  const base = chatShimHandlers(sql);
  return {
    // The two lanes the dispatch reaches beyond the read doors: the task /
    // document writers, and `ask_human`. Both are stated here because the
    // in-container dispatch builds ITS shim from this map alone.
    ...workspaceWriteShimHandlers(sql),
    ...automationAskShimHandlers(sql),

    'agent_secrets/actions:resolveAgentSecretsEnv': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the turn-equipment resolver passes exactly this shape
      const args = raw as {
        organizationId: string;
        sessionId: string;
        names: string[];
      };
      return resolveAgentSecretsEnv(sql, args);
    },

    // The turn-equipment CONNECTOR BROKER's three seams
    // (`node_only/sandbox/session_credentials.ts`): the full credential row
    // it decrypts, the Tier-2 fetch audit, and the session owner's git
    // author identity. Un-shimmed, the broker's best-effort catches degrade
    // every work-lane turn to "no credentials" silently — a granted github
    // connector must inject GITHUB_TOKEN here, not warn into the job log.
    'connector_credentials/queries:resolveCredentialRefInternal': async (
      raw,
    ) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the credential resolver passes exactly this shape
      const args = raw as {
        organizationId: string;
        connectorSlug: string;
        credentialRef?: string;
      };
      const row = await findCredentialForRef(sql, args);
      if (row === null) return null;
      // The 0.4 row shape the reused resolver reads — nullable columns are
      // ABSENT fields there, never nulls.
      return {
        _id: row.id,
        organizationId: row.organizationId,
        connectorSlug: row.connectorSlug,
        authMethod: row.authMethod,
        name: row.name,
        encryptedData: row.encryptedData,
        ...(row.endpointUrl !== null ? { endpointUrl: row.endpointUrl } : {}),
        ...(row.config !== null ? { config: row.config } : {}),
        status: row.status,
        ...(row.statusDetail !== null
          ? { statusDetail: row.statusDetail }
          : {}),
      };
    },

    'sandbox/session_mutations:recordCredentialAccess': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the credential broker passes exactly this shape
      const args = raw as {
        organizationId: string;
        sessionId: string;
        slug: string;
        kind: 'bootstrap' | 'git';
      };
      await sql`
        INSERT INTO app.sandbox_credential_access (
          org_id, session_id, slug, kind, fetched_at_ms
        ) VALUES (
          ${args.organizationId}, ${args.sessionId}, ${args.slug},
          ${args.kind}, ${Date.now()}
        )
      `;
      return null;
    },

    'sandbox/session_queries:getSessionOwnerIdentity': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the credential broker passes exactly this shape
      const args = raw as { sessionId: string };
      const rows = await sql<{ createdBy: string }[]>`
        SELECT created_by AS "createdBy" FROM app.sandbox_sessions
        WHERE session_id = ${args.sessionId}
          AND status IN ${sql([...SANDBOX_SESSION_LIVE_STATUSES])}
        ORDER BY created_at_ms DESC
        LIMIT 1
      `;
      const createdBy = rows[0]?.createdBy;
      if (createdBy === undefined) return null;
      // A synthetic owner (`system:automation`) matches no user row and
      // resolves to null — the broker then injects no git author identity.
      const user = await getCurrentUser(sql, createdBy);
      if (user === null) return null;
      const email = (user.email ?? '').trim();
      const name = (user.name ?? '').trim() || email;
      if (name === '' || email === '') return null;
      return { name, email };
    },

    ...base,

    'sandbox/session_mutations:recordToolCall': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the bridge passes exactly this shape
      const args = raw as {
        organizationId: string;
        sessionId: string;
        tool: string;
        userId?: string;
        outcome: string;
        paramsFingerprint?: string;
        knowledgeRefs?: string[];
        mintedKeyId?: string;
      };
      await sql`
        INSERT INTO app.sandbox_tool_calls (
          org_id, session_id, tool, user_id, outcome, params_fingerprint,
          knowledge_refs, minted_key_id, created_at_ms
        ) VALUES (
          ${args.organizationId}, ${args.sessionId}, ${args.tool},
          ${args.userId ?? null}, ${args.outcome},
          ${args.paramsFingerprint ?? null},
          ${args.knowledgeRefs !== undefined ? args.knowledgeRefs.slice(0, 50) : null},
          ${args.mintedKeyId ?? null}, ${Date.now()}
        )
      `;
      return null;
    },

    'sandbox/workspace_access:resolveKnowledgeToolAccess': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the bridge passes exactly this shape
      const args = raw as {
        organizationId: string;
        sessionId: string;
        userId?: string;
        subject: 'documents' | 'websites';
      };
      const binding = await resolveSessionBinding(
        sql,
        args.organizationId,
        args.sessionId,
      );
      if (binding.kind === 'project' && binding.projectId !== undefined) {
        return {
          allowed: true,
          scope: await projectKnowledgeScope(
            sql,
            args.organizationId,
            binding.projectId,
          ),
        };
      }
      if (binding.kind === 'org_run') {
        // An org-level run reads the org HUB — the knowledge every member
        // shares — not the union of every project's attached files. The
        // pseudo-team is what makes a hub document visible at all in 0.5.
        return {
          allowed: true,
          scope: {
            teamIds: [`org_${args.organizationId}`],
            projectIds: [],
            includeHub: true,
            archivedProjectIds: [],
          },
        };
      }
      if (args.userId !== undefined) {
        // A user-keyed session reads what that USER reads — the same
        // resolver the chat lane uses.
        const resolve =
          base['documents/internal_queries:resolveKnowledgeAccess'];
        if (resolve === undefined) {
          return { allowed: false, reason: 'no_access_context' };
        }
        const scope = await resolve({
          organizationId: args.organizationId,
          userId: args.userId,
        });
        return { allowed: true, scope };
      }
      return { allowed: false, reason: 'no_access_context' };
    },

    'sandbox/workspace_access:resolveSessionActionContext': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the bridge passes exactly this shape
      const args = raw as {
        organizationId: string;
        sessionId: string;
        userId?: string;
        subject: string;
        effect: 'read' | 'write';
      };
      const binding = await resolveSessionBinding(
        sql,
        args.organizationId,
        args.sessionId,
      );
      if (
        binding.kind === 'project' &&
        binding.projectId !== undefined &&
        binding.actorId !== undefined
      ) {
        return {
          allowed: true,
          actorId: binding.actorId,
          scope: { kind: 'project', projectId: binding.projectId },
        };
      }
      if (binding.kind === 'org_run' && binding.actorId !== undefined) {
        return {
          allowed: true,
          actorId: binding.actorId,
          scope: {
            kind: 'org',
            // A multi-bound automation stays inside its bound projects; only
            // an automation with NO bindings is org-wide (absent = unbounded,
            // which is the shape the bridge's target resolver reads).
            ...((binding.boundProjectIds ?? []).length > 0
              ? { allowedProjectIds: binding.boundProjectIds }
              : {}),
          },
        };
      }
      if (
        args.userId !== undefined &&
        args.effect === 'read' &&
        args.subject !== 'tasks'
      ) {
        const readAllowed =
          base['sandbox/workspace_access:resolveWorkspaceReadAccess'];
        if (readAllowed !== undefined) {
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the chat-shim handler returns exactly this shape
          const access = (await readAllowed({
            organizationId: args.organizationId,
            userId: args.userId,
            subject: args.subject,
          })) as { allowed: boolean };
          if (!access.allowed) {
            return { allowed: false, reason: 'read_denied' };
          }
        }
        return { allowed: true, actorId: args.userId, scope: { kind: 'org' } };
      }
      return { allowed: false, reason: 'no_access_context' };
    },

    // `documents/internal_queries:findDocumentByFileId` is inherited from the
    // chat map — both read doors consult the same row (scope + inline content).

    'documents/internal_queries:listDocumentsForScope': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the bridge passes exactly this subset
      const args = raw as {
        organizationId: string;
        teamIds: string[];
        projectId?: string;
        fileName?: string;
        extension?: string;
        limit?: number;
        cursor?: number;
      };
      // The binding door: the bridge already resolved the scope (teams + at
      // most one project), so it passes straight through.
      return listDocumentsForAgent(sql, {
        organizationId: args.organizationId,
        teamIds: args.teamIds,
        ...(args.projectId !== undefined ? { projectId: args.projectId } : {}),
        ...(args.fileName !== undefined ? { fileName: args.fileName } : {}),
        ...(args.extension !== undefined ? { extension: args.extension } : {}),
        ...(args.limit !== undefined ? { limit: args.limit } : {}),
        ...(args.cursor !== undefined ? { cursor: args.cursor } : {}),
      });
    },

    'tasks/internal_mutations:agentAddComment': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the bridge passes exactly this shape
      const args = raw as {
        organizationId: string;
        actorId: string;
        taskId: string;
        body: string;
      };
      // The bridge already resolved WRITE authority (a project-bound
      // session); this writer is the trusted lower half, so it runs with an
      // administrative auth attributed to the agent actor.
      return sql.begin(async (tx) => {
        const { messageId, threadId } = await addTaskComment(
          tx,
          {
            organizationId: args.organizationId,
            userId: args.actorId,
            role: 'admin',
            teamIds: [],
          },
          {
            taskId: args.taskId,
            body: args.body,
            author: { actorType: 'agent', actorId: args.actorId },
          },
        );
        return { messageId, threadId, mentionCount: 0 };
      });
    },
  };
}
