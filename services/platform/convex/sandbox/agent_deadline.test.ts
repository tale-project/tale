import { afterEach, describe, expect, it, vi } from 'vitest';

import { agentWorkTurnDeadlineMs } from './agent_deadline';

describe('agentWorkTurnDeadlineMs', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('defaults to twelve hours — a work turn may run all day', () => {
    vi.stubEnv('TALE_AUTOMATION_AGENT_DEADLINE_MS', '');
    expect(agentWorkTurnDeadlineMs()).toBe(12 * 3_600_000);
  });

  it('honours the env override', () => {
    vi.stubEnv('TALE_AUTOMATION_AGENT_DEADLINE_MS', '60000');
    expect(agentWorkTurnDeadlineMs()).toBe(60_000);
  });

  it('ignores a non-numeric or non-positive override', () => {
    vi.stubEnv('TALE_AUTOMATION_AGENT_DEADLINE_MS', 'soon');
    expect(agentWorkTurnDeadlineMs()).toBe(12 * 3_600_000);
    vi.stubEnv('TALE_AUTOMATION_AGENT_DEADLINE_MS', '0');
    expect(agentWorkTurnDeadlineMs()).toBe(12 * 3_600_000);
  });
});
