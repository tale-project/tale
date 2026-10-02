// @vitest-environment node
/**
 * The auto-retry's continuation rule: a failed turn that announced its
 * conversation handle is RESUMED — the agent picks up where the cut landed —
 * while a turn that left nothing to continue (no handle, a gone session, a
 * start that never launched) is re-kicked fresh, as before.
 */
import { describe, expect, it } from 'vitest';

import {
  AUTO_RETRY_MAX_ATTEMPTS,
  CREDENTIAL_ROTATION_FREE_RETRIES,
} from '../tasks/task_auto_retry';
import {
  SANDBOX_ROOM_MAX_WAIT_MS,
  SANDBOX_ROOM_RETRY_CEILING_MS,
  isWorkflowAgentRetryable,
  planWorkflowAgentRetry,
  retryResumePrompt,
  sandboxRoomRetryAtMs,
  workflowAgentRetryResume,
  type WorkflowAgentAttempt,
} from './agent_retry';

/** Every harness but Gemini CLI continues its conversations. */
const RESUMES = { resumable: true };

describe('workflowAgentRetryResume', () => {
  it('continues the failed conversation when the harness left a handle', () => {
    expect(
      workflowAgentRetryResume(
        { failureCode: 'harness_error', agentSessionId: 'conv-1' },
        'the agent turn failed: API Error: 502',
        {},
        RESUMES,
      ),
    ).toEqual({
      agentSessionId: 'conv-1',
      reason: 'the agent turn failed: API Error: 502',
    });
    // A settle from before the failure code existed still resumes.
    expect(
      workflowAgentRetryResume(
        { agentSessionId: 'conv-1' },
        'crashed',
        {},
        RESUMES,
      ),
    ).toEqual({ agentSessionId: 'conv-1', reason: 'crashed' });
  });

  it('starts fresh when there is no conversation to continue', () => {
    expect(
      workflowAgentRetryResume(
        { failureCode: 'harness_error' },
        'no handle',
        {},
        RESUMES,
      ),
    ).toBeUndefined();
    for (const failureCode of [
      'session_gone',
      'start_failed',
      'credential_cooldown',
    ]) {
      expect(
        workflowAgentRetryResume(
          { failureCode, agentSessionId: 'conv-1' },
          'gone',
          {},
          RESUMES,
        ),
      ).toBeUndefined();
      // Both stay retryable — fresh, not abandoned.
      expect(isWorkflowAgentRetryable(failureCode)).toBe(true);
    }
  });
});

describe('workflowAgentRetryResume on a harness that never resumes', () => {
  it('starts fresh even with a handle, a plain cut, and a cooled-down resume to pick up', () => {
    // Gemini CLI: `capabilities.resume: false` — its `--resume` replays every
    // tool result twice, so the conversation it names cannot be continued.
    const gemini = { resumable: false };
    expect(
      workflowAgentRetryResume(
        { failureCode: 'harness_error', agentSessionId: 'conv-1' },
        'the agent turn failed: API Error: 502',
        {},
        gemini,
      ),
    ).toBeUndefined();
    expect(
      workflowAgentRetryResume(
        { failureCode: 'credential_cooldown' },
        'refused',
        { resumedFrom: 'conv-1', resumeReason: 'cut' },
        gemini,
      ),
    ).toBeUndefined();
    // Still retryable — fresh, not abandoned.
    expect(isWorkflowAgentRetryable('harness_error')).toBe(true);
  });
});

describe('workflowAgentRetryResume after a start the cooling pool refused', () => {
  it('resumes the conversation the refused attempt was to resume, with the cut that ended it', () => {
    // A 429 cut `conv-1`; the retry that was to resume it was refused while
    // the pool cooled down, and never launched.
    expect(
      workflowAgentRetryResume(
        { failureCode: 'credential_cooldown' },
        'the agent turn could not start: every account is cooling down',
        {
          resumedFrom: 'conv-1',
          resumeReason: 'the agent turn failed: API Error: 429',
        },
        RESUMES,
      ),
    ).toEqual({
      agentSessionId: 'conv-1',
      reason: 'the agent turn failed: API Error: 429',
    });
    // Nothing was to be resumed: still fresh.
    expect(
      workflowAgentRetryResume(
        { failureCode: 'credential_cooldown' },
        'refused',
        {},
        RESUMES,
      ),
    ).toBeUndefined();
    // Any other start failure keeps its fresh re-kick: the session itself
    // may be what failed.
    expect(
      workflowAgentRetryResume(
        { failureCode: 'start_failed' },
        'refused',
        {
          resumedFrom: 'conv-1',
        },
        RESUMES,
      ),
    ).toBeUndefined();
  });
});

describe('retryResumePrompt', () => {
  it('names the cut as the platform’s and tells the agent to carry on, never repeating the node prompt', () => {
    const prompt = retryResumePrompt('the agent turn failed: API Error: 502');
    expect(prompt).toContain('infrastructure failure');
    expect(prompt).toContain('the agent turn failed: API Error: 502');
    expect(prompt).toContain('Continue the task from where you left off');
    expect(prompt).toContain('do not redo work that is already done');
  });
});

