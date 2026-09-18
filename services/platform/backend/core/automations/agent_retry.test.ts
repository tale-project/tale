// @vitest-environment node
/**
 * The auto-retry's continuation rule: a failed turn that announced its
 * conversation handle is RESUMED — the agent picks up where the cut landed —
 * while a turn that left nothing to continue (no handle, a gone session, a
 * start that never launched) is re-kicked fresh, as before.
 */
import { describe, expect, it } from 'vitest';

import {
  isWorkflowAgentRetryable,
  retryResumePrompt,
  workflowAgentRetryResume,
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
