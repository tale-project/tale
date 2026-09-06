import type { PgBoss } from 'pg-boss';

import type { TaskIdentifier } from './tasks.ts';

/**
 * Recurring maintenance — pg-boss cron schedules, registered at worker boot
 * (idempotent upsert per queue name; every worker re-asserting the same
 * schedule is safe). Each domain port adds its rows here; handlers stay
 * idempotent because a schedule firing is at-least-once like any other job.
 */
interface CronSchedule {
  name: TaskIdentifier;
  cron: string;
}

export const SCHEDULES: CronSchedule[] = [
  // Rate-limit state is per (rule, subject) — rows idle longer than any
  // window are dead weight. Daily sweep.
  { name: 'maintenance.rate_limit_gc', cron: '20 3 * * *' },
  // loginAttempts carry a 30-day retention (GDPR minimization); the hourly
  // block counters age out after 90 days. Daily sweep.
  { name: 'maintenance.login_attempts_ttl', cron: '40 3 * * *' },
  // Realtime hints are reclaimed lazily by the `/events` poll loops, which
  // only run while a browser is connected: a headless deployment (REST and
  // automation use, nights, weekends) inserts hints on every write and
  // deletes none. This sweep keeps the hour's retention honest without one.
  { name: 'realtime.reclaim_outbox', cron: '*/10 * * * *' },
  // Automation schedule triggers fire at minute resolution; the liveness
  // sweep is the only wake source for a run whose scheduled resume was lost.
  { name: 'automation.trigger_scan', cron: '* * * * *' },
  { name: 'automation.liveness', cron: '* * * * *' },
  // The agent-lane and sandbox backstops (each its own entry so a throw in
  // one sweep can never disable another — the 0.4 isolation rationale).
  // The three daily governance jobs are SPACED, not batched, and the order
  // is the point.
  //
  // 01:00 releases first: a maker-checker legal-hold release that has cleared
  // its cooldown frees data for the sweep three hours later, instead of
  // waiting a further day. It also runs even when the retention kill-switch
  // is set, so it cannot be gated on the sweep.
  //
  // 02:00 verifies the audit chain, deliberately clear of both siblings. The
  // verifier trusts the oldest surviving row as its anchor, so running it
  // inside the 04:00 window would have it walk the chain while retention is
  // deleting audit prefixes.
  //
  // 04:00 sweeps. Packing all three into one half-hour window reintroduces
  // exactly the overlap the 0.4 comments were written to avoid.
  { name: 'governance.effect_hold_releases', cron: '0 1 * * *' },
  { name: 'audit.integrity_check', cron: '0 2 * * *' },
  { name: 'governance.retention_cleanup', cron: '0 4 * * *' },
  // Corpus↔app reconcile: de-index refs nothing references any more — the
  // backstop for release jobs that exhausted retries, and the lazy backfill
  // that drains historically stranded rows (replaced versions, rotated
  // knowledge entries) on existing deployments. After retention, so rows it
  // just purged reconcile the same night — which is why this one DOES share
  // the sweep's hour, deliberately, unlike the three above.
  { name: 'knowledge.reconcile_corpus', cron: '45 4 * * *' },
  // A staged DSAR-policy loosening promises "effective at <time>"; the
  // sweep keeps that promise even when nobody opens the page or files a
  // request in between (the reads apply it lazily as well).
  { name: 'governance.apply_dsar_policy_changes', cron: '*/5 * * * *' },
  { name: 'watchdog.task_agents', cron: '*/2 * * * *' },
  { name: 'watchdog.automation_agents', cron: '*/2 * * * *' },
  { name: 'watchdog.sandbox', cron: '*/5 * * * *' },
  { name: 'watchdog.chat_generations', cron: '*/2 * * * *' },
  // Deferred-send crash recovery: revive severed poll chains and clear sends
  // wedged 'claimed' by a crash mid-turn (an un-cancellable tray chip).
  { name: 'watchdog.deferred_sends', cron: '*/2 * * * *' },
  // Replacement-upload blob reclaim backstop (event-driven enqueues cover
  // the common paths; this drains expiry/crash leftovers).
  { name: 'documents.replacement_cleanup', cron: '*/10 * * * *' },
  // Blob-backfill crash recovery: a run whose process died mid-copy would
  // otherwise wedge 'running' and block every future backfill for the org.
  { name: 'watchdog.object_storage', cron: '*/10 * * * *' },
  // OneDrive / Google Drive mirrors refresh on a 15-minute cadence,
  // staggered so the two vendors' scans don't land on the same tick.
  { name: 'onedrive.sync_scan', cron: '*/15 * * * *' },
  { name: 'google_drive.sync_scan', cron: '7-59/15 * * * *' },
  // Website crawls: who is due, staggered kick-offs (the 0.4 5-min cron).
  { name: 'websites.scan_due', cron: '*/5 * * * *' },
  // Video-link stuck-row recovery + unbound-draft GC (the 0.4 5-min cron).
  { name: 'video.watchdog', cron: '*/5 * * * *' },
  // Browser-session pool upkeep (the 0.4 10-min cron).
  { name: 'browser.sweep', cron: '*/10 * * * *' },
  // The file-pipeline and erasure recovery sweeps (the 0.4 5-min crons).
  // Each is its own entry so a throw in one can never disable another —
  // the isolation rationale 0.4 learned when a piggy-backed sweep took its
  // host down with it.
  { name: 'watchdog.transcriptions', cron: '*/5 * * * *' },
  { name: 'watchdog.rag_indexing', cron: '2-59/5 * * * *' },
  { name: 'watchdog.erasures', cron: '4-59/5 * * * *' },
  // Session-idle enforcement: the control only exists if something revokes.
  { name: 'governance.revoke_idle_sessions', cron: '*/5 * * * *' },
  // Outbound-send crash recovery: fail replies stranded 'queued' by a lost or
  // expired send job so the sender's retry/discard controls appear.
  { name: 'watchdog.conversation_sends', cron: '*/5 * * * *' },
  // Voice-chunk retention GC + the task date ladder (the 0.4 hourly crons),
  // offset so the hour boundary is not a thundering herd.
  { name: 'tts.gc_chunks', cron: '10 * * * *' },
  { name: 'tasks.enforce_dates', cron: '25 * * * *' },
  // Rollup drift repair: the board's counters are incremental, so something
  // has to reconcile them with the rows they summarize.
  { name: 'projects.repair_rollups', cron: '40 5 * * *' },
  // Ghost-team repair: scope columns have no FK to "team", so a team that
  // went before its scopes were retired (or a door that failed half-way)
  // leaves rows nobody can see — the sweep retires them the same way the
  // doors do.
  { name: 'teams.repair_scopes', cron: '50 5 * * *' },
];

export async function registerSchedules(boss: PgBoss): Promise<void> {
  for (const schedule of SCHEDULES) {
    await boss.schedule(schedule.name, schedule.cron, undefined, {
      // One schedule per queue; tz pinned so day boundaries are stable.
      tz: 'Etc/UTC',
    });
  }
}
