import { describe, expect, it } from 'vitest';

import { idleReason } from './dispatch-readback.ts';

describe('the readback says why an idle agent of the pool is idle [TASK-R46]', () => {
  it('names a switched-off dispatch first, then the model the agent waits on', () => {
    expect(
      idleReason({ enabled: false, heldUntil: 5, lastStopReason: 'started' }),
    ).toBe('disabled');
    expect(
      idleReason({ enabled: true, heldUntil: 5, lastStopReason: 'started' }),
    ).toBe('model_capacity');
  });

  it('otherwise reads the last pass: a held host, full agent workers, a paced start, nothing ready', () => {
    const reasonAfter = (lastStopReason: string | null) =>
      idleReason({ enabled: true, heldUntil: null, lastStopReason });
    expect(reasonAfter('host_pressure')).toBe('host_pressure');
    expect(reasonAfter('org_limit')).toBe('org_limit');
    expect(reasonAfter('pacing')).toBe('pacing');
    expect(reasonAfter('automation_disabled')).toBe('disabled');
    expect(reasonAfter('no_ready_work')).toBe('no_ready_work');
    expect(reasonAfter('agents_busy')).toBe('no_ready_work');
    expect(reasonAfter(null)).toBe('unknown');
  });
});
