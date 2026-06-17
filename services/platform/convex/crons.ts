/**
 * Cron Jobs
 *
 * Includes workflow scheduling and other periodic tasks.
 * Uses Convex native cron functionality for optimal performance.
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

// Workflow scheduling - scan for scheduled workflows every minute via Convex cron
cron(
  'scan scheduled workflows (minutely)',
  '*/1 * * * *',
  internal.workflow_engine.internal_actions.scanAndTrigger,
  {},
);

// Stuck execution recovery - mark hung executions as failed every 5 minutes
cron(
  'recover stuck workflow executions (every 5 min)',
  '*/5 * * * *',
  internal.workflow_engine.internal_mutations.recoverStuck,
  {},
);

// Central retention cleanup - single entry point that dispatches to all
// enabled categories (documents, chat history, audit logs, workflow logs,
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

// Model-capability catalog refresh — fetch model facts (pricing, context,
// reasoning/tool/vision support) from OpenRouter's public catalog into
// `modelCapabilityCache`, the layer the resolver reads UNDER operator config.
// 03:30 avoids the other daily sweeps. Self-healing: a failed fetch is recorded
// and the existing cache keeps serving.
cron(
  'refresh model capability catalog (daily)',
  '30 3 * * *',
  internal.model_catalog.sync.refreshModelCatalogCron,
  {},
);

// Weekly in-instance provider-config auto-sync — 3-way-merges fresh OpenRouter
// facts into each org's provider config (refresh defaults, add newer flagship
// versions, hide superseded), preserving operator edits. Per-org opt-out via
// the providers settings UI. Mondays 04:30 UTC (after the daily cache refresh,
// off-peak). Self-healing: offline/transient failures are logged and skipped.
cron(
  'sync provider configs from catalog (weekly)',
  '30 4 * * 1',
  internal.model_catalog.sync.refreshProviderConfigsCron,
  {},
);

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

// Plan-review TTL - cancel pending human_input approvals older than 30 min
// so research runs never hang indefinitely on user input.
cron(
  'expire stale plan-review approvals (every 5 min)',
  '*/5 * * * *',
  internal.thread_todos.plan_review_ttl.expirePlanReviews,
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

// Sandbox watchdog — same shape as the transcription / video-link sweeps.
// Convex hard-kills actions at the 30-min timeout without running the
// action's finally; that leaves sandboxExecutions stuck at `status='running'`
// and the slot they hold permanently shrinks the org's concurrent cap.
// Heartbeat from `executeCode` keeps `heartbeatAt` fresh while the action
// is alive; this cron flips rows older than 2× max-timeout to `failed`.
cron(
  'recover stuck sandbox executions (every 5 min)',
  '*/5 * * * *',
  internal.sandbox.internal_mutations.recoverStuckSandboxes,
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

// External-agent turn recovery — the connection-independent counterpart. A
// turn whose draining action died (crash / redeploy / 30min ceiling) without
// finalizing is found by its stale heartbeat and finalized exactly-once
// (VK revoke + usage ledger + clear generation + mark message failed + cancel
// the lingering exec). The cross-action continuation covers the planned long
// turn; this covers the crash.
cron(
  'recover stuck external-agent turns (every 2 min)',
  '*/2 * * * *',
  internal.agents.external_agent.recover_external_agent_turns
    .recoverStuckExternalAgentTurns,
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

// TTS orphan sweep — necessary because the schema docstring's implied
// "read-path GC" never existed: queries cannot use `ctx.scheduler` so the
// only trigger has been `markChunkReadyAndRecordUsage` (the write path).
// Threads that synthesize once then go idle would otherwise retain their
// rows indefinitely. Bounded per run by `MAX_ORGS_PER_RUN` ×
// `ROWS_PER_ORG_PER_RUN` so one busy tenant doesn't starve the rest.
// Hourly (not daily) so a transient failure recovers in ~60 min instead
// of waiting a full day, and so a deployment with more orgs than
// `MAX_ORGS_PER_RUN` sees its full org list swept within ~24 hours.
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

// Auto-route cache purge — drop routing-decision rows older than 30 days so
// the cache can't grow unbounded. Correctness rests on the candidate-roster
// hash + read-side TTL, not this sweep; daily off-peak is plenty.
cron(
  'purge stale auto-route cache (daily)',
  '30 3 * * *',
  internal.agents.internal_mutations.purgeAutoRouteCache,
  { maxAgeMs: 30 * 24 * 60 * 60 * 1000 },
);

// Workforce metrics rollup — recompute yesterday's per-project and per-agent
// daily aggregates for every org (cursor-chained pages), heal stuck task
// runs, and prune rollups past the fixed 400-day aggregate retention.
cron(
  'daily task-metrics rollup (03:00 UTC)',
  '0 3 * * *',
  internal.task_metrics.rollup.runDailyRollup,
  {},
);

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
