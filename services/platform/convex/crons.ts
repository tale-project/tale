/**
 * Cron Jobs
 *
 * Includes automation scheduling and other periodic tasks.
 * Uses Convex's native `cronJobs` API; sub-hourly jobs are suppressed in E2E
 * to prevent test flake (see the `E2E` constant below).
 */

import { cronJobs } from 'convex/server';

import { internal } from './_generated/api';

const crons = cronJobs();

// In E2E/CI the single-node local backend shares ~4 vCPUs with Vite, the mock
// server and the browser. High-frequency cron ticks (minutely / 2-min / 5-min)
// fire background UDF bursts mid-test that starve interactive queries past the
// backend's hard ~1s function-execution timeout — the dominant source of suite
// flake. Skip the sub-hourly sweeps when running under E2E (TALE_E2E=1, set by
// the Playwright webServer); the daily/weekly/hourly jobs are harmless and stay.
const E2E = process.env.TALE_E2E === '1';

// A schedule is sub-hourly when its minute field is wildcarded/stepped
// (`*`, `*/n`) rather than a fixed minute — i.e. it fires more than once an hour.
function isSubHourly(schedule: string): boolean {
  const minuteField = schedule.trim().split(/\s+/)[0] ?? '';
  return minuteField.includes('*') || minuteField.includes('/');
}

/** Register a cron, dropping high-frequency ones under E2E (see note above). */
const cron: typeof crons.cron = (name, schedule, ...rest) => {
  if (E2E && isSubHourly(schedule)) return;
  return crons.cron(name, schedule, ...rest);
};

// Automation schedule scan — fire every `schedule` trigger that came due since
// it last ran. Minutely because a cron expression has minute resolution; the
// scan itself fires each schedule at most once per tick and never replays more
// than an hour of missed occurrences.
cron(
  'scan automation schedules (minutely)',
  '* * * * *',
  internal.automations.triggers.scanScheduledTriggers,
  {},
);

// Run liveness — every non-terminal run carries a `wakeAt` promise (renewed
// by the walker's heartbeat while a node works); this sweep re-pokes exactly
// the runs whose promise expired, i.e. whose scheduled wake was lost to a
// deploy, a restart, or a killed action. Scheduled actions are at-most-once,
// so a lost wake never comes back by itself — for a parked `waiting` run this
// sweep is the ONLY remaining wake source. Detection is stateless (any tick
// recovers everything overdue), healthy state reads zero rows, and re-entry
// is safe: the stepper resumes at the first node without a checkpoint and the
// claim epoch fences out duplicates. Its own cron entry so a throw in the
// schedule scan cannot also disable liveness.
cron(
  'enforce automation run liveness (every 2 min)',
  '*/2 * * * *',
  internal.automations.triggers.enforceRunLiveness,
  {},
);

// Agent-turn watchdog — the liveness sweep re-pokes the RUN when its wake is
// lost; this one re-attaches the sandbox TURN when its drain chain died while
// the agent was still working (stale op heartbeat, result not yet settled).
// It never kills a working agent. Its own entry so a throw in either sweep
// cannot disable the other.
cron(
  'recover stalled automation agent turns (every 2 min)',
  '*/2 * * * *',
  internal.automations.recover_agent_turns.recoverStalledAgentTurns,
  {},
);

// Task-agent watchdog — the same re-attach for TASK agent runs
// (`projectAgentRuns`), which had no recovery at all: a lost drive reschedule
// stranded the run at `running` forever with its deadline unenforced and its
// gateway key unrevoked. Its own entry, same isolation rationale.
cron(
  'recover stalled task agent turns (every 2 min)',
  '*/2 * * * *',
  internal.tasks.recover_agent_turns.recoverStalledTaskAgentTurns,
  {},
);

// Website crawl scheduler — start scans for websites whose interval has
// elapsed (or whose last scan looks crashed). The scan itself is a bounded
// continuation chain in `knowledge/crawl_action.ts`; this tick only decides
// who is due and staggers the kick-offs.
cron(
  'scan due websites (every 5 min)',
  '*/5 * * * *',
  internal.knowledge.crawl_action.scanDueWebsites,
  {},
);

// Central retention cleanup - single entry point that dispatches to all
// enabled categories (documents, chat history, audit logs, automation logs,
// usage ledger, login attempts, temp files) based on each org's
// retention_policy config. Runs daily at 4 AM UTC.
cron(
  'central retention cleanup (daily)',
  '0 4 * * *',
  internal.governance.retention_cleanup.runRetentionCleanup,
  {},
);

