import { transactSerializable } from '@tale/shared/db/serializable';
import type { Sql } from 'postgres';

import { AppError } from '../../../lib/shared/errors/app-error';
import { readSkillBundleForViewer } from '../../core/skills/file_actions.ts';
import { toJson } from '../../db/sql.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import type { ShimHandlers, ShimScheduler } from '../../lib/ctx-shim.ts';
import { governanceShimHandlers } from '../governance/shim.ts';
import { orgAdapterShimHandlers } from '../knowledge/service.ts';
import { credentialShimHandlers } from '../provider_credentials/service.ts';
import {
  releaseProjectAgentSessionSlot,
  reserveSessionSlot,
  resumeSessionSlot,
  SandboxQuotaError,
} from '../sandbox/sessions.ts';
import { sandboxToolShimHandlers } from '../sandbox/shim.ts';
import {
  failAgentRunFromTurn,
  kickAgentRun,
  launchAgentRun,
  settleAgentRun,
} from './agent-runs.ts';
import {
  agentRecordTaskOutputsTrusted,
  handTaskToInProgressForKick,
} from './service.ts';

/**
 * Handler map for the REUSED task-agent turn host
 * (`convex/tasks/agent_run_host.ts` — start/drive/settle) — everything the
 * sandbox tool shim already answers plus the run-ledger contract, the
 * durable op-row upserts, the trusted task writers, and the session slot
 * verbs. Quota throws are re-shaped into the `AppError QUOTA_EXCEEDED`
 * the host's park branch matches on — that mapping is what makes
 * capacity parking work at all.
 *
 * The STEER lane is answered here too (`getOpSteerState`,
 * `rotateTaskAgentRunExec`, `kickMentionRunAfterSteerMiss`) — see the
 * block below for what each guarantees.
 */

function quotaAsAppError(error: unknown): never {
  if (error instanceof SandboxQuotaError) {
    throw new AppError({ code: 'QUOTA_EXCEEDED', message: error.message });
  }
  throw error;
}

