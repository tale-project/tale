/**
 * Cron Jobs
 *
 * Includes workflow scheduling and other periodic tasks.
 * Uses Convex native cron functionality for optimal performance.
 */

import { cronJobs } from 'convex/server';

import { internal } from './_generated/api';

const crons = cronJobs();

// Workflow scheduling - scan for scheduled workflows every minute via Convex cron
crons.cron(
  'scan scheduled workflows (minutely)',
  '*/1 * * * *',
  internal.workflow_engine.internal_actions.scanAndTrigger,
  {},
);

// Stuck execution recovery - mark hung executions as failed every 5 minutes
crons.cron(
  'recover stuck workflow executions (every 5 min)',
  '*/5 * * * *',
  internal.workflow_engine.internal_mutations.recoverStuck,
  {},
);

// Central retention cleanup - single entry point that dispatches to all
// enabled categories (documents, chat history, audit logs, workflow logs,
// usage ledger, login attempts, temp files) based on each org's
// retention_policy config. Runs daily at 4 AM UTC.
crons.cron(
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
crons.cron(
  'effect approved legal-hold releases (daily)',
  '0 1 * * *',
  internal.governance.retention_cleanup.effectReleasesOnly,
  {},
);

// Plan-review TTL - cancel pending human_input approvals older than 30 min
// so research runs never hang indefinitely on user input.
crons.cron(
  'expire stale plan-review approvals (every 5 min)',
  '*/5 * * * *',
  internal.thread_todos.plan_review_ttl.expirePlanReviews,
  {},
);

// Transcription watchdog - Convex hard-kills actions at the 30-min timeout
// without running our catch block, so transcriptionStatus can stick at
// 'running' forever. Sweep stale rows every 5 min.
crons.cron(
  'recover stuck transcriptions (every 5 min)',
  '*/5 * * * *',
  internal.file_metadata.internal_mutations.recoverStuckTranscriptions,
  {},
);

// Video-link orchestrator watchdog. Direct cron entry (not piggy-backed off
// the transcription sweep) so a throw in `recoverStuckTranscriptions` does
// not also disable the video-link recovery path — previously a single
// transient failure in the fileMetadata loop killed both watchdogs.
crons.cron(
  'recover stuck video-link jobs (every 5 min)',
  '*/5 * * * *',
  internal.video_links.internal_mutations.recoverStuckVideoLinkJobs,
  {},
);

// Artifact stream watchdog - clear streamingContent / liveStreamMode on rows
// where the writing tool call went silent past the threshold (covers crashed
// agent runs that never reached the tool's finally-block).
crons.cron(
  'clear stale artifact streams (every 5 min)',
  '*/5 * * * *',
  internal.artifacts.internal_mutations.cleanupStaleStreams,
  {},
);

// GDPR erasure watchdog (round-2 V5 P0-14) - the same shape as the
// transcription watchdog above. Convex actions hard-stop at 30 min;
// `gdprErasureRequests` rows whose subject has too many rows / RAG
// fan-out exceeding that cap stay at `status: 'running'` forever
// without admin recovery. Flip rows past 35 min to `'failed'` so
// admins can call `retryErasureRequest`. The 30-day Art 12(3) SLA
// would otherwise elapse with no path forward.
crons.cron(
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
crons.cron(
  'tts orphan sweep (hourly)',
  '0 * * * *',
  internal.tts.cascade_helpers.gcOrgTtsChunks,
  {},
);

export default crons;
