import { describe, expect, it } from 'vitest';

import { DEFAULT_HARNESS } from './harness-offer';
import {
  agentHarnessReason,
  HARNESS_REASONS,
  isHarnessReason,
} from './harness-reason';

describe('agentHarnessReason', () => {
  it('keeps a runtime the agent, the step or the policy names', () => {
    expect(
      agentHarnessReason('pinned', {
        harness: 'claude-code',
        lane: 'subscription',
      }),
    ).toBe('pinned');
    expect(
      agentHarnessReason('pinned', { harness: 'pi', lane: 'gateway' }),
    ).toBe('pinned');
    expect(
      agentHarnessReason('policy', { harness: 'codex', lane: 'gateway' }),
    ).toBe('policy');
  });

  it('tells a subscription’s bound runtime from the default when nothing named one', () => {
    expect(
      agentHarnessReason('automatic', {
        harness: 'claude-code',
        lane: 'subscription',
      }),
    ).toBe('subscription_bound');
    expect(
      agentHarnessReason('automatic', {
        harness: DEFAULT_HARNESS,
        lane: 'gateway',
      }),
    ).toBe('default');
  });

  it('calls a runtime the default only when it is the default', () => {
    // A model only Codex runs (its tools need the Responses API), chosen
    // while nothing named a runtime: not the default, and no subscription.
    expect(
      agentHarnessReason('automatic', { harness: 'codex', lane: 'gateway' }),
    ).toBe('model_bound');
    // Claude Code, the default before Pi, is not the default now.
    expect(
      agentHarnessReason('automatic', {
        harness: 'claude-code',
        lane: 'gateway',
      }),
    ).toBe('model_bound');
    expect(DEFAULT_HARNESS).toBe('pi');
  });
});

describe('isHarnessReason', () => {
  it('knows the five reasons the migrations admit, and nothing else', () => {
    expect(HARNESS_REASONS).toEqual([
      'pinned',
      'default',
      'subscription_bound',
      'policy',
      'model_bound',
    ]);
    for (const reason of HARNESS_REASONS) {
      expect(isHarnessReason(reason)).toBe(true);
    }
    expect(isHarnessReason('subscription-bound')).toBe(false);
    expect(isHarnessReason(null)).toBe(false);
  });
});
