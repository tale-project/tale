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

// LLM response cache cleanup - purge expired entries hourly
crons.cron(
  'purge expired LLM response cache (hourly)',
  '0 * * * *',
  internal.lib.response_cache.internal_mutations.purgeExpired,
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

export default crons;
