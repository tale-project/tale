// @vitest-environment node

/**
 * The at-most-once posture of the lanes that WALK or SPEND: pg-boss fails an
 * ACTIVE job whose handler is still running once its expiry lapses and, with
 * retries left, re-queues it while the first handler keeps going. For the
 * run walker that meant a second live walker on the same run (claimRun
 * re-claims a 'running' row unconditionally) whenever a node body outlasted
 * the 30-minute expiry — double LLM spend, the first walker's whole sub-run
 * discarded as stale at its next commit. Recovery of a lost walker is the
 * liveness sweep's job; recovery of a lost agent turn the watchdog's. Pinned
 * so a "helpful" retry never comes back on these lanes.
 */

import { describe, expect, it } from 'vitest';

import { TASK_QUEUE_OPTIONS } from './tasks.ts';

describe('run-walker and turn lanes never retry through pg-boss', () => {
  it.each([
    'automation.step',
    'automation.agent_turn',
    'automation.agent_drive',
    'task.agent_turn',
  ] as const)('%s', (lane) => {
    expect(TASK_QUEUE_OPTIONS[lane].retryLimit).toBe(0);
  });

  it('gives the walker an expiry that outlasts any single node body', () => {
    // An inline subautomation under repeatUntil can legitimately run for
    // hours; the expiry must never lapse under a walker that is still
    // heartbeating its run.
    expect(
      TASK_QUEUE_OPTIONS['automation.step'].expireInSeconds,
    ).toBeGreaterThanOrEqual(6 * 3600);
  });
});
