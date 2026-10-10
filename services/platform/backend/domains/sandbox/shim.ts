import { transactSerializable } from '@tale/shared/db/serializable';
import type { TaskAgentResumeFrom } from '@tale/shared/schemas/task-review';
import type { Sql, TransactionSql } from 'postgres';

import { parseRunStarter } from '../../../lib/shared/run-starter.ts';
import { SANDBOX_SESSION_LIVE_STATUSES } from '../../core/sandbox/session_constants.ts';
import { isStandingProjectAgentSession } from '../../core/sandbox/session_naming.ts';
import type { ShimHandlers } from '../../lib/ctx-shim.ts';
import { resolveAgentSecretsEnv } from '../agent_secrets/service.ts';
import { automationAskShimHandlers } from '../automations/ask-shim.ts';
import { resolveAutomationRunBinding } from '../automations/run-binding.ts';
import { chatShimHandlers } from '../chat/shim.ts';
import { resolveCredentialRowForShim } from '../connector_credentials/service.ts';
import { listDocumentsForAgent } from '../documents/agent-list.ts';
import {
  automationRunKnowledgeScope,
  projectsKnowledgeScope,
} from '../knowledge/automation-scope.ts';
import { updateAgentTaskMetadata } from '../tasks/agent-metadata.ts';
import {
  authorizeAgentReviewFile,
  stageAgentReviewFile,
} from '../tasks/agent-review-files.ts';
import { reviewAgentTask } from '../tasks/agent-review.ts';
import {
  startDelegatedAgentRun,
  withStartWait,
} from '../tasks/delegated-start.ts';
import { TaskError } from '../tasks/errors.ts';
import {
  startAgentReviewBatch,
  readAgentReviewBatch,
} from '../tasks/review-batches.ts';
import { delegateAgentTaskReview } from '../tasks/review-delegation.ts';
import {
  isTaskRunConfined,
  runStarterMayEditProject,
} from '../tasks/run-authority.ts';
import { getCurrentUser } from '../users/service.ts';
import { imageGenerationShimHandlers } from './image-generation.ts';
import { coded, workspaceWriteShimHandlers } from './workspace-write-shim.ts';

/**
 * Handler map for the REUSED workspace-tool bridge
 * (`node_only/sandbox/workspace_tools_bridge.ts`) — everything the chat
 * lane's shim already answers (knowledge search, entity queries, the read
 * matrix, audit) plus the session-scoped seams the bridge adds: the
 * binding-derived access resolvers, the tool-call ledger, the write lane
 * (`workspace-write-shim.ts`, the trusted agent-comment writer included), and
 * the ask lane (`automations/ask-shim.ts`).
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
  /** Who the session belongs to: a project agent's session also answers to
   * the person who started each run on it. */
  ownerType?: 'project_agent' | 'workflow_run';
  /** `org_run` only: the automation's bound projects, empty when it is truly
   * org-level. */
  boundProjectIds?: string[];
}

async function resolveSessionBinding(
  sql: Sql | TransactionSql,
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
          ownerType: 'project_agent',
        };
      }
    }
    return { kind: 'none' };
  }
  if (session.ownerType === 'workflow_run') {
    // Step-scoped owners are `${runId}:<suffix>` (the 0.4 spelling the
    // automation host still mints).
    const runId = session.ownerId.split(':')[0] ?? '';
    return resolveAutomationRunBinding(sql, organizationId, runId);
  }
  return { kind: 'none' };
}

/**
 * How far a project agent's task run may act, by the run the turn's token
 * names: `ended` when that run is no longer live (its tools act for nobody),
 * `revoked` when a schedule began it and that schedule may no longer act in
 * the project (paused, removed, or its automation unbound — the run acts for
 * nobody either), a task id when the run is confined to that task (a member
 * started it, see `tasks/run-authority.ts`), neither when it acts with the
 * agent's full project authority. A token that names no run predates the
 * field — only the standing workspace existed then, and a member's
 * workspace never lacks it.
 */
