import type { Sql } from 'postgres';
import { z } from 'zod';

import {
  driveWorkflowAgentTurnImpl,
  resumeWorkflowAgentTurnWithAnswerImpl,
  startWorkflowAgentTurnImpl,
} from '../core/automations/agent_host.ts';
import { stepRunImpl } from '../core/automations/stepper.ts';
import { generateThreadTitleImpl } from '../core/chat/generate_title.ts';
import { removeOrgSubtree } from '../core/organizations/scaffold.ts';
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
import { runApiTurn } from '../domains/chat/rest-turn.ts';
import { chatShimHandlers } from '../domains/chat/shim.ts';
import { createPgUsageLedger } from '../domains/chat/store.ts';
import { runChatGenerationWatchdog } from '../domains/chat/watchdogs.ts';
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
import { runSandboxWatchdog } from '../domains/sandbox/watchdogs.ts';
import { kickAgentRun } from '../domains/tasks/agent-runs.ts';
import {
  agentTurnShimHandlers,
  taskAgentShimScheduler,
} from '../domains/tasks/agent-turn-shim.ts';
import { resolveTaskKickStartArgs } from '../domains/tasks/kick-plan.ts';
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

/** One task handler; `payload` is a job row — external input, re-validate. */
export type TaskHandler = (payload: unknown) => Promise<void>;

export type BackendTaskList = Record<string, TaskHandler>;

const orgScaffoldSchema = z.object({
  orgSlug: z.string().min(1),
  cleanFirst: z.boolean().optional(),
});

const orgCleanupSchema = z.object({
  orgSlug: z.string().min(1),
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
  author: z.string(),
  authorId: z.string(),
  attempt: z.number(),
});