// Effect approved legal-hold releases standalone — runs even when the
// retention kill-switch (`TALE_RETENTION_DISABLED`) is set, and is not
// gated on a successful per-category sweep. Without this, a maker-
// checker release that has cleared its 24h cooldown can stall
// indefinitely (compliance regression). Picks an off-peak hour so it
// doesn't compete with the main 04:00 sweep.
cron(
  'effect approved legal-hold releases (daily)',
  '0 1 * * *',
  internal.governance.retention_cleanup.effectReleasesOnly,
  {},
);

// Daily model-catalog refresh re-registers here when the
// provider rewrite lands its catalog fetch. The weekly provider-config
// auto-sync (3-way merge into org files) is removed BY DESIGN — the rewrite
// forbids auto-editing operator config; catalog refresh becomes explicit.

// Audit-log integrity monitoring (#1505) — the hash-chain + checkpoint
// verification previously ran only as an on-demand admin query. Run it daily
// across every org with an audit chain and alert (a structured console.error
// plus a security-category audit row) on any chain break, truncation, or
// checkpoint mismatch. 02:00 avoids the 01:00 legal-hold release sweep and
// the 04:00 retention sweep.
cron(
  'verify audit-log integrity (daily)',
  '0 2 * * *',
  internal.audit_logs.integrity_check.runAuditIntegrityCheck,
  {},
);

// Transcription watchdog - Convex hard-kills actions at the 30-min timeout
// without running our catch block, so transcriptionStatus can stick at
// 'running' forever. Sweep stale rows every 5 min.
cron(
  'recover stuck transcriptions (every 5 min)',
  '*/5 * * * *',
  internal.file_metadata.internal_mutations.recoverStuckTranscriptions,
  {},
);

// Video-link orchestrator watchdog. Direct cron entry (not piggy-backed off
// the transcription sweep) so a throw in `recoverStuckTranscriptions` does
// not also disable the video-link recovery path — previously a single
// transient failure in the fileMetadata loop killed both watchdogs.
cron(
  'recover stuck video-link jobs (every 5 min)',
  '*/5 * * * *',
  internal.video_links.internal_mutations.recoverStuckVideoLinkJobs,
  {},
);

// RAG-indexing watchdog: recover fileMetadata rows stranded by a killed
// indexing action (`running` past the action ceiling, `queued` whose dispatch
// died) and reconcile recent failures against the corpus. Own cron entry per
// the isolation rule above — a throw here must not silence its neighbours.
cron(
  'recover stuck RAG indexing (every 5 min)',
  '*/5 * * * *',
  internal.file_metadata.rag_watchdog.recoverStuckRagIndexing,
  {},
);

// Browser-session pool sweep — expire past-TTL warmed sessions, recover cooled
// ones whose quiet period elapsed (so a transiently rate-limited session is
// reused rather than discarded), and prune long-expired rows. Every 10 min
// keeps cooling recovery timely for a small pool.
cron(
  'sweep browser sessions (every 10 min)',
  '*/10 * * * *',
  internal.browser_sessions.sessions.sweepBrowserSessions,
  {},
);
// Sandbox SESSION slot reclamation — flip a leaked session row (a throw between
// reserve and the spawner create returning, or a container reaped out-of-band)
// past its hard lifetime to `expired` so it stops pinning the per-(org) and
// per-owner active-session caps forever. Exempts `stopped` (hibernated, no
// compute, workspace preserved) and any row with a RUNNING agent-run op (an
// unbounded turn legitimately outlives the 24h TTL — guarded inside the
// mutation). Same shape as the execution watchdog above; this is the row-level
// counterpart the spawner's liveExecs reaper mirrors container-side.
cron(
  'recover stuck sandbox sessions (every 5 min)',
  '*/5 * * * *',
  internal.sandbox.session_mutations.recoverStuckSessions,
  {},
);

// Sandbox SESSION drift reconcile — the MAIN path (not the opportunistic
// page-mount reconcile) that keeps platform rows honest against the pull-only
// spawner across all orgs: hibernate a released container's row, re-assert a
// pin the spawner drops on restart (before the idle reaper stops the always-on
// box), and recreate a missing pinned container. Unresolved drift on a pinned
// session logs to GlitchTip rather than lingering as a row that lies "active".
cron(
  'reconcile sandbox session drift (every 5 min)',
  '*/5 * * * *',
  internal.node_only.sandbox.session_admin_actions.reconcileSandboxSessions,
  {},
);

