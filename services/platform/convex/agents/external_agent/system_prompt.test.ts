import { describe, expect, it } from 'vitest';

import {
  buildSystemPromptAppend,
  PLAN_MODE_ADDENDUM,
  STEERING_RESPONSIVENESS_ADDENDUM,
} from './system_prompt';

describe('buildSystemPromptAppend', () => {
  it('act turns get the steering-responsiveness addendum, not the plan addendum', () => {
    const out = buildSystemPromptAppend({
      systemInstructions: 'AGENT RULES',
      permissionMode: 'execute',
    });
    expect(out).toContain(STEERING_RESPONSIVENESS_ADDENDUM);
    expect(out).toContain('run_in_background');
    expect(out).not.toContain(PLAN_MODE_ADDENDUM);
    // Composed with the agent's own instructions, first and never clobbered.
    expect(out.startsWith('AGENT RULES')).toBe(true);
  });

  it('plan turns get the plan addendum, not the steering addendum', () => {
    const out = buildSystemPromptAppend({
      systemInstructions: 'AGENT RULES',
      permissionMode: 'plan',
    });
    expect(out).toContain(PLAN_MODE_ADDENDUM);
    expect(out).not.toContain(STEERING_RESPONSIVENESS_ADDENDUM);
  });

  it('drops missing instructions without a leading blank line', () => {
    const out = buildSystemPromptAppend({ permissionMode: 'execute' });
    expect(out.startsWith(STEERING_RESPONSIVENESS_ADDENDUM)).toBe(true);
  });

  it('an undefined permissionMode is treated as an act turn', () => {
    const out = buildSystemPromptAppend({ systemInstructions: 'X' });
    expect(out).toContain(STEERING_RESPONSIVENESS_ADDENDUM);
    expect(out).not.toContain(PLAN_MODE_ADDENDUM);
  });
});
