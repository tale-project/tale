/**
 * Helper function to determine if a workflow should be triggered now based on its cron and timezone.
 * Uses cron-parser to compute the previous scheduled time relative to "now".
 * We trigger exactly once per scheduled minute if lastExecution < previousScheduledTime.
 */

import CronExpressionParser from 'cron-parser';

export async function shouldTriggerWorkflow(
  schedule: string,
  timezone: string,
  lastExecutionMs: number | null,
): Promise<boolean> {
  try {
    if (!schedule) return false;

    const now = new Date();
    const iterator = CronExpressionParser.parse(schedule, {
      currentDate: now,
      tz: timezone || 'UTC',
    });

    const prevDate = iterator.prev().toDate();
    const prevMs = prevDate.getTime();
    const delta = now.getTime() - prevMs;

    // Only trigger if we're within the scheduled minute window
    if (delta < 0 || delta >= 60_000) return false;

    // Deduplicate: if we've already executed at/after this scheduled time, skip
    if (typeof lastExecutionMs === 'number' && lastExecutionMs >= prevMs) {
      return false;
    }

    return true;
  } catch (error) {
    console.error(
      `Error evaluating schedule '${schedule}' (tz=${timezone}):`,
      error,
    );
    return false;
  }
}