const slackEventSchema = z.object({
  organizationId: z.string().min(1),
  credentialId: z.string().min(1),
  teamId: z.string().min(1),
  eventId: z.string().optional(),
  eventType: z.string().optional(),
  event: z.record(z.string(), z.unknown()),
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
export function createTaskList(deps: TaskDeps): BackendTaskList {
  return {
    noop: (payload) => {
      console.debug(`[backend] noop task executed: ${JSON.stringify(payload)}`);
      return Promise.resolve();
    },
    'org.scaffold': async (payload) => {
      const input = orgScaffoldSchema.parse(payload);
      const result = await scaffoldNewOrganization(input);
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
    'connector.slack_event': (payload) => {
      const input = slackEventSchema.parse(payload);
      // The conversational surface that answers inbound messages is not wired
      // to this lane yet (0.4 degrades the same way, deliberately: the
      // signature check, the org resolution and the routing all still run,
      // which is what keeps the endpoint honest). Accepting and logging is
      // the whole handler until that surface takes delivery.
      console.info('[connectors:slack] inbound event accepted', {
        organizationId: input.organizationId,
        teamId: input.teamId,
        eventId: input.eventId,
        eventType: input.eventType,
      });
      return Promise.resolve();
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
    'maintenance.rate_limit_gc': async () => {
      // Any row idle for 7 days is past every window/refill horizon.
      const cutoff = Date.now() - 7 * 24 * 3_600_000;
      const deleted = await deps.sql`
        DELETE FROM app.rate_limits WHERE ts < ${cutoff}
      `;
      console.log(`[maintenance] rate_limit_gc removed ${deleted.count} rows`);
    },
    'maintenance.login_attempts_ttl': async () => {
      const attemptsCutoff = Date.now() - 30 * 24 * 3_600_000;
      const countersCutoff = Date.now() - 90 * 24 * 3_600_000;
      const attempts = await deps.sql`
        DELETE FROM app.login_attempts
        WHERE last_failure_at < ${attemptsCutoff}
      `;
      const counters = await deps.sql`
        DELETE FROM app.login_block_counters
        WHERE window_start < ${countersCutoff}
      `;
      console.log(
        `[maintenance] login_attempts_ttl removed ${attempts.count} attempts, ${counters.count} counters`,
      );
    },
    'rag.index_file': async (payload) => {
      const input = z.object({ fileId: z.string().min(1) }).parse(payload);
      await indexUploadedFile(deps.sql, input.fileId);
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
    'org.cleanup_files': async (payload) => {
      const input = orgCleanupSchema.parse(payload);
      const configRoot = process.env.TALE_CONFIG_DIR;
      if (!configRoot) {
        throw new Error(
          'TALE_CONFIG_DIR is unset — cannot clean up the org config subtree',
        );
      }
      // Guarded two-phase rename-then-delete (slug validation, traversal +
      // symlink defenses) — reused from the 0.4 module unchanged.
      await removeOrgSubtree(configRoot, input.orgSlug);
    },
    'automation.step': async (payload) => {
      const input = z
        .object({ organizationId: z.string().min(1), runId: z.string().min(1) })
        .parse(payload);
      // The REUSED 0.4 stepper on the ctx shim. Claim-fenced and idempotent:
      // a retried job either wins a fresh claim or no-ops. The scheduler seam
      // lets the agent node's kick schedule its turn as a pg-boss job.
      const shim = createCtxShim(automationShimHandlers(deps.sql), {
        scheduler: automationShimScheduler(deps.sql),
      });
      await stepRunImpl(
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- reused 0.4 stepper; every ctx facility it touches is covered by automationShimHandlers
        shim as unknown as Parameters<typeof stepRunImpl>[0],
        input,
      );
    },
    'automation.trigger_scan': async () => {
      const result = await scanScheduledTriggers(deps.sql);
      if (result.fired > 0) {
        console.log(
          `[automations] trigger scan fired ${result.fired}/${result.examined}`,
        );
      }
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
    'watchdog.task_agents': async () => {
      // Re-attach BEFORE the deadline pass: a turn whose chain died is
      // still doing work, and failing it for a stale heartbeat would throw
      // away a live agent's output.
      const { recoverStalledTaskAgentTurns } =
        await import('../domains/tasks/reattach.ts');
      const reattached = await recoverStalledTaskAgentTurns(deps.sql);
      if (reattached.resumed > 0) {
        console.log(
          `[watchdog] task agents: re-attached ${reattached.resumed} of ${reattached.examined} abandoned turn(s)`,
        );
      }
      const result = await runTaskAgentWatchdog(deps.sql);
      if (result.failed > 0 || result.woken > 0) {
        console.log(
          `[watchdog] task agents: failed ${result.failed} overdue, woke ${result.woken} parked`,
        );
      }
    },
    'watchdog.automation_agents': async () => {
      // The workflow twin of the task-agent re-attach: a drive chain that
      // died mid-turn is resurrected from the run cursor, never failed —
      // the agent in the sandbox is still doing (or has finished) the work.
      const { recoverStalledWorkflowAgentTurns } =
        await import('../domains/automations/reattach.ts');
      const reattached = await recoverStalledWorkflowAgentTurns(deps.sql);
      if (reattached.resumed > 0) {
        console.log(
          `[watchdog] automation agents: re-attached ${reattached.resumed} of ${reattached.examined} abandoned turn(s)`,
        );
      }
    },
    'watchdog.sandbox': async () => {
      const result = await runSandboxWatchdog(deps.sql);
      if (result.expired > 0 || result.healed > 0 || result.reaped > 0) {
        console.log(
          `[watchdog] sandbox: expired ${result.expired}, healed ${result.healed}, reaped ${result.reaped} tickets`,
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
        })
        .parse(payload);
      // The REUSED 0.4 naming attempt on the chat shim — one small model
      // call raced against its timeout; any miss falls back to the derived
      // title, and the write fills only an absent title.
      const shim = createCtxShim(chatShimHandlers(deps.sql));
      await generateThreadTitleImpl(
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- reused 0.4 action; every ctx facility it touches is covered by chatShimHandlers
        shim as unknown as Parameters<typeof generateThreadTitleImpl>[0],
        input,
        // Naming a thread is a model call the org pays for. The shim has no
        // ledger of its own, so the door hands it the same one the turn
        // writes through — booked under its own agent slug so analytics can
        // separate "what the conversation cost" from "what naming it cost".
        (entry) => createPgUsageLedger(deps.sql).record(entry),
      );
    },
    'chat.api_turn': async (payload) => {
      const input = z
        .object({
          organizationId: z.string().min(1),
          userId: z.string().min(1),
          threadId: z.string().min(1),
          userText: z.string().min(1),
          modelId: z.string().min(1),
          providerSlug: z.string().min(1).optional(),
          locale: z.string().min(1).optional(),
        })
        .parse(payload);
      await runApiTurn(deps.sql, input);
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
    'websites.scan': async (payload) => {
      const input = z
        .object({
          domain: z.string().min(1),
          orgSlug: z.string().min(1),
          organizationId: z.string().min(1),
          continuation: z.number().int().min(0).optional(),
          scanStartedAt: z.string().optional(),
        })
        .parse(payload);
      await runWebsitesScan(deps.sql, input);
    },
    'websites.register': async (payload) => {
      const input = z
        .object({
          websiteId: z.string().min(1),
          domain: z.string().min(1),
          scanInterval: z.string().min(1),
          organizationId: z.string().min(1),
          urls: z.array(z.string()).optional(),
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

    'task.agent_drive': async (payload) => {
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

    'task.agent_turn': async (payload) => {
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
          deadlineAt: number;
          status: string;
          execId: string;
        }[]
      >`
        SELECT task_id AS "taskId", agent_id AS "agentId",
               session_id AS "sessionId", harness, model,
               model_provider AS "modelProvider", feedback,
               deadline_at_ms::float8 AS "deadlineAt", status,
               exec_id AS "execId"
        FROM app.project_agent_runs
        WHERE id = ${input.runId} AND org_id = ${input.organizationId}
        LIMIT 1
      `;
      const run = runs[0];
      if (!run || run.status !== 'queued' || run.execId !== input.execId) {
        console.warn(
          `[task-agent] turn job for ${input.execId} skipped (run ${run?.status ?? 'gone'})`,
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
      // The kick-time resume plan (reused decision core over PG): does the
      // previous harness conversation continue, is the box swept, which
      // broker accounts rotate out. Every start scheduler funnels through
      // this job, so the plan covers the kick, the wake, and the retry.
      const plan = await resolveTaskKickStartArgs(deps.sql, {
        organizationId: input.organizationId,
        taskId: run.taskId,
        agentId: run.agentId,
        harness: run.harness,
        sessionId: run.sessionId,
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
          sessionId: run.sessionId,
          harness: run.harness,
          deadlineAt: run.deadlineAt,
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
          ...plan,
        },
      );
    },
    'task.agent_retry': async (payload) => {
      const input = z
        .object({
          organizationId: z.string().min(1),
          taskId: z.string().min(1),
          agentId: z.string().min(1),
          expectedRunId: z.string().min(1),
        })
        .parse(payload);
      // The 0.5 port of `kickAutoRetryRun`: every guard re-derived in ONE
      // transaction — the failed run must still be the task's newest (a
      // raced manual kick supersedes the retry), the card must still sit at
      // in_progress with THIS agent assigned (a person intervening must not
      // be overridden), and the consecutive-failure budget (reused pure
      // module) must have room. Attribution stays with the failed run's own
      // starter — the retry continues THEIR kick.
      const outcome = await deps.sql.begin(async (tx) => {
        const tasks = await tx<
          {
            status: string;
            archivedAt: number | null;
            projectId: string;
            assigneeType: string | null;
            assigneeId: string | null;
          }[]
        >`
          SELECT status, archived_at_ms::float8 AS "archivedAt",
                 project_id AS "projectId",
                 assignee_type AS "assigneeType", assignee_id AS "assigneeId"
          FROM app.tasks
          WHERE id = ${input.taskId} AND org_id = ${input.organizationId}
          FOR UPDATE
        `;
        const task = tasks[0];
        if (!task || task.archivedAt !== null) return 'task_unavailable';
        if (task.status !== 'in_progress') return 'task_moved';
        if (
          task.assigneeType !== 'agent' ||
          task.assigneeId !== input.agentId
        ) {
          return 'reassigned';
        }
        const runs = await tx<
          {
            id: string;
            status: string;
            agentId: string;
            startedBy: string;
            launchedAt: number | null;
            settledAt: number | null;
          }[]
        >`
          SELECT id, status, agent_id AS "agentId",
                 started_by AS "startedBy",
                 launched_at_ms::float8 AS "launchedAt",
                 settled_at_ms::float8 AS "settledAt"
          FROM app.project_agent_runs
          WHERE task_id = ${input.taskId}
          ORDER BY seq DESC
          LIMIT 8
        `;
        const newest = runs[0];
        if (newest === undefined || newest.id !== input.expectedRunId) {
          return 'superseded';
        }
        if (newest.status !== 'failed') return 'not_failed';
        const budget = resolveAutoRetryBudget(
          runs.map((row) => ({
            agentId: row.agentId,
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the column CHECK admits exactly these statuses
            status: row.status as
              | 'queued'
              | 'running'
              | 'settled'
              | 'failed'
              | 'cancelled',
            launchedAt: row.launchedAt ?? undefined,
            settledAt: row.settledAt ?? undefined,
          })),
        );
        if (!budget.retry) return 'budget_exhausted';
        const agents = await tx<
          { harness: string; model: string; modelProvider: string | null }[]
        >`
          SELECT harness, model, model_provider AS "modelProvider"
          FROM app.project_agents
          WHERE id = ${input.agentId} AND org_id = ${input.organizationId}
          LIMIT 1
        `;
        const agent = agents[0];
        if (!agent) return 'agent_gone';
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
          autoRetryAttempt: budget.attempt,
        });
        return 'kicked';
      });
      if (outcome !== 'kicked') {
        console.log(`[task-agent] auto-retry skipped: ${outcome}`);
      }
    },
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
    'automation.agent_drive': async (payload) => {
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
