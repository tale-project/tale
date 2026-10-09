import type { Sql } from 'postgres';
import { z } from 'zod';

import type { Json } from '../../lib/engine/core/types.ts';
import { parseRunStarter } from '../../lib/shared/run-starter.ts';
import {
  driveWorkflowAgentTurnImpl,
  resumeWorkflowAgentTurnWithAnswerImpl,
  startWorkflowAgentTurnImpl,
} from '../core/automations/agent_host.ts';
import { stepRunImpl } from '../core/automations/stepper.ts';
import {
  generateThreadTitleImpl,
  TITLE_AGENT_SLUG,
} from '../core/chat/generate_title.ts';
import {
  driveTaskAgentTurnImpl,
  startTaskAgentTurnImpl,
  steerTaskAgentTurnImpl,
} from '../core/tasks/agent_run_host.ts';
import { resolveAutoRetryBudget } from '../core/tasks/task_auto_retry.ts';
import {
  automationShimHandlers,
  automationShimScheduler,
} from '../domains/automations/shim.ts';
import {
  pollParkedRun,
  sweepOverdueRuns,
} from '../domains/automations/store.ts';
import { scanScheduledTriggers } from '../domains/automations/triggers.ts';
import { sweepBrowserSessions } from '../domains/browser_sessions/service.ts';
import { apiTurnPayloadSchema, runApiTurn } from '../domains/chat/rest-turn.ts';
import { chatShimHandlers } from '../domains/chat/shim.ts';
import { readThreadProjectId } from '../domains/chat/threads.ts';
import { titleMeter } from '../domains/chat/title-meter.ts';
import { runChatGenerationWatchdog } from '../domains/chat/watchdogs.ts';
import { isBackendDraining } from '../domains/control/service.ts';
import { runTranscribeJob } from '../domains/files/transcription.ts';
import {
  runGoogleDriveSyncConfigJob,
  runGoogleDriveSyncScan,
} from '../domains/google_drive/service.ts';
import { indexUploadedFile } from '../domains/knowledge/service.ts';
import {
  runOneDriveSyncConfigJob,
  runOneDriveSyncScan,
} from '../domains/onedrive/service.ts';
import { scaffoldNewOrganization } from '../domains/organizations/scaffold.ts';
import { releaseIdleSession } from '../domains/sandbox/idle-release.ts';
import {
  recreatePinnedSession,
  syncSessionPin,
  teardownSession,
} from '../domains/sandbox/service.ts';
import { releaseProjectAgentSessionSlot } from '../domains/sandbox/sessions.ts';
import { reconcileSessionOpKey } from '../domains/sandbox/spend-settlement.ts';
import { runSandboxWatchdog } from '../domains/sandbox/watchdogs.ts';
import {
  pendingOrganizationSlices,
  retireOrganizationSandboxes,
  retireOwnerWorkspaces,
  runWorkspaceCleanup,
} from '../domains/sandbox/workspace-cleanup.ts';
import { releaseRemovedDevices } from '../domains/sandbox_devices/service.ts';
import {
  failAgentRun,
  isStandardAgentRefusal,
  kickAgentRun,
  startedViaOfRun,
  wakeParkedAgentRun,
} from '../domains/tasks/agent-runs.ts';
import {
  agentTurnShimHandlers,
  taskAgentShimScheduler,
} from '../domains/tasks/agent-turn-shim.ts';
import {
  agentRunWorkDeadline,
  claimAgentWorker,
} from '../domains/tasks/agent-workers.ts';
import {
  admitAutomatedStart,
  SCHEDULE_REVOKED_BEFORE_LAUNCH,
} from '../domains/tasks/delegated-start.ts';
import { TaskError } from '../domains/tasks/errors.ts';
import {
  loadTaskRetryHistory,
  resolveTaskKickStartArgs,
} from '../domains/tasks/kick-plan.ts';
import {
  runStarterMayEditProject,
  sessionIdForAgentRun,
} from '../domains/tasks/run-authority.ts';
import { retireAutoRetry } from '../domains/tasks/run-failure-notice.ts';
import { readInPlaceRetryState } from '../domains/tasks/run-start.ts';
import { deferredAgentKickRefusal } from '../domains/tasks/service.ts';
import { runTaskAgentWatchdog } from '../domains/tasks/watchdogs.ts';
import {
  runVideoCloneJob,
  runVideoIngestJob,
  runVideoLinkWatchdog,
} from '../domains/video_links/service.ts';
import {
  runWebsiteRegister,
  runWebsitesRowSync,
  runWebsitesScan,
  runWebsitesScanDue,
} from '../domains/websites/service.ts';
import { createCtxShim } from '../lib/ctx-shim.ts';
import { createDrainProbe } from '../lib/drain-probe.ts';
import { processShutdown } from '../lib/shutdown.ts';

/** What the worker hands a handler beside its payload. */
export interface TaskContext {
  /** The job's id, for a handler that checks whether its job is still its
   * own — pg-boss may have failed it from outside while the handler ran. */
  readonly jobId?: string;
  /**
   * Aborted when pg-boss gives up on the job: it ran past its queue's
   * `expireInSeconds` (pg-boss then fails it and schedules any retry), or
   * the worker is shutting down. A handler that can outlast its budget stops
   * on it, so a retry never runs beside the attempt it replaces.
   */
  readonly signal: AbortSignal;
}

/** One task handler; `payload` is a job row — external input, re-validate.
 * `context` is absent when a handler is called outside the worker. */
export type TaskHandler = (
  payload: unknown,
  context?: TaskContext,
) => Promise<void | { output: Record<string, Json> }>;

export type BackendTaskList = Record<string, TaskHandler>;

/** Who asked for a website scan: the scan's embeddings are their spend. */
const SCAN_REQUESTER = z.object({
  userId: z.string().min(1),
  apiKeyId: z.string().min(1).optional(),
});

const orgScaffoldSchema = z.object({
  orgSlug: z.string().min(1),
  cleanFirst: z.boolean().optional(),
});

const idleSessionReleaseSchema = z.object({
  organizationId: z.string().min(1),
  sessionId: z.string().min(1),
  generation: z.string().min(1),
});

/** One session of one organization: a pinned recreate's or a Destroy's. */
const sessionJobSchema = z.object({
  organizationId: z.string().min(1),
  sessionId: z.string().min(1),
});

const destroySessionSchema = sessionJobSchema.extend({
  rowId: z.string().min(1),
});

const orgCleanupSchema = z.object({
  orgSlug: z.string().min(1),
});

const retireWorkspacesSchema = z.discriminatedUnion('reason', [
  z.object({
    organizationId: z.string().min(1),
    reason: z.literal('agent_deleted'),
    agentIds: z.array(z.string().min(1)),
  }),
  z.object({
    organizationId: z.string().min(1),
    reason: z.literal('member_removed'),
    userId: z.string().min(1),
  }),
]);

const retireOrganizationSchema = z.object({
  organizationId: z.string().min(1),
  sessionIds: z.array(z.string().min(1)),
  gatewayKeyIds: z.array(z.string().min(1)),
  deviceIds: z.array(z.string().min(1)),
  teardown: z.boolean(),
});

const startWorkflowSchema = z.object({
  organizationId: z.string().min(1),
  taskId: z.string().min(1),
  workflowSlug: z.string().min(1),
  startedByUserId: z.string().min(1),
});