describe('planWorkflowAgentRetry', () => {
  const NOW = 10 * 60 * 60_000;
  /** An attempt that ran one minute before it failed. */
  const SHORT = NOW - 60_000;
  /** One that worked past the progress threshold first. */
  const LONG = NOW - 20 * 60_000;

  it('counts an ordinary failure and burns its broker account', () => {
    expect(
      planWorkflowAgentRetry(
        {
          attempt: 1,
          launchedAt: SHORT,
          brokerTokenHash: 'account-b',
          burnedBrokerTokenHashes: ['account-a'],
        },
        'harness_error',
        NOW,
      ),
    ).toEqual({
      retry: true,
      attempt: 2,
      burnedBrokerTokenHashes: ['account-a', 'account-b'],
      credentialRotations: 0,
    });
    expect(
      planWorkflowAgentRetry(
        { attempt: AUTO_RETRY_MAX_ATTEMPTS, launchedAt: SHORT },
        'harness_error',
        NOW,
      ).retry,
    ).toBe(false);
    // Progress refreshes the budget.
    expect(
      planWorkflowAgentRetry(
        { attempt: AUTO_RETRY_MAX_ATTEMPTS, launchedAt: LONG },
        'harness_error',
        NOW,
      ),
    ).toMatchObject({ retry: true, attempt: 1 });
  });

  it('resumes a credential rotation for free: same attempt, account kept in the pool', () => {
    // Observed live (2026-09-28): the broker refreshed every account at
    // once and the turn's token was revoked mid-work.
    expect(
      planWorkflowAgentRetry(
        {
          attempt: AUTO_RETRY_MAX_ATTEMPTS,
          launchedAt: SHORT,
          brokerTokenHash: 'account-b',
          burnedBrokerTokenHashes: ['account-a'],
        },
        'credential_rotated',
        NOW,
      ),
    ).toEqual({
      retry: true,
      attempt: AUTO_RETRY_MAX_ATTEMPTS,
      burnedBrokerTokenHashes: ['account-a'],
      credentialRotations: 1,
    });
  });

  it('takes the third short rotation in a row down the ordinary path, so a dead grant ends', () => {
    let parked: WorkflowAgentAttempt = {
      launchedAt: SHORT,
      brokerTokenHash: 'account-a',
    };
    const plans = [];
    for (;;) {
      const plan = planWorkflowAgentRetry(parked, 'credential_rotated', NOW);
      plans.push(plan);
      if (!plan.retry) break;
      parked = {
        attempt: plan.attempt,
        launchedAt: SHORT,
        brokerTokenHash: 'account-a',
        burnedBrokerTokenHashes: plan.burnedBrokerTokenHashes,
        credentialRotations: plan.credentialRotations,
      };
    }
    // Two free re-kicks, then the budget's three, then the stop.
    expect(plans).toHaveLength(
      CREDENTIAL_ROTATION_FREE_RETRIES + AUTO_RETRY_MAX_ATTEMPTS + 1,
    );
    expect(plans.map((plan) => plan.attempt)).toEqual([0, 0, 1, 2, 3, 4]);
    expect(plans[1]?.burnedBrokerTokenHashes).toEqual([]);
    expect(plans[2]?.burnedBrokerTokenHashes).toEqual(['account-a']);
  });

  it('restores the ordinary retry allowance when a free rotation follows sustained work', () => {
    const rotated = planWorkflowAgentRetry(
      { attempt: AUTO_RETRY_MAX_ATTEMPTS, launchedAt: LONG },
      'credential_rotated',
      NOW,
    );
    let parked: WorkflowAgentAttempt = {
      ...rotated,
      launchedAt: SHORT,
    };
    const retries = [];
    for (let index = 0; index <= AUTO_RETRY_MAX_ATTEMPTS; index += 1) {
      const plan = planWorkflowAgentRetry(parked, 'harness_error', NOW);
      retries.push(plan.retry);
      parked = { ...plan, launchedAt: SHORT };
    }
    expect(retries).toEqual([true, true, true, false]);
  });

  it('waits for sandbox room for free, however many attempts are spent', () => {
    expect(isWorkflowAgentRetryable('sandbox_capacity')).toBe(true);
    expect(
      planWorkflowAgentRetry(
        { attempt: AUTO_RETRY_MAX_ATTEMPTS, burnedBrokerTokenHashes: ['a'] },
        'sandbox_capacity',
        NOW,
      ),
    ).toEqual({
      retry: true,
      attempt: AUTO_RETRY_MAX_ATTEMPTS,
      burnedBrokerTokenHashes: ['a'],
      credentialRotations: 0,
      waitingForRoomSince: NOW,
      roomRefusals: 1,
    });
    // The wait keeps its start, and ends after two hours of it.
    expect(
      planWorkflowAgentRetry(
        { waitingForRoomSince: NOW - 60_000 },
        'sandbox_capacity',
        NOW,
      ),
    ).toMatchObject({ retry: true, waitingForRoomSince: NOW - 60_000 });
    expect(
      planWorkflowAgentRetry(
        { waitingForRoomSince: NOW - SANDBOX_ROOM_MAX_WAIT_MS },
        'sandbox_capacity',
        NOW,
      ).retry,
    ).toBe(false);
    // Nothing launched: the conversation it was to resume still stands.
    expect(
      workflowAgentRetryResume(
        { failureCode: 'sandbox_capacity' },
        'waiting for room',
        { resumedFrom: 'conv-7', resumeReason: 'the stream broke' },
        RESUMES,
      ),
    ).toEqual({ agentSessionId: 'conv-7', reason: 'the stream broke' });
    expect(
      workflowAgentRetryResume(
        { failureCode: 'sandbox_capacity', agentSessionId: 'conv-new' },
        'waiting for room',
        {},
        RESUMES,
      ),
    ).toBeUndefined();
  });

  it('counts the refusals of a room wait in a row, and starts the count with a new wait', () => {
    expect(
      planWorkflowAgentRetry(
        { waitingForRoomSince: NOW - 60_000, roomRefusals: 3 },
        'sandbox_capacity',
        NOW,
      ).roomRefusals,
    ).toBe(4);
    // A refusal count without a wait it belongs to starts over.
    expect(
      planWorkflowAgentRetry({ roomRefusals: 3 }, 'sandbox_capacity', NOW)
        .roomRefusals,
    ).toBe(1);
    // Any other failure ends the wait.
    expect(
      planWorkflowAgentRetry(
        { waitingForRoomSince: NOW - 60_000, roomRefusals: 3 },
        'harness_error',
        NOW,
      ).roomRefusals,
    ).toBeUndefined();
  });

  it('waits out the cooldown of the 429 it retried for free, and counts any other refused start', () => {
    expect(
      planWorkflowAgentRetry(
        {
          attempt: 2,
          retriedRateLimit: true,
          burnedBrokerTokenHashes: ['account-a'],
        },
        'credential_cooldown',
        NOW,
      ),
    ).toEqual({
      retry: true,
      attempt: 2,
      burnedBrokerTokenHashes: ['account-a'],
      credentialRotations: 0,
    });
    // The budget is spent: the wait is still free, as the 429 counted.
    expect(
      planWorkflowAgentRetry(
        { attempt: AUTO_RETRY_MAX_ATTEMPTS, retriedRateLimit: true },
        'credential_cooldown',
        NOW,
      ),
    ).toMatchObject({ retry: true, attempt: AUTO_RETRY_MAX_ATTEMPTS });
    // Another run cooled the pool, or it is still cooling after a wait.
    expect(
      planWorkflowAgentRetry({ attempt: 2 }, 'credential_cooldown', NOW),
    ).toMatchObject({ retry: true, attempt: 3 });
    expect(
      planWorkflowAgentRetry(
        { attempt: AUTO_RETRY_MAX_ATTEMPTS },
        'credential_cooldown',
        NOW,
      ).retry,
    ).toBe(false);
  });

  it('starts a new rotation streak after progress or any other failure', () => {
    // Two hours of work, then the broker's refresh: the progress refreshes
    // the budget and the free re-kick spends none of it — never worse than
    // the same attempt failing any other way (which parks under attempt 1).
    expect(
      planWorkflowAgentRetry(
        {
          attempt: AUTO_RETRY_MAX_ATTEMPTS,
          launchedAt: LONG,
          credentialRotations: CREDENTIAL_ROTATION_FREE_RETRIES,
        },
        'credential_rotated',
        NOW,
      ),
    ).toMatchObject({ retry: true, attempt: 0, credentialRotations: 1 });
    expect(
      planWorkflowAgentRetry(
        {
          attempt: 1,
          launchedAt: SHORT,
          credentialRotations: CREDENTIAL_ROTATION_FREE_RETRIES,
        },
        'harness_error',
        NOW,
      ),
    ).toMatchObject({ attempt: 2, credentialRotations: 0 });
  });
});

