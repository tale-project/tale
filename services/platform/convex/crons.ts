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

// Audit log retention - clean up logs older than 90 days, runs daily at 3 AM UTC
crons.cron(
  'audit log retention cleanup (daily)',
  '0 3 * * *',
  internal.audit_logs.internal_mutations.runRetentionCleanup,
  {},
);

export default crons;
