import { describe, expect, it } from 'vitest';

import type { SerializableAgentConfig } from '../../lib/agent_chat/types';
import { applyDelegationStrip } from './run_delegate_step';

const base: SerializableAgentConfig = {
  name: 'specialist',
  instructions: 'answer the sub-task',
  delegateSlugs: ['other-agent', 'third-agent'],
  maxSteps: 5,
};

describe('applyDelegationStrip (double-delegation guard)', () => {
  it('clears delegateSlugs when stripping', () => {
    const out = applyDelegationStrip(base, true);
    expect(out.delegateSlugs).toEqual([]);
    // Other config is preserved.
    expect(out.name).toBe('specialist');
    expect(out.maxSteps).toBe(5);
  });

  it('never mutates the input config', () => {
    applyDelegationStrip(base, true);
    expect(base.delegateSlugs).toEqual(['other-agent', 'third-agent']);
  });

  it('returns the config unchanged when not stripping', () => {
    expect(applyDelegationStrip(base, false)).toBe(base);
    expect(applyDelegationStrip(base, undefined)).toBe(base);
  });
});
