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
  /** Tear down a deleted org's slug-keyed remains — corpus rows, blobs,
   *  config subtree — then clear its slug tombstone. */
  'org.cleanup_files': { orgSlug: string };
  /** Fail transcriptions whose runner died; cascade to their video jobs. */
  'watchdog.transcriptions': Record<string, never>;
  /** Reconcile stalled RAG rows against the knowledge corpus. */
  'watchdog.rag_indexing': Record<string, never>;
  /** Fail erasure runs whose processor never finished. */
  'watchdog.erasures': Record<string, never>;
  /** Revoke sessions idle past their org's policy window. */
  'governance.revoke_idle_sessions': Record<string, never>;
  /** Fleet-wide GC of expired TTS audio chunks. */
  'tts.gc_chunks': Record<string, never>;
  /** Task start/due/overdue notification ladder (hourly). */
  'tasks.enforce_dates': Record<string, never>;
  /** Recompute drifted project rollup counters from their source rows. */
  'projects.repair_rollups': Record<string, never>;
  /** Start a task's owning automation (the comment-@mention trigger). */
  'task.start_workflow': {
    organizationId: string;
    taskId: string;
    workflowSlug: string;
    startedByUserId: string;
  };
  /** Re-attach the drive chain of an abandoned (but still live) turn. */
  'task.agent_drive': {
    organizationId: string;
    runId: string;
    taskId: string;
    agentId: string;
    execId: string;
    sessionId: string;
    harness: string;
    deadlineAt: number;
    sessionCreatedAt?: number;
  };
  /** Steer a LIVE task-agent turn with a comment (stdin or exec restart). */
  'task.agent_steer': {
    organizationId: string;
    runId: string;
    taskId: string;
    agentId: string;
    execId: string;
    sessionId: string;
    harness: string;
    deadlineAt: number;
    model: string;
    modelProvider?: string;
    instructions?: string;
    skills: string[];
    connectors: string[];
    tools: string[];
    secrets: string[];
    feedback: string;
    author: string;
    authorId: string;
    attempt: number;
  };
  /** Daily sweep of idle rate-limit rows (cron). */
  'maintenance.rate_limit_gc': Record<string, never>;
  /** Daily loginAttempts 30-day TTL + block-counter 90-day TTL (cron). */
  'maintenance.login_attempts_ttl': Record<string, never>;
  /** Index one uploaded file into the org's RAG corpus. */
  'rag.index_file': { fileId: string };
  /** Release rotated-away blob refs: de-index dead corpus rows, delete
   * unreferenced bytes (enqueued transactionally by every ref rotation). */
  'knowledge.release_refs': { organizationId: string; refs: string[] };
  /** Daily corpus↔app reconcile: de-index refs nothing references (cron). */
  'knowledge.reconcile_corpus': Record<string, never>;
  /** Background `REINDEX INDEX CONCURRENTLY` of one corrupted BM25 index the
   * boot-time verification deferred (above the inline size limit). One job
   * per index (`orgSlug` null = the deployment-default database). */
  'knowledge.reindex_bm25': {
    orgSlug: string | null;
    schema: string;
    name: string;
  };
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
  /** One attach window of a live workflow-agent turn — the drive self-chain
   * `continueOrSettle` re-schedules after every `running` window. */
  'automation.agent_drive': {
    organizationId: string;
    runId: string;
    nodeId: string;
    execId: string;
    sessionId: string;
    harness: string;
    providerSlug: string;
    gatewayModel: string;
    deadlineAt: number;
  };
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
  /** Crash-recovery sweep: re-poke waiting sends whose poll chain severed and
   * clear claimed sends wedged by a crash mid-turn. */
  'watchdog.deferred_sends': Record<string, never>;
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
  /** Crash-recovery sweep: fail outbound sends stranded 'queued' by a lost or
   * expired send job so the retry/discard surface appears. */
  'watchdog.conversation_sends': Record<string, never>;
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
  /** Crash-recovery sweep: fail backfill runs whose process died mid-copy, so
   * the one-running partial index stops rejecting every future backfill. */
  'watchdog.object_storage': Record<string, never>;
  /** Daily: approved legal-hold releases past their cooldown take effect. */
  'governance.effect_hold_releases': Record<string, never>;
  /** Every 5 minutes: staged DSAR-policy loosenings past their 24h grace
   * take effect server-side — whether or not anyone opens the policy page. */
  'governance.apply_dsar_policy_changes': Record<string, never>;
  /** 2-min backstops for the task-agent lane: deadline-fail overdue runs,
   * wake capacity-parked ones whose release edge was lost. */
  'watchdog.task_agents': Record<string, never>;
  /** 2-min backstop for the automation agent lane: re-attach the drive
   * chain of an abandoned (but still live) workflow-agent turn. */
  'watchdog.automation_agents': Record<string, never>;
  /** 5-min sandbox drift sweep: expire overdue sessions, heal phantom
   * rows against the spawner, reclaim ended automation runs' sessions. */
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
  // Recovery sweeps: a tick that fails is retried once, then waits for the
  // next schedule — piling up retries of a sweep just delays the sweep.
  'watchdog.transcriptions': { retryLimit: 1, expireInSeconds: 300 },
  'watchdog.rag_indexing': { retryLimit: 1, expireInSeconds: 600 },
  'watchdog.erasures': { retryLimit: 1, expireInSeconds: 300 },
  'governance.revoke_idle_sessions': { retryLimit: 1, expireInSeconds: 300 },
  'tts.gc_chunks': { retryLimit: 1, expireInSeconds: 600 },
  'tasks.enforce_dates': { retryLimit: 1, expireInSeconds: 600 },
  'projects.repair_rollups': { retryLimit: 1, expireInSeconds: 600 },
  // The steer owns its OWN retry ladder (it re-enqueues itself with an
  // attempt counter, tight then coarse), so pg-boss must not add a second
  // one on top: a failed job is a lost steer, and the comment is still in
  // the discussion for the next run.
  'task.agent_steer': { retryLimit: 0, expireInSeconds: 300 },
  // The drive window is long (a turn can run for hours) and the recovery
  // sweep re-enqueues on its own cadence, so no pg-boss retry on top: a
  // second drive of the same exec would replay the ring buffer twice.
  'task.agent_drive': { retryLimit: 0, expireInSeconds: 43_200 },
  // The start is idempotent per (automation, task) — its own live-run guard
  // refuses a second one — so a transient failure is safe to retry.
  'task.start_workflow': { retryLimit: 3, retryDelay: 5, expireInSeconds: 300 },
  'maintenance.rate_limit_gc': { retryLimit: 2, expireInSeconds: 300 },
  'maintenance.login_attempts_ttl': { retryLimit: 2, expireInSeconds: 300 },
  // Releases are idempotent (liveness re-checked at run time; corpus and
  // blob deletes are no-ops on missing targets) — retry generously, and let
  // the daily corpus reconcile catch anything that exhausts the ladder.
  'knowledge.release_refs': {
    retryLimit: 8,
    retryDelay: 10,
    retryBackoff: true,
    expireInSeconds: 600,
  },
  'knowledge.reconcile_corpus': { retryLimit: 1, expireInSeconds: 3600 },
  // A rebuild is ONE deliberate attempt (a retry would loop on a corruption
  // REINDEX cannot fix), `short` so a concurrently booting api and worker
  // queue it once per index, and a day for a very large index to finish.
  'knowledge.reindex_bm25': {
    retryLimit: 0,
    expireInSeconds: 86_400,
    policy: 'short',
  },
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
  // Same posture as task.agent_drive: the window is long and a second drive
  // of the same exec would replay the ring buffer twice, so no pg-boss retry.
  'automation.agent_drive': { retryLimit: 0, expireInSeconds: 43_200 },
  'chat.generate_title': { retryLimit: 0, expireInSeconds: 60 },
  // 'short' + the per-send singletonKey (see deferred-sends.ts) collapses the
  // poll self-chain to at most one queued hop, so the recovery sweep can
  // blindly re-enqueue a poll for a stalled row without doubling a live chain.
  'chat.deferred_send_poll': {
    policy: 'short',
    retryLimit: 0,
    expireInSeconds: 3_600,
  },
  'watchdog.deferred_sends': { retryLimit: 1, expireInSeconds: 120 },
  // At-most-once LLM spend, like the other turn lanes: a crash surfaces via
  // the generation watchdog + the appended error row, never a silent rerun.
  'chat.api_turn': { retryLimit: 0, expireInSeconds: 3_600 },
  // At-most-once outbound mail: a lost job settles via retrySendMessage by a
  // human, never a silent duplicate email from pg-boss.
  'conversation.send_message': { retryLimit: 0, expireInSeconds: 600 },
  'watchdog.conversation_sends': { retryLimit: 1, expireInSeconds: 300 },
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
  'watchdog.object_storage': { retryLimit: 1, expireInSeconds: 300 },
  'governance.effect_hold_releases': { retryLimit: 1, expireInSeconds: 300 },
  'governance.apply_dsar_policy_changes': {
    retryLimit: 1,
    expireInSeconds: 300,
  },
  'watchdog.task_agents': { retryLimit: 1, expireInSeconds: 120 },
  'watchdog.automation_agents': { retryLimit: 1, expireInSeconds: 120 },
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
