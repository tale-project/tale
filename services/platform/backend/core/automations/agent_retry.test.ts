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
  isWorkflowAgentRetryable,
  planWorkflowAgentRetry,
  retryResumePrompt,
  workflowAgentRetryResume,
  type WorkflowAgentAttempt,
} from './agent_retry';

describe('workflowAgentRetryResume', () => {
  it('continues the failed conversation when the harness left a handle', () => {
    expect(
      workflowAgentRetryResume(
        { failureCode: 'harness_error', agentSessionId: 'conv-1' },
        'the agent turn failed: API Error: 502',
      ),
    ).toEqual({
      agentSessionId: 'conv-1',
      reason: 'the agent turn failed: API Error: 502',
    });
    // A settle from before the failure code existed still resumes.
    expect(
      workflowAgentRetryResume({ agentSessionId: 'conv-1' }, 'crashed'),
    ).toEqual({ agentSessionId: 'conv-1', reason: 'crashed' });
  });

  it('starts fresh when there is no conversation to continue', () => {
    expect(
      workflowAgentRetryResume({ failureCode: 'harness_error' }, 'no handle'),
    ).toBeUndefined();
    for (const failureCode of ['session_gone', 'start_failed']) {
      expect(
        workflowAgentRetryResume(
          { failureCode, agentSessionId: 'conv-1' },
          'gone',
        ),
      ).toBeUndefined();
      // Both stay retryable — fresh, not abandoned.
      expect(isWorkflowAgentRetryable(failureCode)).toBe(true);
    }
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

  it('starts a new rotation streak after progress or any other failure', () => {
    expect(
      planWorkflowAgentRetry(
        {
          attempt: 2,
          launchedAt: LONG,
          credentialRotations: CREDENTIAL_ROTATION_FREE_RETRIES,
        },
        'credential_rotated',
        NOW,
      ),
    ).toMatchObject({ retry: true, attempt: 2, credentialRotations: 1 });
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