const driveSchema = z.object({
  organizationId: z.string().min(1),
  runId: z.string().min(1),
  taskId: z.string().min(1),
  agentId: z.string().min(1),
  execId: z.string().min(1),
  sessionId: z.string().min(1),
  harness: z.string().min(1),
  deadlineAt: z.number(),
  // The incarnation stamp the settle binds to the conversation handle — the
  // drive continuation carries it or a later kick's resume check degrades
  // to the op-recovered leg.
  sessionCreatedAt: z.number().optional(),
});

const steerSchema = z.object({
  organizationId: z.string().min(1),
  runId: z.string().min(1),
  taskId: z.string().min(1),
  agentId: z.string().min(1),
  execId: z.string().min(1),
  sessionId: z.string().min(1),
  harness: z.string().min(1),
  deadlineAt: z.number(),
  model: z.string().min(1),
  modelProvider: z.string().optional(),
  instructions: z.string().optional(),
  skills: z.array(z.string()),
  connectors: z.array(z.string()),
  tools: z.array(z.string()),
  secrets: z.array(z.string()),
  feedback: z.string(),
  mentionSource: z.enum(['comment', 'description']).optional(),
  author: z.string(),
  authorId: z.string(),
  attempt: z.number(),
});

const reindexBm25Schema = z.object({
  orgSlug: z.string().min(1).nullable(),
  schema: z.string().min(1),
  name: z.string().min(1),
});

export interface TaskDeps {
  sql: Sql;
}

/**
 * The production task list. Handlers are registered here as domains land;
 * every identifier must exist in `TaskPayloads` (tasks.ts), every handler is
 * idempotent (at-least-once delivery), and every payload is re-validated at
 * the boundary.
 */
/**
 * The signal a turn's drive window ends on: the job's own (pg-boss gave up
 * on it) or the process's shutdown. A window ended either way leaves the
 * turn running and hands it to its next window, which another process
 * drains.
 */
function driveWindowSignal(context: TaskContext | undefined): AbortSignal {
  return context === undefined
    ? processShutdown.signal
    : AbortSignal.any([context.signal, processShutdown.signal]);
}