export function agentTurnShimHandlers(sql: Sql): ShimHandlers {
  return {
    ...sandboxToolShimHandlers(sql),

    // The vision-model resolution seam: `resolveTurnVisionModel` (the turn
    // start's gateway mint) walks org slug → provider default credentials →
    // the `vision_model` policy pin, all over ctx.runQuery. None of these
    // families were shimmed, so EVERY 0.5 task/automation agent turn
    // resolved vision as null — the resolver's catch turned the un-shimmed
    // throw into "text-only", and an image the agent then Read 404'd a
    // text-only serving model with no polyfill to catch it.
    ...credentialShimHandlers(sql),
    ...orgAdapterShimHandlers(sql),
    // The `vision_model` pin is read through the one governance seam every
    // ctx-shim host shares; the moderation and chat-filter-event seams it
    // also carries are inert here.
    ...governanceShimHandlers(sql),

    // ------------------------------------------------------- the run ledger
    'tasks/agent_runs:getTaskAgentRunForDrive': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the host passes exactly this shape
      const args = raw as { runId: string };
      const rows = await sql<
        {
          status: string;
          execId: string;
          sessionId: string;
          organizationId: string;
        }[]
      >`
        SELECT status, exec_id AS "execId", session_id AS "sessionId",
               org_id AS "organizationId"
        FROM app.project_agent_runs WHERE id = ${args.runId} LIMIT 1
      `;
      return rows[0] ?? null;
    },

    'tasks/agent_runs:setTaskAgentRunRunning': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the host passes exactly this shape
      const args = raw as { runId: string; execId: string };
      // Exec-fenced: a start whose exec the queued-run recovery rotated away
      // (or whose run was cancelled) learns it here and stands down instead
      // of spawning — the host reads the boolean.
      return launchAgentRun(sql, args);
    },

    'tasks/agent_runs:stampTaskAgentRunBrokerToken': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the host passes exactly this shape
      const args = raw as {
        runId: string;
        execId: string;
        brokerTokenHash: string;
      };
      await sql`
        UPDATE app.project_agent_runs SET
          broker_token_hash = ${args.brokerTokenHash},
          updated_at_ms = ${Date.now()}
        WHERE id = ${args.runId} AND exec_id = ${args.execId}
          AND status NOT IN ('settled', 'failed', 'cancelled')
      `;
      return null;
    },

    'tasks/agent_runs:markTaskAgentRunSettled': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the host passes exactly this shape
      const args = raw as Parameters<typeof settleAgentRun>[1];
      // The ledgered election lives with the run ledger: one copy of the
      // terminal flip, the provenance entry in its transaction.
      await settleAgentRun(sql, args);
      return null;
    },

    'tasks/agent_runs:markTaskAgentRunFailed': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the host passes exactly this shape
      const args = raw as Parameters<typeof failAgentRunFromTurn>[1];
      await failAgentRunFromTurn(sql, args);
      return null;
    },

    /**
     * The STEER lane's three refs. Steering a live turn means one of two
     * things depending on the harness: push the comment down the held-open
     * stdin of the running exec, or ROTATE the run onto a fresh incarnation
     * and replay the conversation with the comment in hand. Both need the
     * same two facts from this side — is the exec still taking input, and
     * can this steer claim the rotation — plus a fallback kick when the
     * steer missed the turn entirely.
     */
    'sandbox/session_queries:getOpSteerState': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the host passes exactly this shape
      const args = raw as { sessionId: string; execId: string };
      const rows = await sql<
        {
          status: string;
          finalized: boolean;
          agentSessionId: string | null;
        }[]
      >`
        SELECT status, finalized_at_ms IS NOT NULL AS finalized,
               agent_session_id AS "agentSessionId"
        FROM app.sandbox_session_ops
        WHERE session_id = ${args.sessionId} AND exec_id = ${args.execId}
        LIMIT 1
      `;
      const row = rows[0];
      if (row === undefined) return null;
      return {
        status: row.status,
        finalized: row.finalized,
        ...(row.agentSessionId !== null
          ? { agentSessionId: row.agentSessionId }
          : {}),
      };
    },

    'tasks/agent_runs:rotateTaskAgentRunExec': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the host passes exactly this shape
      const args = raw as { runId: string; fromExecId: string };
      // The SINGLE-WINNER claim: guarded on (running, fromExecId), so two
      // concurrent steers cannot both rotate — the loser re-reads and sees
      // the new incarnation. The superseded chain orphans itself because
      // every settle mark is exec-guarded.
      const execId = `${args.fromExecId}-2`;
      const rows = await sql<{ id: string }[]>`
        UPDATE app.project_agent_runs SET
          exec_id = ${execId}, updated_at_ms = ${Date.now()}
        WHERE id = ${args.runId} AND status = 'running'
          AND exec_id = ${args.fromExecId}
        RETURNING id
      `;
      return rows.length === 0 ? null : { execId };
    },

    'tasks/mutations:kickMentionRunAfterSteerMiss': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the host passes exactly this shape
      const args = raw as {
        organizationId: string;
        taskId: string;
        authorId: string;
        feedback: string;
      };
      // The steer arrived after the turn settled: the comment becomes a
      // FRESH mention run instead of vanishing. An unavailable task is a
      // refusal, never a throw — the steer path is best-effort by design.
      const tasks = await sql<
        {
          projectId: string;
          assigneeType: string | null;
          assigneeId: string | null;
        }[]
      >`
        SELECT project_id AS "projectId", assignee_type AS "assigneeType",
               assignee_id AS "assigneeId"
        FROM app.tasks
        WHERE id = ${args.taskId} AND org_id = ${args.organizationId}
          AND archived_at_ms IS NULL
        LIMIT 1
      `;
      const task = tasks[0];
      if (task === undefined) {
        return { started: false, reason: 'task_unavailable' };
      }
      if (task.assigneeType !== 'agent' || task.assigneeId === null) {
        return { started: false, reason: 'no_agent_assignee' };
      }
      const agents = await sql<
        { harness: string; model: string; modelProvider: string | null }[]
      >`
        SELECT harness, model, model_provider AS "modelProvider"
        FROM app.project_agents
        WHERE id = ${task.assigneeId} AND org_id = ${args.organizationId}
        LIMIT 1
      `;
      const agent = agents[0];
      if (agent === undefined) {
        return { started: false, reason: 'agent_unavailable' };
      }
      const kicked = await transactSerializable(sql, async (tx) => {
        const result = await kickAgentRun(tx, {
          organizationId: args.organizationId,
          projectId: task.projectId,
          taskId: args.taskId,
          agentId: task.assigneeId ?? '',
          harness: agent.harness,
          model: agent.model,
          ...(agent.modelProvider !== null
            ? { modelProvider: agent.modelProvider }
            : {}),
          trigger: 'mention',
          feedback: args.feedback,
          startedBy: args.authorId,
        });
        if (result.reused) return result;
        // The mention kick moves the card too (the 0.4 shared-core rule: the
        // board verb IS the interface): the settled predecessor parked the
        // task at `in_review`, and left there a fresh run grinds behind a
        // card that reads "waiting on review". Attributed to the comment's
        // author — the kick is their gesture, delivered late.
        await handTaskToInProgressForKick(tx, {
          organizationId: args.organizationId,
          taskId: args.taskId,
          userId: args.authorId,
        });
        return result;
      });
      // A reused live run means another turn is already carrying this work;
      // the comment rides that one rather than starting a second.
      return { started: !kicked.reused };
    },

    'tasks/agent_runs:parkTaskAgentRunForCapacity': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the host passes exactly this shape
      const args = raw as { runId: string; execId: string };
      await sql`
        UPDATE app.project_agent_runs SET
          waiting_for_capacity_at_ms = ${Date.now()},
          updated_at_ms = ${Date.now()}
        WHERE id = ${args.runId} AND exec_id = ${args.execId}
          AND status = 'queued'
      `;
      return null;
    },

    'tasks/agent_runs:getTaskBriefForAgentRun': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the host passes exactly this shape
      const args = raw as { taskId: string };
      const tasks = await sql<
        {
          title: string;
          description: string | null;
          labelIds: string[];
          number: number | null;
          projectId: string;
          attachments: unknown;
          outputs: unknown;
        }[]
      >`
        SELECT title, description, label_ids AS "labelIds", number,
               project_id AS "projectId", attachments, outputs
        FROM app.tasks WHERE id = ${args.taskId} LIMIT 1
      `;
      const task = tasks[0];
      if (!task) return null;
      const projects = await sql<{ name: string; key: string | null }[]>`
        SELECT name, key FROM app.projects
        WHERE id = ${task.projectId} LIMIT 1
      `;
      const project = projects[0];
      const identifier =
        project?.key != null && task.number !== null
          ? `${project.key}-${task.number}`
          : undefined;
      const discussion = await sql<
        { authorType: string; body: string; createdAt: number }[]
      >`
        SELECT * FROM (
          SELECT meta.author_type AS "authorType",
                 coalesce(m.text, '') AS body,
                 m.created_at_ms::float8 AS "createdAt"
          FROM app.task_discussion_message_meta meta
          JOIN app.messages m ON m.id = meta.message_id
          WHERE meta.task_id = ${args.taskId}
          ORDER BY m.created_at_ms DESC
          LIMIT 10
        ) tail ORDER BY "createdAt"
      `;
      const labelNames =
        task.labelIds.length > 0
          ? (
              await sql<{ name: string }[]>`
                SELECT name FROM app.task_labels
                WHERE id = ANY(${task.labelIds})
              `
            ).map((row) => row.name)
          : [];
      const fileList = (
        value: unknown,
      ): Array<{ fileId: string; fileName: string }> =>
        Array.isArray(value)
          ? value
              .filter(
                (entry): entry is { fileId: unknown; fileName: unknown } =>
                  entry !== null && typeof entry === 'object',
              )
              .map((entry) => ({
                fileId: typeof entry.fileId === 'string' ? entry.fileId : '',
                fileName:
                  typeof entry.fileName === 'string' ? entry.fileName : '',
              }))
              .filter((entry) => entry.fileId !== '' && entry.fileName !== '')
          : [];
      return {
        title: task.title,
        ...(task.description !== null ? { description: task.description } : {}),
        ...(labelNames.length > 0 ? { labels: labelNames } : {}),
        ...(identifier !== undefined ? { identifier } : {}),
        ...(project !== undefined ? { projectName: project.name } : {}),
        discussion: discussion.map((entry) => ({
          author: entry.authorType === 'user' ? 'user' : 'agent',
          body:
            entry.body.length > 2000
              ? `${entry.body.slice(0, 2000)}\n… (truncated)`
              : entry.body,
          at: entry.createdAt,
        })),
        attachments: fileList(task.attachments),
        outputs: fileList(task.outputs),
      };
    },

    // ------------------------------------------------- trusted task writers
    // `agentUpdateTaskStatus` is NOT restated here: the sandbox map's write
    // lane already answers it, for this host and the in-container dispatch
    // alike. Two copies of one flip would be two places to drift.
    'tasks/internal_mutations:agentRecordTaskOutputs': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the host passes exactly this shape
      const args = raw as Parameters<typeof agentRecordTaskOutputsTrusted>[1];
      await transactSerializable(sql, (tx) =>
        agentRecordTaskOutputsTrusted(tx, args),
      );
      return null;
    },

    'file_metadata/internal_mutations:saveFileMetadata': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the harvest passes exactly this shape
      const args = raw as {
        organizationId: string;
        storageId: string;
        fileName: string;
        contentType: string;
        size: number;
        source?: string;
      };
      const now = Date.now();
      // storage_ref is indexed but not unique (multiple logical rows can
      // reference one blob) — update-then-insert instead of ON CONFLICT.
      const updated = await sql<{ id: string }[]>`
        UPDATE app.file_metadata SET
          file_name = ${args.fileName}, content_type = ${args.contentType},
          size = ${args.size}, source = ${args.source ?? 'agent'}
        WHERE storage_ref = ${args.storageId}
          AND org_id = ${args.organizationId}
        RETURNING id
      `;
      if (updated.length === 0) {
        await sql`
          INSERT INTO app.file_metadata (
            org_id, storage_ref, file_name, content_type, size, source,
            created_at_ms
          ) VALUES (
            ${args.organizationId}, ${args.storageId}, ${args.fileName},
            ${args.contentType}, ${args.size}, ${args.source ?? 'agent'},
            ${now}
          )
        `;
      }
      return null;
    },

    // ---------------------------------------------------- session ops (0.4)
    'sandbox/session_mutations:upsertSessionOp': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the host passes exactly this shape
      const args = raw as {
        organizationId: string;
        sessionId: string;
        threadId?: string;
        execId: string;
        kind: string;
        status: 'running' | 'completed' | 'failed' | 'cancelled';
        progressText?: string;
        liveTimeline?: unknown[];
        agentSessionId?: string;
        exitCode?: number;
        agentResultStatus?: string;
        userId?: string;
        modelRef?: string;
        visionModelRef?: string;
        agentSlug?: string;
        deadlineMs?: number;
        heartbeatAt?: number;
        lastEventAt?: number;
        lastSeq?: number;
        mintedKeyId?: string;
        spentCents?: number;
      };
      const now = Date.now();
      const terminal = args.status !== 'running';
      const rows = await sql<{ id: string }[]>`
        INSERT INTO app.sandbox_session_ops (
          org_id, session_id, thread_id, exec_id, kind, status,
          progress_text, live_timeline, agent_session_id, exit_code,
          agent_result_status, user_id, model_ref, vision_model_ref,
          agent_slug, deadline_ms, heartbeat_at_ms, last_event_at_ms,
          last_seq, minted_key_id, spent_cents, started_at_ms,
          finished_at_ms
        ) VALUES (
          ${args.organizationId}, ${args.sessionId}, ${args.threadId ?? null},
          ${args.execId}, ${args.kind}, ${args.status},
          ${args.progressText ?? null},
          ${args.liveTimeline === undefined ? null : sql.json(toJson(args.liveTimeline))},
          ${args.agentSessionId ?? null}, ${args.exitCode ?? null},
          ${args.agentResultStatus ?? null}, ${args.userId ?? null},
          ${args.modelRef ?? null}, ${args.visionModelRef ?? null},
          ${args.agentSlug ?? null}, ${args.deadlineMs ?? null},
          ${args.heartbeatAt ?? now}, ${args.lastEventAt ?? null},
          ${args.lastSeq ?? null}, ${args.mintedKeyId ?? null},
          ${args.spentCents ?? null}, ${now},
          ${terminal ? now : null}
        )
        ON CONFLICT (session_id, exec_id) DO UPDATE SET
          -- A settled op never returns to running (late racer flushes).
          status = CASE
            WHEN app.sandbox_session_ops.status <> 'running'
              AND EXCLUDED.status = 'running'
            THEN app.sandbox_session_ops.status
            ELSE EXCLUDED.status END,
          progress_text = coalesce(EXCLUDED.progress_text,
            app.sandbox_session_ops.progress_text),
          -- Transcript keeps the longer projection (a fresh window's first
          -- flush must not wipe a long turn's transcript).
          live_timeline = CASE
            WHEN EXCLUDED.live_timeline IS NULL
              THEN app.sandbox_session_ops.live_timeline
            WHEN app.sandbox_session_ops.live_timeline IS NULL
              THEN EXCLUDED.live_timeline
            WHEN jsonb_array_length(EXCLUDED.live_timeline)
              >= jsonb_array_length(app.sandbox_session_ops.live_timeline)
              THEN EXCLUDED.live_timeline
            ELSE app.sandbox_session_ops.live_timeline END,
          agent_session_id = coalesce(EXCLUDED.agent_session_id,
            app.sandbox_session_ops.agent_session_id),
          exit_code = coalesce(EXCLUDED.exit_code,
            app.sandbox_session_ops.exit_code),
          agent_result_status = coalesce(EXCLUDED.agent_result_status,
            app.sandbox_session_ops.agent_result_status),
          model_ref = coalesce(EXCLUDED.model_ref,
            app.sandbox_session_ops.model_ref),
          vision_model_ref = coalesce(EXCLUDED.vision_model_ref,
            app.sandbox_session_ops.vision_model_ref),
          deadline_ms = coalesce(EXCLUDED.deadline_ms,
            app.sandbox_session_ops.deadline_ms),
          heartbeat_at_ms = coalesce(EXCLUDED.heartbeat_at_ms,
            app.sandbox_session_ops.heartbeat_at_ms),
          -- Monotonic: a stale in-flight racer must not regress it.
          last_event_at_ms = greatest(
            coalesce(EXCLUDED.last_event_at_ms, 0),
            coalesce(app.sandbox_session_ops.last_event_at_ms, 0)),
          last_seq = greatest(coalesce(EXCLUDED.last_seq, 0),
            coalesce(app.sandbox_session_ops.last_seq, 0)),
          minted_key_id = coalesce(EXCLUDED.minted_key_id,
            app.sandbox_session_ops.minted_key_id),
          spent_cents = coalesce(EXCLUDED.spent_cents,
            app.sandbox_session_ops.spent_cents),
          finished_at_ms = CASE WHEN EXCLUDED.status <> 'running'
            THEN ${now} ELSE app.sandbox_session_ops.finished_at_ms END
        RETURNING id
      `;
      return rows[0]?.id ?? null;
    },

    'sandbox/session_mutations:claimSessionOpFinalize': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the host passes exactly this shape
      const args = raw as { sessionId: string; execId: string };
      const rows = await sql<{ id: string }[]>`
        UPDATE app.sandbox_session_ops SET
          finalized_at_ms = ${Date.now()}, heartbeat_at_ms = ${Date.now()}
        WHERE session_id = ${args.sessionId} AND exec_id = ${args.execId}
          AND finalized_at_ms IS NULL
        RETURNING id
      `;
      return rows.length > 0;
    },

    'sandbox/session_mutations:bumpSessionOpHeartbeat': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the host passes exactly this shape
      const args = raw as { sessionId: string; execId: string };
      await sql`
        UPDATE app.sandbox_session_ops SET heartbeat_at_ms = ${Date.now()}
        WHERE session_id = ${args.sessionId} AND exec_id = ${args.execId}
      `;
      return null;
    },

    'sandbox/session_mutations:recordSessionOpSpend': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the host passes exactly this shape
      const args = raw as {
        sessionId: string;
        execId: string;
        spentCents: number;
      };
      const rows = await sql<{ id: string }[]>`
        UPDATE app.sandbox_session_ops SET spent_cents = ${args.spentCents}
        WHERE session_id = ${args.sessionId} AND exec_id = ${args.execId}
        RETURNING id
      `;
      return rows.length > 0;
    },

    'sandbox/session_mutations:markSessionTokenRevokedByKeyId': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the host passes exactly this shape
      const args = raw as { sessionId: string; llmGatewayKeyId: string };
      await sql`
        UPDATE app.sandbox_session_tokens SET revoked_at_ms = ${Date.now()}
        WHERE session_id = ${args.sessionId}
          AND llm_gateway_key_id = ${args.llmGatewayKeyId}
          AND revoked_at_ms IS NULL
      `;
      return null;
    },

    'sandbox/session_mutations:insertSessionToken': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the host passes exactly this shape
      const args = raw as {
        organizationId: string;
        sessionId: string;
        tokenHash: string;
        llmGatewayKeyId?: string;
        scope: unknown;
        expiresAt: number;
      };
      await sql`
        INSERT INTO app.sandbox_session_tokens (
          org_id, session_id, token_hash, llm_gateway_key_id, scope,
          created_at_ms, expires_at_ms
        ) VALUES (
          ${args.organizationId}, ${args.sessionId}, ${args.tokenHash},
          ${args.llmGatewayKeyId ?? null}, ${sql.json(toJson(args.scope))},
          ${Date.now()}, ${args.expiresAt}
        )
      `;
      return null;
    },

    // ------------------------------------------------- session slot verbs
    'sandbox/session_mutations:reserveSessionSlotAndInsert': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the host passes exactly this shape
      const args = raw as {
        organizationId: string;
        sessionId: string;
        profile: unknown;
        ownerType: string;
        ownerId: string;
        createdBy: string;
        agentKind?: string;
        ttlMs?: number;
      };
      try {
        return await reserveSessionSlot(sql, args);
      } catch (error) {
        return quotaAsAppError(error);
      }
    },

    'sandbox/session_mutations:setSessionStatus': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the host passes exactly this shape
      const args = raw as { rowId: string; status: string };
      const now = Date.now();
      await sql`
        UPDATE app.sandbox_sessions SET
          status = ${args.status}, last_activity_at_ms = ${now},
          destroyed_at_ms = CASE WHEN ${args.status} = 'destroyed'
            THEN ${now}::bigint ELSE destroyed_at_ms END
        WHERE id = ${args.rowId}
      `;
      return null;
    },

    'sandbox/session_mutations:resumeSessionSlotWithCapCheck': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the host passes exactly this shape
      const args = raw as { organizationId: string; sessionId: string };
      try {
        return await resumeSessionSlot(sql, args);
      } catch (error) {
        return quotaAsAppError(error);
      }
    },

    'sandbox/session_mutations:releaseProjectAgentSessionSlot': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the host passes exactly this shape
      const args = raw as { organizationId: string; agentId: string };
      // Stop the agent's standing session unless a sibling turn is live —
      // and wake the org's oldest parked run on the freed slot.
      return releaseProjectAgentSessionSlot(sql, args);
    },

    'sandbox/session_queries:getActiveSessionByOwner': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the host passes exactly this shape
      const args = raw as { ownerType: string; ownerId: string };
      const rows = await sql<
        {
          sessionId: string;
          organizationId: string;
          status: string;
          createdAt: number;
          pinned: boolean;
        }[]
      >`
        SELECT session_id AS "sessionId", org_id AS "organizationId", status,
               created_at_ms::float8 AS "createdAt", pinned
        FROM app.sandbox_sessions
        WHERE owner_type = ${args.ownerType} AND owner_id = ${args.ownerId}
          AND status IN ('creating', 'active', 'stopped')
        ORDER BY created_at_ms DESC
        LIMIT 1
      `;
      return rows[0] ?? null;
    },

    'sandbox/session_queries:getExternalTurnOpForFinalize': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the host passes exactly this shape
      const args = raw as { sessionId: string; execId: string };
      const rows = await sql<
        {
          mintedKeyId: string | null;
          finalizedAt: number | null;
          startedAt: number;
          resumedBy: string | null;
        }[]
      >`
        SELECT minted_key_id AS "mintedKeyId",
               finalized_at_ms::float8 AS "finalizedAt",
               started_at_ms::float8 AS "startedAt",
               resumed_by AS "resumedBy"
        FROM app.sandbox_session_ops
        WHERE session_id = ${args.sessionId} AND exec_id = ${args.execId}
        LIMIT 1
      `;
      const row = rows[0];
      if (!row) return null;
      return {
        ...(row.mintedKeyId !== null ? { mintedKeyId: row.mintedKeyId } : {}),
        ...(row.finalizedAt !== null ? { finalizedAt: row.finalizedAt } : {}),
        startedAt: row.startedAt,
        ...(row.resumedBy !== null ? { resumedBy: row.resumedBy } : {}),
      };
    },

    // ---------------------------------------------------- project equipment
    'projects/internal_queries:getProjectAgentSkillScope': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the host passes exactly this shape
      const args = raw as { agentId: string };
      const rows = await sql<{ teamId: string | null; shared: string[] }[]>`
        SELECT p.team_id AS "teamId", p.shared_with_team_ids AS shared
        FROM app.project_agents a
        JOIN app.projects p ON p.id = a.project_id
        WHERE a.id = ${args.agentId}
        LIMIT 1
      `;
      const row = rows[0];
      if (!row) return null;
      const teamIds = new Set<string>();
      if (row.teamId !== null) teamIds.add(row.teamId);
      for (const teamId of row.shared) teamIds.add(teamId);
      return { teamIds: [...teamIds] };
    },

    // Skill bundles for staging — the reused file layer.
    'skills/file_actions:readSkillBundle': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the host passes exactly this shape
      const args = raw as Parameters<typeof readSkillBundleForViewer>[0];
      return readSkillBundleForViewer(args);
    },
  };
}

