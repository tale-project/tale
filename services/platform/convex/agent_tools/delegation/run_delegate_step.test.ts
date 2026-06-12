import { describe, expect, it } from 'vitest';

import type { SerializableAgentConfig } from '../../lib/agent_chat/types';
import { applyDelegationStrip } from './run_delegate_step';

const base: SerializableAgentConfig = {
  name: 'specialist',
  instructions: 'answer the sub-task',
  maxSteps: 5,
};

describe('applyDelegationStrip (double-delegation guard)', () => {
  it('sets delegationDisabled when stripping', () => {
    const out = applyDelegationStrip(base, true);
    expect(out.delegationDisabled).toBe(true);
    // Other config is preserved.
    expect(out.name).toBe('specialist');
    expect(out.maxSteps).toBe(5);
  });

  it('never mutates the input config', () => {
    applyDelegationStrip(base, true);
    expect(base.delegationDisabled).toBeUndefined();
  });

  it('returns the config unchanged when not stripping', () => {
    expect(applyDelegationStrip(base, false)).toBe(base);
    expect(applyDelegationStrip(base, undefined)).toBe(base);
  });
});