export function createTaskList(deps: TaskDeps): BackendTaskList {
  // Read at most every few seconds, by every walker this process runs: a
  // walker on a replica a deploy is draining hands its run on at its next
  // step boundary.
  const draining = createDrainProbe(() => isBackendDraining(deps.sql));
  const agentRetry: TaskHandler = async (payload) => {
    const input = z
      .object({
        organizationId: z.string().min(1),
        taskId: z.string().min(1),
        agentId: z.string().min(1),
        expectedRunId: z.string().min(1),
        startAfterMs: z.number().optional(),
      })
      .parse(payload);
    // The 0.5 port of `kickAutoRetryRun`: every guard re-derived in ONE
    // transaction — the failed run must still be the task's newest (a
    // raced manual kick supersedes the retry), the card must still sit at
    // in_progress (or at the captured in-place decision) with THIS agent
    // assigned (a person intervening must not be overridden), the consecutive-
    // failure budget (reused pure module) must have room, and the run's starter must still be able to
    // start it (the manual Start's gate, as the project and their access
    // stand now).
    // Attribution stays with the failed run's own starter — the retry
    // continues THEIR kick.
    // A run an automation step or another agent started is retried under
    // the delegated start's per-task budget too (`admitAutomatedStart`). The
    // retry is kicked at once, its agent busy on other tasks or not: the run
    // it starts takes a worker of its own, or waits for one like any start
    // (`domains/tasks/agent-workers.ts`). The arm (`task.agent_retry`) and a
    // check an earlier image queued on `task.agent_retry_recheck` share this
    // handler, so such a check simply kicks the retry.
    const outcome = await deps.sql.begin(async (tx) => {
      // Written once, at the failed run's kick.
      const startedVia = await startedViaOfRun(tx, input.expectedRunId);
      const tasks = await tx<
        {
          status: string;
          archivedAt: number | null;
          projectId: string;
          assigneeType: string | null;
          assigneeId: string | null;
          createdBy: string;
          createdByType: string;
          parentTaskId: string | null;
        }[]
      >`
        SELECT status, archived_at_ms::float8 AS "archivedAt",
               project_id AS "projectId",
               assignee_type AS "assigneeType", assignee_id AS "assigneeId",
               created_by AS "createdBy", created_by_type AS "createdByType",
               parent_task_id AS "parentTaskId"
        FROM app.tasks
        WHERE id = ${input.taskId} AND org_id = ${input.organizationId}
        FOR UPDATE
      `;
      const task = tasks[0];
      // A missing/foreign task grants no authority over a run. Archived
      // tasks still exist: inspect the exact failed source and retire it.
      if (!task) return 'task_unavailable';
      const runs = await loadTaskRetryHistory(tx, input.taskId);
      const newest = runs[0];
      if (newest === undefined || newest.id !== input.expectedRunId) {
        return 'superseded';
      }
      if (newest.status !== 'failed') return 'not_failed';
      // Refused for good once (`markAutoRetryRetired`, also by an earlier
      // image that refused a retry whose agent stayed busy): every later
      // delivery stands down. A newer run is a new decision and carries no
      // mark.
      if (newest.autoRetryRefusedAt !== undefined) return 'retry_refused';
      // From here on, a refusal is this failed run's last word: nothing
      // starts the task again by itself, so the run is retired and the
      // people it answers to are told, in the transaction that decides it.
      const retire = (announce: boolean) =>
        retireAutoRetry(tx, {
          organizationId: input.organizationId,
          taskId: input.taskId,
          runId: newest.id,
          announce,
        });
      if (task.archivedAt !== null) {
        await retire(false);
        return 'task_unavailable';
      }
      if (task.assigneeType !== 'agent' || task.assigneeId !== input.agentId) {
        await retire(false);
        return 'reassigned';
      }
      if (newest.inPlace) {
        // Null on legacy kicks: do not guess which card decision they began
        // under. A later scheduled occurrence can make a fresh decision.
        const state = await readInPlaceRetryState(
          tx,
          input.organizationId,
          input.taskId,
        );
        if (
          startedVia === undefined ||
          !['backlog', 'todo', 'in_progress'].includes(task.status) ||
          newest.inPlaceRetryStatus !== task.status ||
          newest.inPlaceRetryActivityId === undefined ||
          state?.activityId !== newest.inPlaceRetryActivityId
        ) {
          await retire(false);
          return 'task_moved';
        }
      } else if (task.status !== 'in_progress') {
        await retire(false);
        return 'task_moved';
      }
      const budget = resolveAutoRetryBudget(runs);
      if (!budget.retry) {
        await retire(true);
        return 'budget_exhausted';
      }
      const agent =
        (
          await tx<
            {
              harness: string;
              model: string;
              modelProvider: string | null;
            }[]
          >`
            SELECT harness, model, model_provider AS "modelProvider"
            FROM app.project_agents
            WHERE id = ${input.agentId}
              AND org_id = ${input.organizationId}
            LIMIT 1
          `
        )[0] ?? null;
      if (!agent) {
        await retire(true);
        return 'agent_gone';
      }
      const refusal = await deferredAgentKickRefusal(tx, {
        organizationId: input.organizationId,
        projectId: task.projectId,
        task,
        startedBy: newest.startedBy,
      });
      if (refusal !== null) {
        // This delivery finishes without scheduling another check. An
        // archive/restore is a new human decision, not a deferred retry.
        await retire(refusal === 'not_permitted');
        return refusal;
      }
      // A run an automation step or another agent started stays one when
      // retried: it still counts as automated and may not delegate, and
      // the retry is an automated start the per-task budget admits like
      // any other (`admitAutomatedStart`). A person's run carries no
      // provenance, so its retries are never counted or refused there.
      let sessionId: string | undefined;
      if (startedVia !== undefined) {
        // The workspace family the retry works in: the standing one, or the
        // member's own for a starter who may no longer edit the project but
        // still works the task. Its worker is claimed when it starts.
        sessionId = await sessionIdForAgentRun(tx, {
          organizationId: input.organizationId,
          projectId: task.projectId,
          agentId: input.agentId,
          startedBy: newest.startedBy,
        });
        const admitted = await admitAutomatedStart(tx, {
          task: {
            id: input.taskId,
            organizationId: input.organizationId,
            projectId: task.projectId,
          },
          agentId: input.agentId,
        });
        if (!admitted.admitted) {
          await retire(true);
          return 'task_circuit_breaker';
        }
      }
      try {
        await kickAgentRun(tx, {
          organizationId: input.organizationId,
          projectId: task.projectId,
          taskId: input.taskId,
          agentId: input.agentId,
          harness: agent.harness,
          model: agent.model,
          ...(agent.modelProvider !== null
            ? { modelProvider: agent.modelProvider }
            : {}),
          startedBy: newest.startedBy,
          trigger: 'auto_retry',
          ...(startedVia !== undefined
            ? { startedVia, inPlace: newest.inPlace }
            : {}),
          autoRetryAttempt: budget.attempt,
          // Queued now, so the card shows the retry; started once the
          // broker's cooldown has an account back.
          ...(input.startAfterMs !== undefined
            ? { startAfterMs: input.startAfterMs }
            : {}),
          ...(sessionId !== undefined ? { sessionId } : {}),
        });
      } catch (error) {
        // Explicitly disabling automatic task work ends this decision. An
        // unreadable policy still throws so pg-boss can retry that outage.
        if (
          error instanceof TaskError &&
          error.code === 'TASK_AUTOMATION_DISABLED'
        ) {
          await retire(false);
          return 'task_automation_disabled';
        }
        // The organization's standard agent was switched off, or no longer
        // runs for the starter: no retry changes that, so the failed run
        // ends here and its watchers are told. The refusal is a check, not
        // a failed statement, so the transaction is still good to write.
        if (isStandardAgentRefusal(error)) {
          await retire(true);
          return 'standard_agent_unavailable';
        }
        throw error;
      }
      return 'kicked';
    });
    if (outcome !== 'kicked') {
      console.log(`[task-agent] auto-retry skipped: ${outcome}`);
    }
  };

  return {
    'sandbox.sync_pin': async (payload) => {
      await syncSessionPin(deps.sql, destroySessionSchema.parse(payload));
    },
    'sandbox.release_idle': async (payload) => {
      await releaseIdleSession(
        deps.sql,
        idleSessionReleaseSchema.parse(payload),
      );
    },
    'sandbox.recreate_pinned': async (payload) => {
      const input = sessionJobSchema.parse(payload);
      try {
        const outcome = await recreatePinnedSession(deps.sql, input);
        if (outcome === 'recreated') {
          console.log(
            `[sandbox] recreated pinned session ${input.sessionId} in place and re-pinned it`,
          );
        }
      } catch (error) {
        // No verdict — spawner unreachable, create refused, device offline:
        // the row keeps its pin, and the sweep's next visit queues another
        // attempt. The reconcile pass's own posture, so a workspace on an
        // offline device is not an error report every five minutes.
        console.warn(
          `[sandbox] recreate of pinned session ${input.sessionId} failed; the next sweep retries:`,
          error,
        );
      }
    },
    noop: (payload) => {
      console.debug(`[backend] noop task executed: ${JSON.stringify(payload)}`);
      return Promise.resolve();
    },
    'org.scaffold': async (payload) => {
      const input = orgScaffoldSchema.parse(payload);
      const result = await scaffoldNewOrganization({ sql: deps.sql, ...input });
      // Starter content is a DB row, not a catalog file. Seed it even when
      // the filesystem scaffold skips (misconfigured catalog / invalid slug)
      // so a fresh org is usable and e2e can gate on "Getting started".
      // Packs stay after starter so a pack-parse throw cannot block it.
      const orgs = await deps.sql<{ id: string }[]>`
        SELECT "id" FROM "organization" WHERE "slug" = ${input.orgSlug}
        LIMIT 1
      `;
      const organizationId = orgs[0]?.id;
      // Kill-switch (mirrors TALE_RETENTION_DISABLED): the integration
      // harness seeds nothing implicitly — its provisioning check drives the
      // seeders directly against a throwaway org.
      if (
        organizationId !== undefined &&
        process.env.TALE_PROVISIONING_DISABLED !== '1'
      ) {
        const { seedDefaultAutomationPacks, seedStarterContent } =
          await import('../domains/provisioning/service.ts');
        await seedStarterContent(deps.sql, organizationId);
        const seeded = await seedDefaultAutomationPacks(
          deps.sql,
          organizationId,
        );
        if (seeded.provisioned.length > 0) {
          console.log(
            `[provisioning] seeded packs for ${input.orgSlug}: ${seeded.provisioned.join(', ')}`,
          );
        }
      }
      if (!result.ok) {
        // Throw so pg-boss retries — scaffold is idempotent per domain.
        throw new Error(`org scaffold failed: ${result.error}`);
      }
    },
    'watchdog.transcriptions': async () => {
      const { recoverStuckTranscriptions } =
        await import('../domains/file_metadata/watchdogs.ts');
      await recoverStuckTranscriptions(deps.sql);
    },
    'watchdog.rag_indexing': async () => {
      const { recoverStuckRagIndexing } =
        await import('../domains/file_metadata/watchdogs.ts');
      await recoverStuckRagIndexing(deps.sql);
    },
    'knowledge.resume_usage_limited': async () => {
      const { requeueUsageLimitedFiles } =
        await import('../domains/knowledge/usage-limit-resume.ts');
      const { resumeUsageLimitedScans } =
        await import('../domains/websites/service.ts');
      const requeued = await requeueUsageLimitedFiles(deps.sql);
      const rescanned = await resumeUsageLimitedScans(deps.sql);
      if (requeued + rescanned > 0) {
        console.info(
          `[knowledge] resumed ${requeued} file(s) and ${rescanned} website scan(s) a usage limit had parked`,
        );
      }
    },
    'watchdog.erasures': async () => {
      const { recoverStuckErasureRequests } =
        await import('../domains/erasure/service.ts');
      await recoverStuckErasureRequests(deps.sql);
    },
    'governance.revoke_idle_sessions': async () => {
      const { revokeIdleSessions } =
        await import('../domains/governance/session-idle.ts');
      await revokeIdleSessions(deps.sql);
    },
    'tts.gc_chunks': async () => {
      const { gcExpiredTtsChunks } = await import('../domains/tts/service.ts');
      await gcExpiredTtsChunks(deps.sql);
    },
    'projects.repair_rollups': async () => {
      const { repairProjectRollups } =
        await import('../domains/projects/service.ts');
      await repairProjectRollups(deps.sql);
    },
    'tasks.enforce_dates': async () => {
      const { enforceTaskDateNotifications } =
        await import('../domains/tasks/date-notifications.ts');
      await enforceTaskDateNotifications(deps.sql);
    },
    'tasks.repeat_on_due': async (_payload, context) => {
      const { createDueRepeatCopies } =
        await import('../domains/tasks/repeat-on-due.ts');
      await createDueRepeatCopies(deps.sql, { signal: context?.signal });
    },
    'maintenance.rate_limit_gc': async () => {
      // Any row idle for 7 days is past every window/refill horizon.
      const cutoff = Date.now() - 7 * 24 * 3_600_000;
      const deleted = await deps.sql`
        DELETE FROM app.rate_limits WHERE ts < ${cutoff}
      `;
      console.log(`[maintenance] rate_limit_gc removed ${deleted.count} rows`);
    },
    'maintenance.expired_sessions': async (_payload, context) => {
      const { reapExpiredSessions } =
        await import('../auth/expired-sessions.ts');
      const { deleted, drained } = await reapExpiredSessions(deps.sql, {
        signal: context?.signal,
      });
      console.log(
        `[maintenance] expired_sessions removed ${deleted} rows${drained ? '' : ' (stopped before draining; the next run carries on)'}`,
      );
    },
    'realtime.reclaim_outbox': async () => {
      const { OUTBOX_RECLAIM_CRON_MAX_BATCHES, reclaimOutbox } =
        await import('../realtime/outbox.ts');
      const deleted = await reclaimOutbox(deps.sql, {
        maxBatches: OUTBOX_RECLAIM_CRON_MAX_BATCHES,
      });
      if (deleted > 0) {
        console.log(`[realtime] reclaim_outbox removed ${deleted} rows`);
      }
    },
    'maintenance.login_attempts_ttl': async () => {
      // ONE window for every table this job touches — the 0.4
      // `cleanupLoginAttemptsGlobal` contract. `login_attempts` and
      // `login_block_counters` are both keyed by `email`, and the counters
      // additionally keep `last_ip`, so a longer counter window would hold
      // identifying data longer than the attempts it summarises. Nothing
      // needs it there: `listBlockCounters` reads the most recent 200 rows
      // by `updated_at` with no time window, and the lockout itself lives
      // on `login_attempts.locked_until`, never on a counter bucket, so a
      // shorter counter window releases no lockout early. The durable
      // forensic record is `app.audit_logs`, under its own retention.
      const cutoff = Date.now() - 30 * 24 * 3_600_000;
      const attempts = await deps.sql`
        DELETE FROM app.login_attempts
        WHERE last_failure_at < ${cutoff}
      `;
      const counters = await deps.sql`
        DELETE FROM app.login_block_counters
        WHERE window_start < ${cutoff}
      `;
      // Parity for `two_factor_attempts`: a failed TOTP is a failed password
      // in brute-force terms, but the table is only cleared on SUCCESS (and
      // on member removal) — a user who failed 2FA and never came back left
      // a permanently stuck row.
      //
      // `app.two_factor_grace` in the same migration is deliberately NOT
      // swept. Its `grace_until_ms` is the enforcement anchor written once
      // by `setGraceUntilIfAbsent` on first sign-in under an enforced
      // policy, and an ABSENT row reads as "no anchor yet" —
      // `evaluateTwoFactorEnforcement` then mints a fresh
      // `now + gracePeriodDays`. Ageing those rows out would hand a user who
      // already burned their grace a brand-new window just for staying away,
      // which is a security regression, not data minimisation. The row also
      // carries no PII beyond `user_id`, and member removal already deletes
      // it (`domains/members/service.ts`).
      const twoFactor = await deps.sql`
        DELETE FROM app.two_factor_attempts
        WHERE last_failure_at_ms < ${cutoff}
      `;
      console.log(
        `[maintenance] login_attempts_ttl removed ${attempts.count} attempts, ${counters.count} counters, ${twoFactor.count} 2fa attempts`,
      );
    },
    'maintenance.mcp_activity_ttl': async () => {
      const { sweepMcpActivity } = await import('../domains/mcp/activity.ts');
      const deleted = await sweepMcpActivity(deps.sql);
      console.log(`[maintenance] mcp_activity_ttl removed ${deleted} rows`);
    },
    'rag.index_file': async (payload, context) => {
      const input = z.object({ fileId: z.string().min(1) }).parse(payload);
      // A document can take longer than the job's budget (a slow embedding
      // server, a queue of other jobs' batches). The run stops when pg-boss
      // gives up on it, and the retry resumes after the stored slices.
      await indexUploadedFile(deps.sql, input.fileId, {
        signal: context?.signal,
      });
    },
    'rag.index_message': async (payload, context) => {
      const input = z.object({ messageId: z.string().min(1) }).parse(payload);
      const { indexConversationMessage } =
        await import('../domains/knowledge/message-index.ts');
      await indexConversationMessage(deps.sql, input.messageId, {
        signal: context?.signal,
      });
    },
    'knowledge.release_refs': async (payload) => {
      const input = z
        .object({
          organizationId: z.string().min(1),
          refs: z.array(z.string().min(1)).min(1),
        })
        .parse(payload);
      const { runReleaseRefsJob } =
        await import('../domains/knowledge/release.ts');
      await runReleaseRefsJob(deps.sql, input);
    },
    'knowledge.reconcile_corpus': async () => {
      const { runCorpusReconcile } =
        await import('../domains/knowledge/release.ts');
      await runCorpusReconcile(deps.sql);
    },
    'knowledge.reindex_bm25': async (payload) => {
      const input = reindexBm25Schema.parse(payload);
      const { runReindexBm25Job } =
        await import('../domains/knowledge/index-health.ts');
      await runReindexBm25Job(deps.sql, input);
    },
    'org.cleanup_files': async (payload) => {
      const input = orgCleanupSchema.parse(payload);
      // The job is enqueued inside the deletion transaction, so the org row
      // is gone by the time it runs; the teardown re-checks anyway and never
      // touches a slug a live organization owns.
      const { teardownDeletedOrganization } =
        await import('../domains/organizations/teardown.ts');
      const result = await teardownDeletedOrganization(deps.sql, input.orgSlug);
      if (result.status === 'done') {
        console.log(
          `[org.cleanup_files] tore down "${input.orgSlug}": corpusDocuments=${result.corpusDocuments} blobs=${result.blobs}`,
        );
      }
    },
    'automation.step': async (payload, context) => {
      const input = z
        .object({ organizationId: z.string().min(1), runId: z.string().min(1) })
        .parse(payload);
      // The REUSED 0.4 stepper on the ctx shim. Claim-fenced and idempotent:
      // a retried job either wins a fresh claim or no-ops. The scheduler seam
      // lets the agent node's kick schedule its turn as a pg-boss job. The
      // walker hands its run on when this process starts shutting down or
      // its replica is drained, and a step still running at the shutdown
      // grace (or when pg-boss gives up on the job) is cut.
      const shim = createCtxShim(automationShimHandlers(deps.sql), {
        scheduler: automationShimScheduler(deps.sql),
      });
      await stepRunImpl(
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- reused 0.4 stepper; every ctx facility it touches is covered by automationShimHandlers
        shim as unknown as Parameters<typeof stepRunImpl>[0],
        input,
        {
          ...(context !== undefined && { signal: context.signal }),
          draining,
        },
      );
    },
    'automation.trigger_scan': async () => {
      const result = await scanScheduledTriggers(deps.sql);
      if (result.fired > 0) {
        console.log(
          `[automations] trigger scan fired ${result.fired}/${result.examined} (${result.pages} page${result.pages === 1 ? '' : 's'})`,
        );
      }
      // A missing organization table returns before examining any page.
      // That bootstrap/connection state is not proof the scanner is working.
      // pg-boss persists this only when the actual handler's claim completes;
      // a draining worker's handover must never produce this marker.
      return result.pages > 0
        ? { output: { triggerScanCompleted: true } }
        : undefined;
    },
    'automation.liveness': async () => {
      const swept = await sweepOverdueRuns(deps.sql);
      if (swept > 0) {
        console.log(`[automations] liveness sweep re-poked ${swept} runs`);
      }
    },
    'governance.process_erasure': async (payload) => {
      const input = z.object({ requestId: z.string().min(1) }).parse(payload);
      const { processErasure } = await import('../domains/erasure/service.ts');
      await processErasure(deps.sql, input.requestId);
    },
    'governance.retention_cleanup': async () => {
      const { runRetentionCleanup } =
        await import('../domains/retention/service.ts');
      const results = await runRetentionCleanup(deps.sql);
      const orgs = Object.keys(results).length;
      if (orgs > 0) {
        console.log(`[retention] swept ${orgs} orgs`);
      }
    },
    'object_storage.backfill': async (payload) => {
      const input = z
        .object({
          runId: z.string().min(1),
          organizationId: z.string().min(1),
        })
        .parse(payload);
      const { runBackfill } =
        await import('../domains/object_storage/service.ts');
      await runBackfill(deps.sql, input);
    },
    'watchdog.object_storage': async () => {
      const { recoverStuckBackfills } =
        await import('../domains/object_storage/service.ts');
      const result = await recoverStuckBackfills(deps.sql);
      if (result.failed > 0) {
        console.log(
          `[watchdog] object-storage: failed ${result.failed} stalled backfill run(s)`,
        );
      }
    },
    'audit.integrity_check': async () => {
      const { listAuditedOrgIds, runScheduledIntegrityCheck } =
        await import('../domains/audit_logs/verify.ts');
      const orgIds = await listAuditedOrgIds(deps.sql);
      let broken = 0;
      for (const orgId of orgIds) {
        // One org's walk failing must not starve the fleet.
        try {
          const result = await runScheduledIntegrityCheck(deps.sql, orgId);
          if (result.broken) broken += 1;
        } catch (error) {
          console.error(`[audit-integrity] org ${orgId} walk failed:`, error);
        }
      }
      if (broken > 0) {
        console.error(`[audit-integrity] ${broken} org(s) with a broken chain`);
      }
    },
    'governance.effect_hold_releases': async () => {
      const { effectApprovedReleases } =
        await import('../domains/legal_holds/service.ts');
      const effected = await effectApprovedReleases(deps.sql);
      if (effected > 0) {
        console.log(`[legal-holds] effected ${effected} approved releases`);
      }
    },
    'governance.apply_dsar_policy_changes': async () => {
      const { applyMaturedDsarPolicyChanges } =
        await import('../domains/governance/settings-tail.ts');
      const applied = await applyMaturedDsarPolicyChanges(deps.sql);
      if (applied > 0) {
        console.log(
          `[governance] applied ${applied} matured DSAR policy change(s)`,
        );
      }
    },
    'watchdog.task_agents': async (_payload, context) => {
      // Re-attach BEFORE the deadline pass: a turn whose chain died is
      // still doing work, and failing it for a stale heartbeat would throw
      // away a live agent's output.
      const { recoverStalledTaskAgentTurns, recoverStuckQueuedTaskAgentRuns } =
        await import('../domains/tasks/reattach.ts');
      const reattached = await recoverStalledTaskAgentTurns(deps.sql, {
        signal: context?.signal,
      });
      if (reattached.resumed > 0) {
        console.log(
          `[watchdog] task agents: re-attached ${reattached.resumed} of ${reattached.examined} abandoned turn(s)`,
        );
      }
      // The queued-start twin: a start job lost before setAgentRunRunning
      // leaves the run 'queued' with no op row and no capacity stamp — invisible
      // to the re-attach above and the deadline sweep below until the 12h wall.
      if (context?.signal?.aborted) return;
      const queued = await recoverStuckQueuedTaskAgentRuns(deps.sql);
      if (queued.requeued > 0 || queued.failed > 0) {
        console.log(
          `[watchdog] task agents: re-kicked ${queued.requeued} stranded queued run(s), failed ${queued.failed} with a deleted agent`,
        );
      }
      const result = await runTaskAgentWatchdog(deps.sql);
      if (result.failed > 0 || result.released > 0 || result.woken > 0) {
        console.log(
          `[watchdog] task agents: failed ${result.failed} overdue, released ${result.released} orphaned session(s), woke ${result.woken} parked`,
        );
      }
    },
    'watchdog.automation_agents': async (_payload, context) => {
      // The workflow twin of the task-agent re-attach: a drive chain that
      // died mid-turn is resurrected from the run cursor, never failed —
      // the agent in the sandbox is still doing (or has finished) the work.
      const { recoverAnsweredAskResumes, recoverStalledWorkflowAgentTurns } =
        await import('../domains/automations/reattach.ts');
      const reattached = await recoverStalledWorkflowAgentTurns(deps.sql, {
        signal: context?.signal,
      });
      if (reattached.resumed > 0) {
        console.log(
          `[watchdog] automation agents: re-attached ${reattached.resumed} of ${reattached.examined} abandoned turn(s)`,
        );
      }
      // The answered-ask twin: a resume lost to a restart while the run still
      // parks on the asking exec (the re-attach above spares it as
      // awaiting_human) is re-enqueued instead of stranding to the 7-day ask
      // deadline.
      if (context?.signal?.aborted) return;
      const asks = await recoverAnsweredAskResumes(deps.sql);
      if (asks.requeued > 0) {
        console.log(
          `[watchdog] automation agents: re-enqueued ${asks.requeued} lost answered-ask resume(s)`,
        );
      }
    },
    'sandbox.destroy_session': async (payload) => {
      // A throw is the retry: the spawner could not be asked, refused, or
      // the session's device is offline. The row stays listed, unpinned on
      // both sides, and reads the Destroy as pending until the last attempt.
      await teardownSession(deps.sql, destroySessionSchema.parse(payload));
    },
    'sandbox.retire_workspaces': async (payload) => {
      const input = retireWorkspacesSchema.parse(payload);
      const { retired, kept } = await retireOwnerWorkspaces(deps.sql, input);
      if (retired > 0 || kept > 0) {
        console.log(
          `[sandbox.cleanup] ${input.reason}: deleted ${retired} workspace(s) of ${input.organizationId}, kept ${kept} that are wanted again or on legal hold`,
        );
      }
    },
    'sandbox.retire_organization': async (payload) => {
      const input = retireOrganizationSchema.parse(payload);
      await retireOrganizationSandboxes(input, {
        otherSlicesPending: () =>
          pendingOrganizationSlices(deps.sql, input.organizationId),
      });
    },
    'sandbox.workspace_gc': async (_payload, context) => {
      const result = await runWorkspaceCleanup(
        deps.sql,
        context !== undefined ? { signal: context.signal } : {},
      );
      const retired = Object.entries(result.retired);
      if (
        retired.length > 0 ||
        result.deferred > 0 ||
        result.unattributed > 0 ||
        result.organizations > 0
      ) {
        console.log(
          `[sandbox.cleanup] sweep deleted ${retired.map(([reason, count]) => `${count} ${reason}`).join(', ') || 'no'} workspace(s), deferred ${result.deferred}, left alone ${result.unattributed} it cannot attribute to this deployment, tore down ${result.organizations} deleted organization(s); inventory ${result.inventory}`,
        );
      }
    },
    'watchdog.sandbox': async (_payload, context) => {
      const result = await runSandboxWatchdog(
        deps.sql,
        context !== undefined ? { signal: context.signal } : {},
      );
      if (
        result.expired > 0 ||
        result.healed > 0 ||
        result.recreating > 0 ||
        result.reclaimed > 0 ||
        result.collected > 0 ||
        result.released > 0
      ) {
        console.log(
          `[watchdog] sandbox: expired ${result.expired}, healed ${result.healed}, queued the recreate of ${result.recreating} pinned session(s), reclaimed ${result.reclaimed} ended-run session(s), collected ${result.collected} failed session(s), released ${result.released} abandoned render session(s)`,
        );
      }
      // Removed sandbox devices the hub has not dropped yet (the spawner was
      // unreachable when they were removed).
      const released = await releaseRemovedDevices(deps.sql).catch(
        (error: unknown) => {
          console.error('[watchdog] sandbox device release failed:', error);
          return 0;
        },
      );
      if (released > 0) {
        console.log(
          `[watchdog] sandbox: released ${released} removed device(s)`,
        );
      }
    },
    'chat.generate_title': async (payload) => {
      const input = z
        .object({
          organizationId: z.string().min(1),
          threadId: z.string().min(1),
          userId: z.string().min(1),
          firstMessage: z.string().min(1),
          /** The API key that sent the message, when one did. */
          apiKeyId: z.string().min(1).optional(),
          /** A guardrail refused the message: no model may see it. */
          nameWithoutModel: z.boolean().optional(),
        })
        .parse(payload);
      // The REUSED 0.4 naming attempt on the chat shim — one small model
      // call raced against its timeout; any miss falls back to the derived
      // title, and the write fills only an absent title.
      const shim = createCtxShim(chatShimHandlers(deps.sql));
      // Naming a thread is a model call the organization pays for, held
      // against the member's limits — the key's that sent the message and
      // the thread's project's too — and booked under its own agent slug, so
      // analytics can separate "what the conversation cost" from "what
      // naming it cost".
      const projectId = await readThreadProjectId(
        deps.sql,
        input.organizationId,
        input.threadId,
      );
      await generateThreadTitleImpl(
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- reused 0.4 action; every ctx facility it touches is covered by chatShimHandlers
        shim as unknown as Parameters<typeof generateThreadTitleImpl>[0],
        input,
        titleMeter(deps.sql, {
          organizationId: input.organizationId,
          subject: {
            userId: input.userId,
            agentSlug: TITLE_AGENT_SLUG,
            ...(input.apiKeyId !== undefined
              ? { apiKeyId: input.apiKeyId }
              : {}),
            ...(projectId !== undefined ? { projectIds: [projectId] } : {}),
          },
        }),
      );
    },
    'chat.api_turn': async (payload) => {
      // The schema lives with the payload (rest-turn.ts) so the door and
      // the handler cannot disagree about what rides the job.
      await runApiTurn(deps.sql, apiTurnPayloadSchema.parse(payload));
    },
    'tts.watchdog_chunk': async (payload) => {
      const input = z
        .object({ chunkId: z.string().min(1), attemptCreatedAt: z.number() })
        .parse(payload);
      const { runTtsWatchdog } = await import('../domains/tts/service.ts');
      await runTtsWatchdog(deps.sql, input);
    },
    'tts.cleanup': async (payload) => {
      const input = z.object({ threadId: z.string().min(1) }).parse(payload);
      const { runTtsCleanup } = await import('../domains/tts/service.ts');
      await runTtsCleanup(deps.sql, input);
    },
    'notification.email': async (payload) => {
      const input = z
        .object({
          notificationId: z.string().min(1),
          epoch: z.number(),
        })
        .parse(payload);
      const { runNotificationEmailJob } =
        await import('../domains/collab/email-sink.ts');
      await runNotificationEmailJob(deps.sql, input);
    },
    'conversation.send_message': async (payload) => {
      const input = z
        .object({
          organizationId: z.string().min(1),
          messageId: z.string().min(1),
          connectorName: z.string().min(1),
          // The mailbox the send must leave through. Left out, the parse
          // dropped it and every send resolved the connector's default.
          credentialId: z.string().min(1).optional(),
          to: z.array(z.string()).min(1),
          cc: z.array(z.string()).optional(),
          subject: z.string(),
          body: z.string(),
          contentType: z.string().optional(),
          inReplyTo: z.string().optional(),
          references: z.array(z.string()).optional(),
          from: z.string().optional(),
          attachments: z
            .array(
              z.object({
                storageRef: z.string().min(1),
                fileName: z.string(),
                contentType: z.string(),
                size: z.number(),
              }),
            )
            .optional(),
        })
        .parse(payload);
      const { runSendMessageJob } =
        await import('../domains/conversations/send.ts');
      await runSendMessageJob(deps.sql, input);
    },
    'watchdog.conversation_sends': async () => {
      const { recoverStuckConversationSends } =
        await import('../domains/conversations/send.ts');
      const result = await recoverStuckConversationSends(deps.sql);
      if (result.failed > 0) {
        console.log(
          `[watchdog] conversation sends: failed ${result.failed} stranded queued send(s)`,
        );
      }
    },
    'chat.deferred_send_poll': async (payload) => {
      const input = z
        .object({ deferredSendId: z.string().min(1) })
        .parse(payload);
      const { pollDeferredSend } =
        await import('../domains/chat/deferred-sends.ts');
      await pollDeferredSend(deps.sql, input.deferredSendId);
    },
    'watchdog.chat_generations': async () => {
      const cleared = await runChatGenerationWatchdog(deps.sql);
      if (cleared > 0) {
        console.log(`[watchdog] chat: cleared ${cleared} stale generations`);
      }
    },
    'watchdog.deferred_sends': async () => {
      const { recoverStuckDeferredSends } =
        await import('../domains/chat/deferred-sends.ts');
      const result = await recoverStuckDeferredSends(deps.sql);
      if (result.repolled > 0 || result.cleared > 0) {
        console.log(
          `[watchdog] deferred sends: re-polled ${result.repolled} waiting, cleared ${result.cleared} wedged claimed`,
        );
      }
    },
    'documents.replacement_cleanup': async () => {
      const { runReplacementCleanup } =
        await import('../domains/documents/replacement.ts');
      const cleaned = await runReplacementCleanup(deps.sql);
      if (cleaned > 0) {
        console.log(
          `[documents] replacement cleanup reclaimed ${cleaned} intent(s)`,
        );
      }
    },
    'onedrive.sync_scan': async () => {
      await runOneDriveSyncScan(deps.sql);
    },
    'onedrive.sync_config': async (payload) => {
      const input = z
        .object({
          organizationId: z.string().min(1),
          configId: z.string().min(1),
        })
        .parse(payload);
      await runOneDriveSyncConfigJob(deps.sql, input);
    },
    'google_drive.sync_scan': async () => {
      await runGoogleDriveSyncScan(deps.sql);
    },
    'google_drive.sync_config': async (payload) => {
      const input = z
        .object({
          organizationId: z.string().min(1),
          configId: z.string().min(1),
        })
        .parse(payload);
      await runGoogleDriveSyncConfigJob(deps.sql, input);
    },
    'websites.scan_due': async () => {
      await runWebsitesScanDue(deps.sql);
    },
    'websites.scan': async (payload, context) => {
      const input = z
        .object({
          domain: z.string().min(1),
          orgSlug: z.string().min(1),
          organizationId: z.string().min(1),
          continuation: z.number().int().min(0).optional(),
          scanStartedAt: z.string().optional(),
          takeover: z.string().min(1).optional(),
          requestedBy: SCAN_REQUESTER.optional(),
        })
        .parse(payload);
      await runWebsitesScan(deps.sql, input, context);
    },
    'websites.register': async (payload) => {
      const input = z
        .object({
          websiteId: z.string().min(1),
          domain: z.string().min(1),
          scanInterval: z.string().min(1),
          organizationId: z.string().min(1),
          urls: z.array(z.string()).optional(),
          requestedBy: SCAN_REQUESTER.optional(),
        })
        .parse(payload);
      await runWebsiteRegister(deps.sql, input);
    },
    'websites.row_sync': async (payload) => {
      const input = z
        .object({
          orgSlug: z.string().min(1),
          domain: z.string().min(1),
        })
        .parse(payload);
      await runWebsitesRowSync(deps.sql, input);
    },
    'video.ingest': async (payload) => {
      const input = z
        .object({
          jobId: z.string().min(1),
          userLocale: z.string().optional(),
        })
        .parse(payload);
      await runVideoIngestJob(deps.sql, input);
    },
    'video.clone': async (payload) => {
      const input = z
        .object({
          jobId: z.string().min(1),
          donorFileMetadataId: z.string().min(1),
          organizationId: z.string().min(1),
        })
        .parse(payload);
      await runVideoCloneJob(deps.sql, input);
    },
    'video.watchdog': async () => {
      await runVideoLinkWatchdog(deps.sql);
    },
    'browser.sweep': async () => {
      await sweepBrowserSessions(deps.sql);
    },
    'files.transcribe': async (payload) => {
      const input = z
        .object({
          storageId: z.string().min(1),
          fileName: z.string().min(1),
          contentType: z.string().min(1),
          organizationId: z.string().min(1),
          attempt: z.number().int().min(0).optional(),
        })
        .parse(payload);
      await runTranscribeJob(deps.sql, input);
    },
    'task.start_workflow': async (payload) => {
      const input = startWorkflowSchema.parse(payload);
      const { startWorkflowForTask } =
        await import('../domains/tasks/external-ref.ts');
      const { loadTaskForWorkflowStart } =
        await import('../domains/tasks/comments.ts');
      const task = await loadTaskForWorkflowStart(
        deps.sql,
        input.organizationId,
        input.taskId,
      );
      if (task === null) {
        console.warn(
          `[task-workflow] start skipped — task ${input.taskId} is gone`,
        );
        return;
      }
      await startWorkflowForTask(deps.sql, {
        organizationId: input.organizationId,
        task,
        workflowSlug: input.workflowSlug,
        startedByUserId: input.startedByUserId,
      });
    },

    'task.agent_drive': async (payload, context) => {
      const input = driveSchema.parse(payload);
      // The REUSED 0.4 drive window on the ctx shim: it replays the exec's
      // ring buffer, streams the turn, and runs the settle choreography —
      // the same code a fresh start reaches after launching its exec, which
      // is exactly why re-attaching is safe.
      const shim = createCtxShim(agentTurnShimHandlers(deps.sql), {
        scheduler: taskAgentShimScheduler(deps.sql),
      });
      await driveTaskAgentTurnImpl(
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- reused 0.4 host; every ctx facility it touches is covered by agentTurnShimHandlers
        shim as unknown as Parameters<typeof driveTaskAgentTurnImpl>[0],
        input,
        { signal: driveWindowSignal(context) },
      );
    },

    'task.agent_steer': async (payload) => {
      const input = steerSchema.parse(payload);
      // The REUSED 0.4 steer host on the ctx shim. It owns the whole
      // decision — stdin injection vs exec rotation, the retry ladder, and
      // the settled-turn fallback that turns the comment into a fresh
      // mention run.
      const shim = createCtxShim(agentTurnShimHandlers(deps.sql), {
        scheduler: taskAgentShimScheduler(deps.sql),
      });
      await steerTaskAgentTurnImpl(
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- reused 0.4 host; every ctx facility it touches is covered by agentTurnShimHandlers
        shim as unknown as Parameters<typeof steerTaskAgentTurnImpl>[0],
        input,
      );
    },

    'task.agent_park_wake': async (payload) => {
      const input = z
        .object({
          organizationId: z.string().min(1),
          runId: z.string().min(1),
          execId: z.string().min(1),
        })
        .parse(payload);
      await wakeParkedAgentRun(deps.sql, input);
    },

    'task.agent_turn': async (payload, context) => {
      const input = z
        .object({
          organizationId: z.string().min(1),
          runId: z.string().min(1),
          execId: z.string().min(1),
        })
        .parse(payload);
      const runs = await deps.sql<
        {
          taskId: string;
          agentId: string;
          sessionId: string;
          harness: string;
          model: string;
          modelProvider: string | null;
          feedback: string | null;
          mentionSource: 'comment' | 'description' | null;
          deadlineAt: number;
          startedAt: number;
          launchedAt: number | null;
          status: string;
          execId: string;
          startedVia: string | null;
          viaAutomation: string | null;
          viaAgentName: string | null;
          projectId: string;
          startedBy: string;
        }[]
      >`
        SELECT r.task_id AS "taskId", r.agent_id AS "agentId",
               r.project_id AS "projectId", r.started_by AS "startedBy",
               r.session_id AS "sessionId", r.harness, r.model,
               r.model_provider AS "modelProvider", r.feedback,
               r.mention_source AS "mentionSource",
               r.deadline_at_ms::float8 AS "deadlineAt",
               r.started_at_ms::float8 AS "startedAt",
               r.launched_at_ms::float8 AS "launchedAt", r.status,
               r.exec_id AS "execId", r.started_via AS "startedVia",
               r.started_via_automation AS "viaAutomation",
               via_agent.name AS "viaAgentName"
        FROM app.project_agent_runs r
        LEFT JOIN app.project_agents via_agent
          ON via_agent.id = r.started_via_agent_id
         AND via_agent.org_id = r.org_id
        WHERE r.id = ${input.runId} AND r.org_id = ${input.organizationId}
        LIMIT 1
      `;
      const run = runs[0];
      if (!run || run.status !== 'queued' || run.execId !== input.execId) {
        console.warn(
          `[task-agent] turn job for ${input.execId} skipped (run ${run?.status ?? 'gone'})`,
        );
        return;
      }
      // A run a schedule began launches only while that schedule may still
      // act in the project: one paused, removed or unbound after the kick
      // leaves nothing to run for, so the run fails here, saying why,
      // rather than working confined for nobody.
      if (
        parseRunStarter(run.startedBy).kind === 'trigger' &&
        !(await runStarterMayEditProject(deps.sql, {
          organizationId: input.organizationId,
          projectId: run.projectId,
          startedBy: run.startedBy,
        }))
      ) {
        await failAgentRun(deps.sql, {
          organizationId: input.organizationId,
          runId: input.runId,
          execId: input.execId,
          error: SCHEDULE_REVOKED_BEFORE_LAUNCH,
        });
        console.warn(
          `[task-agent] turn job for ${input.execId} refused: its schedule may no longer act in the project`,
        );
        return;
      }
      const agents = await deps.sql<
        {
          instructions: string | null;
          skills: string[];
          connectors: string[];
          tools: string[];
          secrets: string[];
        }[]
      >`
        SELECT instructions, skills, connectors, tools, secrets
        FROM app.project_agents
        WHERE id = ${run.agentId} AND org_id = ${input.organizationId}
        LIMIT 1
      `;
      const agent = agents[0];
      if (!agent) {
        console.warn(
          `[task-agent] turn job for ${input.execId} skipped (agent gone)`,
        );
        return;
      }
      // The worker the run starts in: each run of the agent working at the
      // same time as another works in a sandbox of its own. A run no worker
      // can take now is parked with its reason and starts on its own when
      // one frees; every start funnels through this job, so the kick, the
      // wake, the retry and the recovery all choose here.
      const claim = await claimAgentWorker(deps.sql, input);
      if (claim === null) {
        console.warn(
          `[task-agent] turn job for ${input.execId} skipped (run no longer queued under it)`,
        );
        return;
      }
      if ('parked' in claim) {
        console.warn(
          `[task-agent] no free worker for ${input.execId} — parked (${claim.parked})`,
        );
        return;
      }
      if (claim.moved) {
        // The workspace the run named before may now hold no run: give its
        // slot back rather than waiting for the watchdog's backstop.
        await releaseProjectAgentSessionSlot(deps.sql, {
          organizationId: input.organizationId,
          agentId: run.agentId,
        }).catch((error: unknown) => {
          console.warn(
            `[task-agent] releasing idle workers after ${input.execId} moved failed:`,
            error,
          );
        });
      }
      // The kick-time resume plan (reused decision core over PG): does the
      // previous harness conversation continue, is the box swept, which
      // broker accounts rotate out. Every start scheduler funnels through
      // this job, so the plan covers the kick, the wake, and the retry.
      const plan = await resolveTaskKickStartArgs(deps.sql, {
        organizationId: input.organizationId,
        taskId: run.taskId,
        agentId: run.agentId,
        harness: run.harness,
        sessionId: claim.sessionId,
      });
      // The REUSED 0.4 turn host on the ctx shim — the whole start: session
      // ensure, staging, key mint, exec, drain, settle choreography.
      const shim = createCtxShim(agentTurnShimHandlers(deps.sql), {
        scheduler: taskAgentShimScheduler(deps.sql),
      });
      await startTaskAgentTurnImpl(
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- reused 0.4 host; every ctx facility it touches is covered by agentTurnShimHandlers
        shim as unknown as Parameters<typeof startTaskAgentTurnImpl>[0],
        {
          organizationId: input.organizationId,
          runId: input.runId,
          taskId: run.taskId,
          agentId: run.agentId,
          execId: input.execId,
          sessionId: claim.sessionId,
          harness: run.harness,
          // Waiting for a worker used none of the run's working time.
          deadlineAt: agentRunWorkDeadline(run, Date.now()),
          model: run.model,
          ...(run.modelProvider !== null
            ? { modelProvider: run.modelProvider }
            : {}),
          ...(agent.instructions !== null
            ? { instructions: agent.instructions }
            : {}),
          skills: agent.skills,
          connectors: agent.connectors,
          tools: agent.tools,
          secrets: agent.secrets,
          ...(run.feedback !== null ? { feedback: run.feedback } : {}),
          ...(run.mentionSource !== null
            ? { mentionSource: run.mentionSource }
            : {}),
          // A run an automation step or another agent started names it in
          // the prompt, so its message never reads as a person's review.
          ...(run.startedVia === 'automation' && run.viaAutomation !== null
            ? {
                requester: {
                  kind: 'automation' as const,
                  name: run.viaAutomation,
                },
              }
            : run.startedVia === 'agent'
              ? {
                  requester: {
                    kind: 'agent' as const,
                    name: run.viaAgentName ?? 'a deleted agent',
                  },
                }
              : {}),
          ...plan,
        },
        context !== undefined ? { signal: context.signal } : undefined,
      );
    },
    'task.agent_retry': agentRetry,
    'task.agent_retry_recheck': agentRetry,
    'sandbox.gateway_key_reconcile': async (payload) => {
      const input = z
        .object({
          organizationId: z.string().min(1),
          sessionId: z.string().min(1),
          execId: z.string().min(1),
        })
        .parse(payload);
      const outcome = await reconcileSessionOpKey(deps.sql, input);
      if (outcome !== null && (!outcome.spendSettled || !outcome.keyRevoked)) {
        // Still open: throw so pg-boss retries on its backoff ladder.
        throw new Error(
          `gateway key settlement for ${input.sessionId}/${input.execId} still pending (spend ${outcome.spendSettled ? 'booked' : 'open'}, key ${outcome.keyRevoked ? 'revoked' : 'live'})`,
        );
      }
    },
    // The start and the answered-ask resume take no shutdown signal: their
    // windows launch the exec, and cutting one before its launch request is
    // sent would lose the turn. They finish inside the stop budget, or the
    // agent watchdog re-attaches the turn as it does after any crash.
    'automation.agent_turn': async (payload) => {
      const input = z
        .looseObject({
          organizationId: z.string().min(1),
          runId: z.string().min(1),
          execId: z.string().min(1),
          sessionId: z.string().min(1),
        })
        .parse(payload);
      const shim = createCtxShim(automationShimHandlers(deps.sql), {
        scheduler: automationShimScheduler(deps.sql),
      });
      await startWorkflowAgentTurnImpl(
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- reused 0.4 host; every ctx facility it touches is covered by automationShimHandlers
        shim as unknown as Parameters<typeof startWorkflowAgentTurnImpl>[0],
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the kick built exactly the host's start-args shape; the host re-validates semantics
        input as unknown as Parameters<typeof startWorkflowAgentTurnImpl>[1],
      );
    },
    'automation.agent_drive': async (payload, context) => {
      const input = z
        .object({
          organizationId: z.string().min(1),
          runId: z.string().min(1),
          nodeId: z.string().min(1),
          execId: z.string().min(1),
          sessionId: z.string().min(1),
          harness: z.string().min(1),
          providerSlug: z.string().min(1),
          gatewayModel: z.string().min(1),
          deadlineAt: z.number(),
        })
        .parse(payload);
      // The REUSED 0.4 drive window on the ctx shim: it replays the exec's
      // ring buffer, streams the turn, and self-chains until the harness
      // ends — the same code the start reaches after its first window.
      const shim = createCtxShim(automationShimHandlers(deps.sql), {
        scheduler: automationShimScheduler(deps.sql),
      });
      await driveWorkflowAgentTurnImpl(
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- reused 0.4 host; every ctx facility it touches is covered by automationShimHandlers
        shim as unknown as Parameters<typeof driveWorkflowAgentTurnImpl>[0],
        input,
        { signal: driveWindowSignal(context) },
      );
    },
    'automation.ask_resume': async (payload) => {
      const input = z
        .object({
          organizationId: z.string().min(1),
          askId: z.string().min(1),
        })
        .parse(payload);
      const shim = createCtxShim(automationShimHandlers(deps.sql), {
        scheduler: automationShimScheduler(deps.sql),
      });
      await resumeWorkflowAgentTurnWithAnswerImpl(
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- reused 0.4 host; every ctx facility it touches is covered by automationShimHandlers
        shim as unknown as Parameters<
          typeof resumeWorkflowAgentTurnWithAnswerImpl
        >[0],
        input,
      );
    },
    'automation.poll': async (payload) => {
      const input = z
        .object({
          organizationId: z.string().min(1),
          runId: z.string().min(1),
          seq: z.number().int(),
          pollMs: z.number().int().min(1),
        })
        .parse(payload);
      await pollParkedRun(deps.sql, input);
    },
  };
}
