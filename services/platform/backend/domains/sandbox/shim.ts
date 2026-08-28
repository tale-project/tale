import type { Sql } from 'postgres';

import type { ShimHandlers } from '../../lib/convex-shim.ts';
import { chatShimHandlers } from '../chat/shim.ts';
import { addTaskComment } from '../tasks/comments.ts';

/**
 * Handler map for the REUSED workspace-tool bridge
 * (`node_only/sandbox/workspace_tools_bridge.ts`) — everything the chat
 * lane's shim already answers (knowledge search, entity queries, the read
 * matrix, audit) plus the session-scoped seams the bridge adds: the
 * binding-derived access resolvers, the tool-call ledger, and the trusted
 * agent-comment writer.
 *
 * Binding resolution mirrors `sandbox/workspace_access.sessionBinding` for
 * the owners 0.5 has: a `project_agent` session acts inside its project;
 * `workflow_run` sessions resolve to `none` until the automations engine
 * ports (their runs cannot exist yet); a user-keyed session may READ as
 * that user. `ask_human` (`automations/human_asks:createAskForExec`) is
 * deliberately NOT in this map — a call fails loud naming the handler until
 * the automations domain lands.
 */

interface BindingResolution {
  kind: 'project' | 'none';
  projectId?: string;
  actorId?: string;
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
  // workflow_run bindings resolve with the automations engine port.
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

    'documents/internal_queries:findDocumentByFileId': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the bridge passes exactly this shape
      const args = raw as { organizationId: string; fileId: string };
      const rows = await sql<
        {
          id: string;
          title: string | null;
          fileId: string;
          projectId: string | null;
          teamId: string | null;
          teamTags: string[];
          folderPath: string | null;
          lifecycleStatus: string | null;
          createdAt: number;
        }[]
      >`
        SELECT id, title, file_ref AS "fileId", project_id AS "projectId",
               team_id AS "teamId", team_tags AS "teamTags",
               folder_path AS "folderPath",
               lifecycle_status AS "lifecycleStatus",
               created_at_ms::float8 AS "createdAt"
        FROM app.documents
        WHERE org_id = ${args.organizationId} AND file_ref = ${args.fileId}
        LIMIT 1
      `;
      return rows[0] ?? null;
    },

    'documents/internal_queries:listDocumentsForScope': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the bridge passes exactly this subset
      const args = raw as {
        organizationId: string;
        teamIds: string[];
        projectId?: string;
        fileName?: string;
        limit?: number;
        cursor?: number;
      };
      const limit = Math.min(Math.max(args.limit ?? 20, 1), 100);
      const offset = Math.max(0, args.cursor ?? 0);
      const like = `%${args.fileName?.trim() ?? ''}%`;
      const projectId = args.projectId ?? null;
      const rows = await sql<
        {
          fileId: string;
          title: string | null;
          extension: string | null;
          folderPath: string | null;
          teamId: string | null;
          createdAt: number;
          sizeBytes: number | null;
        }[]
      >`
        SELECT d.file_ref AS "fileId", d.title, d.extension,
               coalesce(d.folder_path, f.path) AS "folderPath",
               d.team_id AS "teamId", d.created_at_ms::float8 AS "createdAt",
               (d.metadata ->> 'size')::float8 AS "sizeBytes"
        FROM app.documents d
        LEFT JOIN app.folders f ON f.id = d.folder_id
        WHERE d.org_id = ${args.organizationId}
          AND d.file_ref IS NOT NULL
          AND (d.lifecycle_status IS NULL OR d.lifecycle_status = 'active')
          AND (${args.fileName === undefined} OR d.title ILIKE ${like})
          AND (
            (${projectId}::text IS NOT NULL AND d.project_id = ${projectId})
            OR (${projectId}::text IS NULL AND d.project_id IS NULL AND (
              (d.team_id IS NULL AND cardinality(d.team_tags) = 0)
              OR d.team_id = ANY(${args.teamIds})
              OR d.team_tags && ${args.teamIds}
            ))
          )
        ORDER BY d.created_at_ms DESC, d.id
        LIMIT ${limit + 1} OFFSET ${offset}
      `;
      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      return {
        documents: page.map((row) => ({
          fileId: row.fileId,
          title: row.title ?? 'Untitled',
          extension: row.extension,
          folderPath: row.folderPath,
          teamId: row.teamId,
          createdAt: row.createdAt,
          sizeBytes: row.sizeBytes,
        })),
        totalCount: null,
        hasMore,
        cursor: hasMore ? offset + limit : null,
        warning: null,
      };
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
