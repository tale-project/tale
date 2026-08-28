/**
 * Central registry mapping task identifiers to payload shapes and queue
 * options. Every enqueue site and every worker handler must go through this
 * map so the identifier/payload contract stays typechecked end to end; each
 * identifier is one pg-boss queue, created at boot with the options below.
 *
 * Delivery is at-least-once: every handler must be idempotent, deriving its
 * idempotency key from durable ids (run id, node id, item index) — never
 * minting one per attempt.
 */
export interface TaskPayloads {
  /** Health/latency probe; also used by the integration check. */
  noop: { seq?: number; sentAtMs?: number };
  /** Seed a new org's on-disk config tree from the builtin catalog. */
  'org.scaffold': { orgSlug: string; cleanFirst?: boolean };
  /** Remove a deleted org's on-disk config subtree. */
  'org.cleanup_files': { orgSlug: string };
  /** Daily sweep of idle rate-limit rows (cron). */
  'maintenance.rate_limit_gc': Record<string, never>;
  /** Daily loginAttempts 30-day TTL + block-counter 90-day TTL (cron). */
  'maintenance.login_attempts_ttl': Record<string, never>;
  /** Index one uploaded file into the org's RAG corpus. */
  'rag.index_file': { fileId: string };
  /** One stepper turn of an automation run (claim-fenced, idempotent). */
  'automation.step': { organizationId: string; runId: string };
  /** One hop of a parked run's poll chain (chainSeq-fenced). */
  'automation.poll': {
    organizationId: string;
    runId: string;
    seq: number;
    pollMs: number;
  };
  /** Per-minute scan firing due schedule triggers (cron). */
  'automation.trigger_scan': Record<string, never>;
  /** Per-minute liveness sweep re-poking overdue runs (cron). */
  'automation.liveness': Record<string, never>;
  /** One project-agent turn against a task (driver lands with 25b). */
  'task.agent_turn': { organizationId: string; runId: string; execId: string };
  /** One workflow-agent turn for an automation run's agent node. The payload
   * is the reused host's full start-args shape (validated by the handler). */
  'automation.agent_turn': Record<string, unknown>;
  /** Fire-and-forget AI naming of a thread from its first user message —
   * best-effort with a hard budget; the fallback title wins on any miss. */
  'chat.generate_title': {
    organizationId: string;
    threadId: string;
    userId: string;
    firstMessage: string;
  };
  /** One readiness-poll step of a parked send — self-chaining until the
   * media settle and the thread idles, then claims and runs the turn. */
  'chat.deferred_send_poll': { deferredSendId: string };
  /** One REST-accepted chat turn (`POST /api/v1/threads/{id}/messages`
   * answered 202) — re-gates and drives the direct turn detached. */
  'chat.api_turn': {
    organizationId: string;
    userId: string;
    threadId: string;
    userText: string;
    modelId: string;
    providerSlug?: string;
    locale?: string;
  };
  /** One outbound conversation send — fired after the undo window; the
   * handler re-checks the row is still queued (an undo deletes it). */
  'conversation.send_message': {
    organizationId: string;
    messageId: string;
    connectorName: string;
    to: string[];
    cc?: string[];
    subject: string;
    body: string;
    contentType?: string;
    inReplyTo?: string;
    references?: string[];
    from?: string;
    attachments?: Array<{
      storageRef: string;
      fileName: string;
      contentType: string;
      size: number;
    }>;
  };
  /** Stuck-pending TTS watchdog: identity-gated failed flip so a crashed
   * synthesis can't strand the player on a forever-pending chunk. */
  'tts.watchdog_chunk': { chunkId: string; attemptCreatedAt: number };
  /** Rate-gated lazy sweep of one thread's expired TTS chunks (+ blobs). */
  'tts.cleanup': { threadId: string };
  /** One actionable notification's email, debounce-delayed. The handler
   * re-reads the row and sends only when it is still unread AND the payload
   * epoch is current — a rewrite bumped the epoch (its own newer job carries
   * the final state) and an undo deleted the row. */
  'notification.email': { notificationId: string; epoch: number };
  /** Auto-retry arm for a retryably-failed task-agent run: the handler
   * re-derives every guard (task still in_progress and agent-assigned, the
   * failed run still newest, the consecutive-failure budget) and kicks. */
  'task.agent_retry': {
    organizationId: string;
    taskId: string;
    agentId: string;
    expectedRunId: string;
  };
  /** An answered human ask hands the turn back to the agent host, which
   * resumes the SAME harness conversation with the answer as its next
   * message. Enqueued in the answer's transaction. */
  'automation.ask_resume': { organizationId: string; askId: string };
  /** One GDPR erasure cascade (fires after the DSAR cooling-off window). */
  'governance.process_erasure': { requestId: string };
  /** Daily central retention cleanup — every org with applied bounds and a
   * valid clamped policy sweeps its expired rows. */
  'governance.retention_cleanup': Record<string, never>;
  /** Daily: approved legal-hold releases past their cooldown take effect. */
  'governance.effect_hold_releases': Record<string, never>;
  /** 2-min backstops for the task-agent lane: deadline-fail overdue runs,
   * wake capacity-parked ones whose release edge was lost. */
  'watchdog.task_agents': Record<string, never>;
  /** 5-min sandbox drift sweep: expire overdue sessions, reap stale
   * admission tickets (the only guard against queue-head starvation). */
  'watchdog.sandbox': Record<string, never>;
  /** 2-min direct-chat crash recovery: clear stale generation rows so a
   * hard-killed turn cannot wedge its thread's composer. */
  'watchdog.chat_generations': Record<string, never>;
  /** 15-min OneDrive sync scan: one `onedrive.sync_config` job per syncable
   * config (singletonKey per config dedupes a still-queued prior round). */
  'onedrive.sync_scan': Record<string, never>;
  /** Reconcile one OneDrive sync config (claim-fenced in the config row). */
  'onedrive.sync_config': { organizationId: string; configId: string };
}