/**
 * The task lane's scheduler seam: the reused hosts self-chain by scheduling
 * `internal.*` refs — the drive continuation after every `running` window
 * and the steer retry ladder — and each maps onto its pg-boss job here.
 * Without the seam the chain dies at the FIRST re-schedule ("no scheduler
 * seam registered"), settling a working turn as failed while the agent
 * keeps going (observed live). The turn-drive itest alone never exercises
 * this: its fake harness finishes in one terminal window, so nothing
 * re-schedules there.
 */
export function taskAgentShimScheduler(sql: Sql): ShimScheduler {
  return async (functionName, delayMs, args) => {
    const startAfter =
      delayMs > 0 ? { startAfter: new Date(Date.now() + delayMs) } : {};
    if (functionName === 'tasks/agent_run_host:driveTaskAgentTurn') {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the host builds exactly the drive keys its handler re-validates
      await addJobInTx(sql, 'task.agent_drive', args as never, startAfter);
      return;
    }
    if (functionName === 'tasks/agent_run_host:steerTaskAgentTurn') {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the steer host replays its own args with attempt+1
      await addJobInTx(sql, 'task.agent_steer', args as never, startAfter);
      return;
    }
    throw new Error(
      `[task-agent] unmapped scheduled ref ${functionName} — add it to taskAgentShimScheduler`,
    );
  };
}