async function taskRunConfinement(
  sql: Sql | TransactionSql,
  args: {
    organizationId: string;
    sessionId: string;
    agentId: string;
    projectId: string;
    execId?: string;
  },
): Promise<'ended' | 'revoked' | { taskId?: string }> {
  if (args.execId === undefined) {
    return isStandingProjectAgentSession(args.agentId, args.sessionId)
      ? {}
      : 'ended';
  }
  const runs = await sql<
    {
      taskId: string;
      projectId: string;
      agentId: string;
      sessionId: string;
      startedBy: string;
    }[]
  >`
    SELECT task_id AS "taskId", project_id AS "projectId",
           agent_id AS "agentId", session_id AS "sessionId",
           started_by AS "startedBy"
    FROM app.project_agent_runs
    WHERE org_id = ${args.organizationId} AND session_id = ${args.sessionId}
      AND exec_id = ${args.execId} AND status IN ('queued', 'running')
    ORDER BY seq DESC
    LIMIT 1
  `;
  const run = runs[0];
  if (
    run === undefined ||
    run.agentId !== args.agentId ||
    run.projectId !== args.projectId
  )
    return 'ended';
  if (
    parseRunStarter(run.startedBy).kind === 'trigger' &&
    !(await runStarterMayEditProject(sql, {
      organizationId: args.organizationId,
      projectId: run.projectId,
      startedBy: run.startedBy,
    }))
  ) {
    return 'revoked';
  }
  const confined = await isTaskRunConfined(sql, {
    organizationId: args.organizationId,
    ...run,
  });
  return confined ? { taskId: run.taskId } : {};
}

/** The same session and starter gate for project-wide task mutations.
 * A caller-named actor/project never crosses this boundary. */
async function requireProjectTaskRun(
  tx: TransactionSql,
  args: {
    organizationId: string;
    sessionId: string;
    taskRunExecId?: string;
  },
  code: 'TASK_METADATA_FORBIDDEN' | 'TASK_REVIEW_FORBIDDEN',
): Promise<{ projectId: string; agentId: string; execId: string }> {
  const binding = await resolveSessionBinding(
    tx,
    args.organizationId,
    args.sessionId,
  );
  if (
    binding.kind !== 'project' ||
    binding.ownerType !== 'project_agent' ||
    binding.projectId === undefined ||
    binding.actorId === undefined ||
    args.taskRunExecId === undefined
  ) {
    throw new TaskError(
      code,
      'Only a live project agent run may change task metadata or review work',
      403,
    );
  }
  const confinement = await taskRunConfinement(tx, {
    organizationId: args.organizationId,
    sessionId: args.sessionId,
    agentId: binding.actorId,
    projectId: binding.projectId,
    execId: args.taskRunExecId,
  });
  if (
    confinement === 'ended' ||
    confinement === 'revoked' ||
    confinement.taskId !== undefined
  ) {
    throw new TaskError(
      code,
      'This run no longer has project-wide task authority',
      403,
    );
  }
  return {
    projectId: binding.projectId,
    agentId: binding.actorId,
    execId: args.taskRunExecId,
  };
}

