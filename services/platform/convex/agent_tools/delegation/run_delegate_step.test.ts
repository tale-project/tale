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

describe('applyDelegationStrip (human-input gate strip)', () => {
  const withGate: SerializableAgentConfig = {
    name: 'researcher',
    instructions: 'research the sub-task',
    maxSteps: 40,
    convexToolNames: ['update_todos', 'request_human_input', 'web'],
  };

  it('removes request_human_input from a delegated run, even without stripping', () => {
    const out = applyDelegationStrip(withGate, undefined);
    expect(out.convexToolNames).toEqual(['update_todos', 'web']);
    // Re-delegation is NOT disabled when only the gate is stripped.
    expect(out.delegationDisabled).toBeUndefined();
  });

  it('strips both the gate and re-delegation when stripping', () => {
    const out = applyDelegationStrip(withGate, true);
    expect(out.convexToolNames).toEqual(['update_todos', 'web']);
    expect(out.delegationDisabled).toBe(true);
  });

  it('never mutates the input config', () => {
    applyDelegationStrip(withGate, true);
    expect(withGate.convexToolNames).toEqual([
      'update_todos',
      'request_human_input',
      'web',
    ]);
  });

  it('leaves a delegate without the gate untouched (same reference)', () => {
    const noGate: SerializableAgentConfig = {
      name: 'coder',
      instructions: 'write code',
      convexToolNames: ['web'],
    };
    expect(applyDelegationStrip(noGate, undefined)).toBe(noGate);
  });
});