describe('sandboxRoomRetryAtMs', () => {
  const NOW = 1_800_000_000_000;
  const at = (refusals: number, draw: number, retryAfterMs = 10_000) =>
    sandboxRoomRetryAtMs({
      now: NOW,
      retryAfterMs,
      refusals,
      random: () => draw,
    }) - NOW;

  it('never starts before the refusal’s retry hint', () => {
    for (const refusals of [1, 2, 5, 40]) expect(at(refusals, 0)).toBe(10_000);
  });

  it('draws from a window that doubles with each refusal in a row, up to the ceiling', () => {
    expect([1, 2, 3, 4, 5, 40].map((refusals) => at(refusals, 1))).toEqual([
      20_000,
      40_000,
      80_000,
      SANDBOX_ROOM_RETRY_CEILING_MS,
      SANDBOX_ROOM_RETRY_CEILING_MS,
      SANDBOX_ROOM_RETRY_CEILING_MS,
    ]);
    // Waiters refused together spread across the window.
    expect(at(3, 0.5)).toBe(45_000);
  });

  it('holds a hint past the ceiling to the ceiling, and a missing one to now', () => {
    expect(at(1, 1, 10 * 60_000)).toBe(SANDBOX_ROOM_RETRY_CEILING_MS);
    expect(at(3, 1, 0)).toBe(0);
  });
});
