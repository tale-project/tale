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
  internal.workflow_engine.scheduler.scanAndTrigger,
  {},
);

export default crons;
