import { describe, expect, it } from 'vitest';

import {
  RESUME_CONTINUATION_PROMPT,
  shouldAttemptResumeRotation,
} from './resume_rotation';

describe('shouldAttemptResumeRotation', () => {
  const ok = {
    resuming: true,
    agentSessionId: 'sess_1',
    tokenPoolPresent: true,
  };

  it('fires only when all three preconditions hold', () => {
    expect(shouldAttemptResumeRotation(ok)).toBe(true);
  });

  it('does NOT fire on a fresh segment (the fresh path injects its own pick)', () => {
    expect(shouldAttemptResumeRotation({ ...ok, resuming: false })).toBe(false);
  });

  it('does NOT fire without a Claude session id (cannot spawn --resume)', () => {
    expect(
      shouldAttemptResumeRotation({ ...ok, agentSessionId: undefined }),
    ).toBe(false);
  });

  it('does NOT fire without a resolved token pool (nothing to rotate within)', () => {
    expect(
      shouldAttemptResumeRotation({ ...ok, tokenPoolPresent: false }),
    ).toBe(false);
  });
});

describe('RESUME_CONTINUATION_PROMPT', () => {
  it('forbids a restart and mandates the summary handoff', () => {
    expect(RESUME_CONTINUATION_PROMPT).toMatch(/do NOT restart/i);
    expect(RESUME_CONTINUATION_PROMPT).toContain('/agent/output/summary.md');
  });
});
