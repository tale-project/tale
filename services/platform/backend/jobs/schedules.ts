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

const SCHEDULES: CronSchedule[] = [
  // Rate-limit state is per (rule, subject) — rows idle longer than any
  // window are dead weight. Daily sweep.
  { name: 'maintenance.rate_limit_gc', cron: '20 3 * * *' },
  // loginAttempts carry a 30-day retention (GDPR minimization); the hourly
  // block counters age out after 90 days. Daily sweep.
  { name: 'maintenance.login_attempts_ttl', cron: '40 3 * * *' },
  // Automation schedule triggers fire at minute resolution; the liveness
  // sweep is the only wake source for a run whose scheduled resume was lost.
  { name: 'automation.trigger_scan', cron: '* * * * *' },
  { name: 'automation.liveness', cron: '* * * * *' },
  // The agent-lane and sandbox backstops (each its own entry so a throw in
  // one sweep can never disable another — the 0.4 isolation rationale).
  { name: 'governance.retention_cleanup', cron: '0 4 * * *' },
  { name: 'governance.effect_hold_releases', cron: '15 4 * * *' },
  { name: 'watchdog.task_agents', cron: '*/2 * * * *' },
  { name: 'watchdog.sandbox', cron: '*/5 * * * *' },
  { name: 'watchdog.chat_generations', cron: '*/2 * * * *' },
  // OneDrive folder/file mirrors refresh on a 15-minute cadence.
  { name: 'onedrive.sync_scan', cron: '*/15 * * * *' },
];

export async function registerSchedules(boss: PgBoss): Promise<void> {
  for (const schedule of SCHEDULES) {
    await boss.schedule(schedule.name, schedule.cron, undefined, {
      // One schedule per queue; tz pinned so day boundaries are stable.
      tz: 'Etc/UTC',
    });
  }
}
