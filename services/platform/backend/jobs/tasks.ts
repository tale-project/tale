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
  /** One verified, org-resolved Slack event (see domains/connectors). */
  'connector.slack_event': {
    organizationId: string;
    credentialId: string;
    teamId: string;
    /** Slack's per-delivery id — the dedup key for its at-least-once retries. */
    eventId?: string;
    eventType?: string;
    /** The verified `event` object, exactly as Slack sent it. */
    event: Record<string, unknown>;
  };
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
  /** Daily incremental audit-chain integrity walk (progress row per org). */
  'audit.integrity_check': Record<string, never>;
  /** Copy an org's blobs default-store -> BYO bucket (admin-triggered). */
  'object_storage.backfill': { runId: string; organizationId: string };
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
  /** Reclaim due controlled-document replacement staging/orphan blobs. */
  'documents.replacement_cleanup': Record<string, never>;
  /** 15-min OneDrive sync scan: one `onedrive.sync_config` job per syncable
   * config (singletonKey per config dedupes a still-queued prior round). */
  'onedrive.sync_scan': Record<string, never>;
  /** Reconcile one OneDrive sync config (claim-fenced in the config row). */
  'onedrive.sync_config': { organizationId: string; configId: string };
  /** 15-min Google Drive sync scan (same engine as OneDrive's). */
  'google_drive.sync_scan': Record<string, never>;
  /** Reconcile one Google Drive sync config (claim-fenced). */
  'google_drive.sync_config': { organizationId: string; configId: string };
  /** 5-min website crawl scheduler tick (the 0.4 cron). */
  'websites.scan_due': Record<string, never>;
  /** One continuation link of a domain scan — the reused engine body
   * self-chains through this queue; the corpus-side claim is the fence. */
  'websites.scan': {
    domain: string;
    orgSlug: string;
    organizationId: string;
    continuation?: number;
    scanStartedAt?: string;
  };
  /** Register a website (or URL list) in the corpus + kick its first scan
   * (the 0.4 `registerAndSync`, fire-and-forget behind the create). */
  'websites.register': {
    websiteId: string;
    domain: string;
    scanInterval: string;
    organizationId: string;
    urls?: string[];
  };
  /** Push the corpus-side truth onto one (orgSlug, domain) websites row. */
  'websites.row_sync': { orgSlug: string; domain: string };
  /** One transcription attempt for an uploaded audio/video file (the reused
   * pipeline self-retries through this queue with [30s,60s,120s] delays). */
  'files.transcribe': {
    storageId: string;
    fileName: string;
    contentType: string;
    organizationId: string;
    attempt?: number;
  };
  /** One video-link ingest attempt (the reused orchestrator; its
   * [30s,60s,120s] retry self-chain re-enters this queue). */
  'video.ingest': { jobId: string; userLocale?: string };
  /** Materialize a donor transcript for a clone job (no yt-dlp). */
  'video.clone': {
    jobId: string;
    donorFileMetadataId: string;
    organizationId: string;
  };
  /** 5-min stuck-row watchdog + lazy unbound GC for video-link jobs. */
  'video.watchdog': Record<string, never>;
  /** 10-min browser-session pool sweep (expire/recover/prune). */
  'browser.sweep': Record<string, never>;
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
  /**
   * pg-boss queue policy. The default (`standard`) treats `singletonKey` as a
   * throttling label only — dedup by key needs `short` (at most ONE QUEUED
   * job per key). Set it where an upstream retries a delivery we have already
   * accepted, and give every job on that queue a key, or keyless jobs share
   * the default key and shut each other out.
   */
  policy?: 'standard' | 'short' | 'singleton' | 'stately';
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
  'connector.slack_event': {
    // Slack retries a delivery it thinks went unacknowledged; `short` +
    // the per-delivery singleton key collapses that retry into the job
    // already queued instead of replaying the conversation.
    policy: 'short',
    // The endpoint has already acknowledged Slack, so a failed handoff is
    // ours to retry — but an event that cannot be handled after a few tries
    // is stale conversation, not something to keep replaying for hours.
    retryLimit: 3,
    retryDelay: 5,
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
  'audit.integrity_check': { retryLimit: 1, expireInSeconds: 1_500 },
  'object_storage.backfill': { retryLimit: 0, expireInSeconds: 3_600 },
  'governance.effect_hold_releases': { retryLimit: 1, expireInSeconds: 300 },
  'watchdog.task_agents': { retryLimit: 1, expireInSeconds: 120 },
  'watchdog.sandbox': { retryLimit: 1, expireInSeconds: 300 },
  'watchdog.chat_generations': { retryLimit: 1, expireInSeconds: 120 },
  'documents.replacement_cleanup': { retryLimit: 1, expireInSeconds: 300 },
  'onedrive.sync_scan': { retryLimit: 1, expireInSeconds: 300 },
  // At-most-once per scan round: a lost run is re-enqueued by the next scan,
  // and the config-row claim fence already blocks overlapping reconciles.
  'onedrive.sync_config': { retryLimit: 0, expireInSeconds: 1800 },
  'google_drive.sync_scan': { retryLimit: 1, expireInSeconds: 300 },
  'google_drive.sync_config': { retryLimit: 0, expireInSeconds: 1800 },
  'websites.scan_due': { retryLimit: 1, expireInSeconds: 240 },
  // At-most-once per attempt: the pipeline classifies its own errors and
  // self-chains retries; the single-flight lease on the row fences dupes.
  'files.transcribe': { retryLimit: 0, expireInSeconds: 2100 },
  // At-most-once: the orchestrator persists attempts and self-chains its
  // retries; a lost job is the watchdog's to fail, never pg-boss's to redo.
  'video.ingest': { retryLimit: 0, expireInSeconds: 1500 },
  'video.clone': { retryLimit: 1, expireInSeconds: 300 },
  'video.watchdog': { retryLimit: 1, expireInSeconds: 240 },
  'browser.sweep': { retryLimit: 1, expireInSeconds: 120 },
  // At-most-once per link: the engine records its own failures on the row
  // and the 5-min scheduler is the retry; the corpus claim fences overlap.
  // A link's budget is ~9 minutes (the 0.4 action hard wall).
  'websites.scan': { retryLimit: 0, expireInSeconds: 900 },
  'websites.register': { retryLimit: 1, expireInSeconds: 300 },
  'websites.row_sync': { retryLimit: 0, expireInSeconds: 120 },
};