// Sandbox ADMISSION ticket reaper — park-on-capacity FIFO tickets whose owner's
// poll-chain died (a cancelled/crashed automation step that stopped
// re-stamping `lastSeenAt`) would wedge the org's queue head forever. Under
// indefinite-wait this staleness sweep is the ONLY guard against permanent
// queue-head starvation, so it runs at the FASTER 2-min cadence (matching the
// agent-turn watchdogs above) to bound how long a dead head blocks live
// waiters behind it.
cron(
  'recover stuck sandbox admission tickets (every 2 min)',
  '*/2 * * * *',
  internal.sandbox.admission.recoverStuckAdmissionTickets,
  {},
);

// Direct (platform-chat) crash-recovery sweep — a hard-killed direct turn
// strands its generation row `running`, wedging the thread. This clears stale
// non-external-turn generations so the composer unlocks (rows stamped by the
// retired external-agent chat lane are skipped defensively).
cron(
  'recover stale direct chat generations (every 2 min)',
  '*/2 * * * *',
  internal.chat.generations.recoverStaleDirectGenerations,
  {},
);

// GDPR erasure watchdog (round-2 V5 P0-14) - the same shape as the
// transcription watchdog above. Convex actions hard-stop at 30 min;
// `gdprErasureRequests` rows whose subject has too many rows / RAG
// fan-out exceeding that cap stay at `status: 'running'` forever
// without admin recovery. Flip rows past 35 min to `'failed'` so
// admins can call `retryErasureRequest`. The 30-day Art 12(3) SLA
// would otherwise elapse with no path forward.
cron(
  'recover stuck gdpr erasure requests (every 5 min)',
  '*/5 * * * *',
  internal.governance.erasure.recoverStuckErasureRequests,
  {},
);

// TTS audio chunks age out (~7-day retention). The write path schedules
// opportunistic sweeps for busy threads; this hourly org-paged pass (cursor
// in `ttsGcCursor`) is the backstop that reaps idle orgs too.
cron(
  'tts orphan sweep (hourly)',
  '0 * * * *',
  internal.tts.cascade_helpers.gcOrgTtsChunks,
  {},
);

// Session idle-timeout enforcement (#1502) — server-side teeth for the
// per-org `session_idle_timeout` governance policy. The client watchdog only
// covers open tabs; this sweep revokes session rows whose `updatedAt` is
// older than the user's strictest org window, catching closed browsers and
// stolen cookies. Every 5 min keeps worst-case enforcement latency at
// roughly window + updatedAt staleness (~15 min) + cron tick + JWT tail.
cron(
  'revoke idle sessions (every 5 min)',
  '*/5 * * * *',
  internal.governance.session_idle_enforcement.revokeIdleSessions,
  {},
);

// Auto-route cache purge: removed BY DESIGN — auto agent routing (and its
// cache table) is deleted by the rewrite; the table drops with the chat rebuild.

// Daily task-metrics rollup re-registers when the chat rebuild
// re-homes task agent runs.

// Config-cache reconcile — re-derive every org's `configCache` (governance
// policies, etc.) from the source-of-truth JSON files. The cache is rebuilt on
// org-create, on every governance write, and on reseed; this hourly sweep is a
// cheap safety net that guarantees eventual convergence if any trigger is ever
// missed (the DB mirror is never authoritative).
cron(
  'reconcile config caches (hourly)',
  '15 * * * *',
  internal.lib.config_cache.sync_org.reconcileAllConfigCaches,
  {},
);

// Task start/due date notifications — start-reached, due-soon, and overdue
// SLA ladder. Replaces the retired enforce-slas pack. Hourly at :20 so it
// stays off the :00 TTS and :15 config-cache sweeps.
cron(
  'enforce task date notifications (hourly)',
  '20 * * * *',
  internal.tasks.enforce_date_notifications.enforceTaskDateNotifications,
  {},
);

// Member-mirror reconcile — re-derive `memberMirror` (the RLS read cache of
// Better Auth `member` rows) from the source of truth, bounded to a slice of
// orgs per run. Backfills members that predate the mirror and repairs any
// drift from a missed write-path beat. Same safety-net role as the config
// reconcile above; the mirror is never authoritative. 45 past the hour keeps
// it off the :00/:15 sweeps.
cron(
  'reconcile member mirror (hourly)',
  '45 * * * *',
  internal.members.mirror_reconciliation.reconcileMemberMirrors,
  {},
);

export default crons;
