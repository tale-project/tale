import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  agentWorkTurnDeadlineMs,
  sessionOpLastSignOfLifeMs,
} from './agent_deadline';

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

describe('sessionOpLastSignOfLifeMs', () => {
  it('takes the freshest signal across all phases', () => {
    expect(
      sessionOpLastSignOfLifeMs({
        startedAt: 1_000,
        heartbeatAt: 5_000,
        finalizedAt: 7_000,
        finishedAt: 6_000,
      }),
    ).toBe(7_000);
  });

  it('floors at the op’s own birth when no other signal exists', () => {
    expect(sessionOpLastSignOfLifeMs({ startedAt: 1_000 })).toBe(1_000);
  });

  it('a lone drain heartbeat governs while the settle has not signed', () => {
    expect(
      sessionOpLastSignOfLifeMs({ startedAt: 1_000, heartbeatAt: 4_000 }),
    ).toBe(4_000);
  });
});