export function sandboxToolShimHandlers(sql: Sql): ShimHandlers {
  const base = chatShimHandlers(sql);
  return {
    // The lanes the dispatch reaches beyond the read doors: the task /
    // document writers, `ask_human`, and `generate_image`'s turn, budget and
    // ledger seams. All are stated here because the in-container dispatch
    // builds ITS shim from this map alone.
    ...workspaceWriteShimHandlers(sql),
    ...automationAskShimHandlers(sql),
    ...imageGenerationShimHandlers(sql),

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
      // The 0.4 row shape the reused resolver reads — one shared answer with
      // the conversations shim (the mailbox sync's heal runs the same
      // resolver), so the two cannot drift.
      return resolveCredentialRowForShim(sql, args);
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
          scope: await projectsKnowledgeScope(sql, args.organizationId, [
            binding.projectId,
          ]),
        };
      }
      if (binding.kind === 'org_run') {
        // What any step of an automation run reads: its bound projects, or
        // the hub alone for an automation bound to none.
        return {
          allowed: true,
          scope: await automationRunKnowledgeScope(sql, args.organizationId, {
            boundProjectIds: binding.boundProjectIds ?? [],
          }),
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
        /** The exec of the task run a task turn's token names. */
        taskRunExecId?: string;
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
        // A project agent's session answers to the person who started the
        // run: a member's run acts on its own task alone.
        const confinement =
          binding.ownerType === 'project_agent'
            ? await taskRunConfinement(sql, {
                organizationId: args.organizationId,
                sessionId: args.sessionId,
                agentId: binding.actorId,
                projectId: binding.projectId,
                ...(args.taskRunExecId !== undefined
                  ? { execId: args.taskRunExecId }
                  : {}),
              })
            : {};
        if (confinement === 'ended') {
          return { allowed: false, reason: 'run_ended' };
        }
        if (confinement === 'revoked') {
          return { allowed: false, reason: 'schedule_revoked' };
        }
        return {
          allowed: true,
          actorId: binding.actorId,
          scope: { kind: 'project', projectId: binding.projectId },
          ...(confinement.taskId !== undefined
            ? { confinedToTaskId: confinement.taskId }
            : {}),
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

    'tasks/internal_mutations:agentUpdateTaskMetadata': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- internal bridge boundary; metadata is validated again by the domain
      const args = raw as {
        organizationId: string;
        sessionId: string;
        taskRunExecId?: string;
        patch: unknown;
      };
      return coded(() =>
        transactSerializable(sql, async (tx) => {
          const authority = await requireProjectTaskRun(
            tx,
            args,
            'TASK_METADATA_FORBIDDEN',
          );
          return updateAgentTaskMetadata(tx, {
            organizationId: args.organizationId,
            projectId: authority.projectId,
            actorId: authority.agentId,
            patch: args.patch,
          });
        }),
      );
    },

    'tasks/internal_actions:stageAgentReviewFile': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- internal bridge boundary; the complete operation is validated by the domain
      const args = raw as {
        organizationId: string;
        sessionId: string;
        taskRunExecId?: string;
        request: unknown;
      };
      return coded(() =>
        stageAgentReviewFile(args.sessionId, args.request, (request) =>
          transactSerializable(sql, async (tx) => {
            const authority = await requireProjectTaskRun(
              tx,
              args,
              'TASK_REVIEW_FORBIDDEN',
            );
            return authorizeAgentReviewFile(
              tx,
              {
                organizationId: args.organizationId,
                sessionId: args.sessionId,
                ...authority,
              },
              request,
            );
          }),
        ),
      );
    },

    'tasks/internal_mutations:agentReviewBatch': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- internal bridge boundary; the domain validates the complete request
      const args = raw as {
        organizationId: string;
        sessionId: string;
        taskRunExecId?: string;
        request: { operation?: unknown };
      };
      return coded(() =>
        transactSerializable(sql, async (tx) => {
          const authority = await requireProjectTaskRun(
            tx,
            args,
            'TASK_REVIEW_FORBIDDEN',
          );
          const auth = {
            organizationId: args.organizationId,
            sessionId: args.sessionId,
            ...authority,
          };
          return args.request?.operation === 'read_batch'
            ? readAgentReviewBatch(tx, auth, args.request)
            : startAgentReviewBatch(tx, auth, args.request);
        }),
      );
    },

    'tasks/internal_mutations:agentReviewTask': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- internal bridge boundary; the domain validates the complete review input
      const args = raw as {
        organizationId: string;
        sessionId: string;
        taskRunExecId?: string;
        review: unknown;
      };
      return coded(() =>
        transactSerializable(sql, async (tx) => {
          const authority = await requireProjectTaskRun(
            tx,
            args,
            'TASK_REVIEW_FORBIDDEN',
          );
          return reviewAgentTask(
            tx,
            {
              organizationId: args.organizationId,
              sessionId: args.sessionId,
              ...authority,
            },
            args.review,
          );
        }),
      );
    },

    'tasks/internal_mutations:agentDelegateTaskReview': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- internal bridge boundary; the domain validates the complete delegation input
      const args = raw as {
        organizationId: string;
        sessionId: string;
        taskRunExecId?: string;
        review: unknown;
      };
      return coded(() =>
        transactSerializable(sql, async (tx) => {
          const authority = await requireProjectTaskRun(
            tx,
            args,
            'TASK_REVIEW_FORBIDDEN',
          );
          return delegateAgentTaskReview(
            tx,
            {
              organizationId: args.organizationId,
              sessionId: args.sessionId,
              ...authority,
            },
            args.review,
          );
        }),
      );
    },

    'tasks/internal_mutations:agentStartTaskAgent': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the bridge narrows every argument before calling
      const args = raw as {
        organizationId: string;
        sessionId: string;
        taskRunExecId?: string;
        taskId: string;
        agentId?: string;
        feedback?: string;
        moveToInProgress?: boolean;
        resumeFrom?: TaskAgentResumeFrom;
      };
      // A project agent's live run delegates on behalf of whoever it answers
      // to (`delegated-start.ts`); the session proves the agent and the
      // project, the token's exec proves the run. Nothing else delegates
      // through a tool: an automation starts agents with its
      // `task.start_agent` step.
      return coded(async () => {
        const binding = await resolveSessionBinding(
          sql,
          args.organizationId,
          args.sessionId,
        );
        if (
          binding.kind !== 'project' ||
          binding.ownerType !== 'project_agent' ||
          binding.projectId === undefined ||
          binding.actorId === undefined
        ) {
          throw new TaskError(
            'AGENT_START_FORBIDDEN',
            'Only a project agent run can put another agent to work; an automation uses a task.start_agent step',
            403,
          );
        }
        if (args.taskRunExecId === undefined) {
          throw new TaskError(
            'AGENT_START_FORBIDDEN',
            'This turn names no run to delegate from',
            403,
          );
        }
        const projectId = binding.projectId;
        const agentId = binding.actorId;
        const execId = args.taskRunExecId;
        const outcome = await transactSerializable(sql, async (tx) => {
          const runs = await tx<
            { id: string; startedBy: string; apiKeyId: string | null }[]
          >`
            SELECT id, started_by AS "startedBy", api_key_id AS "apiKeyId"
            FROM app.project_agent_runs
            WHERE org_id = ${args.organizationId}
              AND session_id = ${args.sessionId} AND exec_id = ${execId}
              AND agent_id = ${agentId} AND status IN ('queued', 'running')
            ORDER BY seq DESC
            LIMIT 1
          `;
          const run = runs[0];
          if (run === undefined) {
            throw new TaskError(
              'AGENT_START_FORBIDDEN',
              'The run asking to start an agent has ended; only a live run may put another agent to work',
              403,
            );
          }
          return startDelegatedAgentRun(tx, {
            organizationId: args.organizationId,
            scopeProjectIds: [projectId],
            taskId: args.taskId,
            startedBy: run.startedBy,
            ...(run.apiKeyId !== null ? { apiKeyId: run.apiKeyId } : {}),
            via: { kind: 'agent', runId: run.id, agentId },
            ...(args.agentId !== undefined ? { agentId: args.agentId } : {}),
            ...(args.feedback !== undefined ? { feedback: args.feedback } : {}),
            ...(args.moveToInProgress !== undefined
              ? { moveToInProgress: args.moveToInProgress }
              : {}),
            ...(args.resumeFrom !== undefined
              ? { resumeFrom: args.resumeFrom }
              : {}),
          });
        });
        // Whether the run it started waits for a worker, read once the
        // start has committed: the manager learns the agent is not working
        // yet.
        return withStartWait(sql, args.organizationId, outcome);
      });
    },

    // `documents/internal_queries:findDocumentByFileId` is inherited from the
    // chat map — both read doors consult the same row (scope + inline content).

    'documents/internal_queries:listDocumentsForScope': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the bridge passes exactly this subset
      const args = raw as {
        organizationId: string;
        teamIds: string[];
        projectId?: string;
        /** The binding's project set — one for a project session, every
         * bound project for a multi-bound automation's run. */
        projectIds?: string[];
        fileName?: string;
        extension?: string;
        limit?: number;
        cursor?: number;
      };
      // The binding door: the bridge already resolved the scope (teams + the
      // authorized projects), so it passes straight through.
      return listDocumentsForAgent(sql, {
        organizationId: args.organizationId,
        teamIds: args.teamIds,
        ...(args.projectId !== undefined ? { projectId: args.projectId } : {}),
        ...(args.projectIds !== undefined
          ? { projectIds: args.projectIds }
          : {}),
        ...(args.fileName !== undefined ? { fileName: args.fileName } : {}),
        ...(args.extension !== undefined ? { extension: args.extension } : {}),
        ...(args.limit !== undefined ? { limit: args.limit } : {}),
        ...(args.cursor !== undefined ? { cursor: args.cursor } : {}),
      });
    },
  };
}