export type TaskIdentifier = keyof TaskPayloads;

export interface TaskQueueOptions {
  /** Retries after the first attempt (pg-boss `retryLimit`). */
  retryLimit?: number;
  /** Seconds between retries; exponential when `retryBackoff` is true. */
  retryDelay?: number;
  retryBackoff?: boolean;
  /** Seconds a job may stay active before it is retried as expired. */
  expireInSeconds?: number;
}

/** Per-queue delivery policy (inherited by that queue's jobs). */
export const TASK_QUEUE_OPTIONS: Record<TaskIdentifier, TaskQueueOptions> = {
  noop: { retryLimit: 0 },
  'org.scaffold': {
    // Filesystem seeding is idempotent per domain; give transient fs errors
    // room to heal without hammering (1s, 2s, 4s, … capped by pg-boss).
    retryLimit: 10,
    retryDelay: 1,
    retryBackoff: true,
    expireInSeconds: 300,
  },
  'org.cleanup_files': {
    retryLimit: 10,
    retryDelay: 1,
    retryBackoff: true,
    expireInSeconds: 300,
  },
  'maintenance.rate_limit_gc': { retryLimit: 2, expireInSeconds: 300 },
  'maintenance.login_attempts_ttl': { retryLimit: 2, expireInSeconds: 300 },
  'rag.index_file': {
    retryLimit: 5,
    retryDelay: 5,
    retryBackoff: true,
    expireInSeconds: 900,
  },
  // Stepper turns are claim-fenced and idempotent — a retried turn either
  // wins a fresh claim or no-ops; a long node keeps the job active well
  // past a nominal budget, so the expiry is generous.
  'automation.step': {
    retryLimit: 3,
    retryDelay: 2,
    retryBackoff: true,
    expireInSeconds: 1800,
  },
  'automation.poll': { retryLimit: 3, retryDelay: 2, expireInSeconds: 120 },
  'automation.trigger_scan': { retryLimit: 1, expireInSeconds: 120 },
  'automation.liveness': { retryLimit: 1, expireInSeconds: 120 },
  // At-most-once LLM spend: the run ledger owns retries (auto-retry kicks a
  // NEW run); a lost job is the watchdog's to re-kick, never pg-boss's.
  'task.agent_turn': { retryLimit: 0, expireInSeconds: 43_200 },
  'automation.agent_turn': { retryLimit: 0, expireInSeconds: 43_200 },
  'chat.generate_title': { retryLimit: 0, expireInSeconds: 60 },
  'chat.deferred_send_poll': { retryLimit: 0, expireInSeconds: 3_600 },
  // At-most-once LLM spend, like the other turn lanes: a crash surfaces via
  // the generation watchdog + the appended error row, never a silent rerun.
  'chat.api_turn': { retryLimit: 0, expireInSeconds: 3_600 },
  // At-most-once outbound mail: a lost job settles via retrySendMessage by a
  // human, never a silent duplicate email from pg-boss.
  'conversation.send_message': { retryLimit: 0, expireInSeconds: 600 },
  // Best-effort at-most-once: the bell row is the durable record; a lost or
  // failed email is never retried into a duplicate.
  'notification.email': { retryLimit: 0, expireInSeconds: 300 },
  'tts.watchdog_chunk': { retryLimit: 1, expireInSeconds: 120 },
  'tts.cleanup': { retryLimit: 0, expireInSeconds: 300 },
  'task.agent_retry': { retryLimit: 1, expireInSeconds: 600 },
  'automation.ask_resume': { retryLimit: 0, expireInSeconds: 43_200 },
  'governance.process_erasure': { retryLimit: 1, expireInSeconds: 1_800 },
  'governance.retention_cleanup': { retryLimit: 1, expireInSeconds: 1_500 },
  'governance.effect_hold_releases': { retryLimit: 1, expireInSeconds: 300 },
  'watchdog.task_agents': { retryLimit: 1, expireInSeconds: 120 },
  'watchdog.sandbox': { retryLimit: 1, expireInSeconds: 300 },
  'watchdog.chat_generations': { retryLimit: 1, expireInSeconds: 120 },
  'onedrive.sync_scan': { retryLimit: 1, expireInSeconds: 300 },
  // At-most-once per scan round: a lost run is re-enqueued by the next scan,
  // and the config-row claim fence already blocks overlapping reconciles.
  'onedrive.sync_config': { retryLimit: 0, expireInSeconds: 1800 },
};
