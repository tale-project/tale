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
};
