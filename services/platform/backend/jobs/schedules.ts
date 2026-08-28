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
];

export async function registerSchedules(boss: PgBoss): Promise<void> {
  for (const schedule of SCHEDULES) {
    await boss.schedule(schedule.name, schedule.cron, undefined, {
      // One schedule per queue; tz pinned so day boundaries are stable.
      tz: 'Etc/UTC',
    });
  }
}
