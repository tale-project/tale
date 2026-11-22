import { describe, expect, it } from 'vitest';

import {
  agentHarnessReason,
  HARNESS_REASONS,
  isHarnessReason,
} from './harness-reason';

describe('agentHarnessReason', () => {
  it('keeps a runtime the agent, the step or the policy names', () => {
    expect(agentHarnessReason('pinned', 'subscription')).toBe('pinned');
    expect(agentHarnessReason('pinned', 'gateway')).toBe('pinned');
    expect(agentHarnessReason('policy', 'subscription')).toBe('policy');
  });

  it('tells a subscription’s bound runtime from the default when nothing named one', () => {
    expect(agentHarnessReason('automatic', 'subscription')).toBe(
      'subscription_bound',
    );
    expect(agentHarnessReason('automatic', 'gateway')).toBe('default');
  });
});

describe('isHarnessReason', () => {
  it('knows the four reasons the migration admits, and nothing else', () => {
    expect(HARNESS_REASONS).toEqual([
      'pinned',
      'default',
      'subscription_bound',
      'policy',
    ]);
    for (const reason of HARNESS_REASONS) {
      expect(isHarnessReason(reason)).toBe(true);
    }
    expect(isHarnessReason('subscription-bound')).toBe(false);
    expect(isHarnessReason(null)).toBe(false);
  });
});
