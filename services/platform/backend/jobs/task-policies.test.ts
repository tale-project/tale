// @vitest-environment node

/**
 * The at-most-once posture of the lanes that WALK or SPEND: pg-boss fails an
 * ACTIVE job whose handler is still running once its expiry lapses and, with
 * retries left, re-queues it while the first handler keeps going. For the
 * run walker that once meant a second live walker on the same run whenever
 * a node body outlasted the 30-minute expiry — double LLM spend, the first
 * walker's whole sub-run discarded as stale at its next commit. Recovery of
 * a lost walker is the liveness sweep's job; recovery of a lost agent turn
 * the watchdog's. Pinned so a "helpful" retry never comes back on these
 * lanes.
 */

import { describe, expect, it } from 'vitest';

import {
  queueGroupConcurrency,
  TASK_JOB_GROUP,
  TASK_QUEUE_OPTIONS,
  TASK_WORKER_SLOT_QUEUES,
} from './tasks.ts';

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

describe('agent turn drive windows', () => {
  it.each(['automation.agent_drive', 'task.agent_drive'] as const)(
    '%s carries a heartbeat, so a killed worker drive is re-attached within minutes, not after its expiry',
    (lane) => {
      const { heartbeatSeconds, expireInSeconds } = TASK_QUEUE_OPTIONS[lane];
      expect(heartbeatSeconds).toBe(60);
      expect(expireInSeconds).toBeGreaterThan(heartbeatSeconds ?? 0);
    },
  );
});

describe('automation steps', () => {
  // An organization's walking steps are counted from the ACTIVE jobs of its
  // group: a killed worker's step must stop counting within a minute or two,
  // not hold its organization's share until the six-hour expiry.
  it('carries a heartbeat well inside its expiry', () => {
    const { heartbeatSeconds, expireInSeconds } =
      TASK_QUEUE_OPTIONS['automation.step'];
    expect(heartbeatSeconds).toBe(30);
    expect(expireInSeconds).toBeGreaterThan(heartbeatSeconds ?? 0);
  });

  it('works in slots, one per job, so one long step holds no other run', () => {
    expect(TASK_WORKER_SLOT_QUEUES.has('automation.step')).toBe(true);
  });

  it('counts each step against the organization that owns its run', () => {
    expect(
      TASK_JOB_GROUP['automation.step']?.({
        organizationId: 'org-1',
        runId: 'run-1',
      }),
    ).toBe('org-1');
  });

  it('is the only queue limited per organization, and only while the limit is on', () => {
    expect(
      queueGroupConcurrency('automation.step', { automationOrgConcurrency: 8 }),
    ).toBe(8);
    expect(
      queueGroupConcurrency('automation.step', { automationOrgConcurrency: 0 }),
    ).toBeUndefined();
    expect(queueGroupConcurrency('automation.step', {})).toBeUndefined();
    for (const name of Object.keys(TASK_QUEUE_OPTIONS)) {
      if (name === 'automation.step') continue;
      expect(
        queueGroupConcurrency(name, { automationOrgConcurrency: 8 }),
      ).toBeUndefined();
    }
  });

  // Every enqueue of a grouped queue derives its group in `addJobInTx`, so
  // a queue with a group rule must also be one the worker limits — a rule
  // nothing reads would tag jobs for no reason.
  it('has a group rule exactly where the worker sets a limit', () => {
    const grouped = Object.keys(TASK_JOB_GROUP).sort();
    const limited = Object.keys(TASK_QUEUE_OPTIONS)
      .filter(
        (name) =>
          queueGroupConcurrency(name, { automationOrgConcurrency: 1 }) !==
          undefined,
      )
      .sort();
    expect(grouped).toEqual(limited);
  });
});
