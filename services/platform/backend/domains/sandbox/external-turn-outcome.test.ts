import { describe, expect, it } from 'vitest';

import { classifyOutcome } from './external-turn-outcome.ts';

describe('classifyOutcome', () => {
  it('reads the harness outcome, falling back to the op status', () => {
    expect(classifyOutcome('completed', 'failed')).toBe('completed');
    expect(classifyOutcome(null, 'cancelled')).toBe('cancelled');
    expect(classifyOutcome('timeout', 'failed')).toBe('timeout');
    expect(classifyOutcome('error', 'failed')).toBe('failed');
    expect(classifyOutcome(null, 'failed')).toBe('failed');
  });

  it('counts no outcome for a turn parked on a question or a start waiting for sandbox room', () => {
    expect(classifyOutcome('awaiting_human', 'running')).toBe('parked');
    // Each re-kick of an automation step waiting for room settles its op
    // `failed`; read as a failed harness turn it would flood the metrics.
    expect(classifyOutcome('awaiting_room', 'failed')).toBe('parked');
  });
});
