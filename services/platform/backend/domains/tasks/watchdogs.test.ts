// @vitest-environment node

/**
 * The deadline sweep must stop the PROCESS, not only its ledger: failing an
 * overdue run while its sandbox exec keeps running leaked the exec's compute
 * until the agent gave up on its own (its gateway key revoked, it ground on
 * auth errors), and a Retry could then start a second exec against the same
 * standing workspace. The sweep cancels the exec — best-effort, before the
 * op row is settled — and an unreachable spawner never keeps the run alive.
 */

import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sessionCancelExec } from '../../core/node_only/sandbox/helpers/session_client.ts';
import { releaseProjectAgentSessionSlot } from '../sandbox/sessions.ts';
import {
  type AgentRunRow,
  failAgentRun,
  listOverdueAgentRuns,
  listParkedAgentRuns,
} from './agent-runs.ts';
import { runTaskAgentWatchdog } from './watchdogs.ts';

vi.mock('../../core/node_only/sandbox/helpers/session_client.ts', () => ({
  sessionCancelExec: vi.fn(),
}));
vi.mock('../sandbox/sessions.ts', () => ({
  releaseProjectAgentSessionSlot: vi.fn(() => Promise.resolve(true)),
}));
vi.mock('./agent-runs.ts', () => ({
  failAgentRun: vi.fn(),
  listOverdueAgentRuns: vi.fn(),
  listParkedAgentRuns: vi.fn(() => Promise.resolve([])),
  wakeParkedAgentRuns: vi.fn(() => Promise.resolve(0)),
}));

const overdueRun = {
  id: 'run-1',
  organizationId: 'org-1',
  agentId: 'agent-1',
  execId: 'exec-1',
  sessionId: 'pa-agent-1',
  status: 'running',
} as unknown as AgentRunRow;

/** A recorder `sql`: every statement lands in `events` in call order, next
 * to the exec cancels the mock records — the order IS the contract. */
function fakeSql(events: string[]): Sql {
  const fn = (strings: TemplateStringsArray): Promise<unknown[]> => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    events.push(`sql:${text.slice(0, 36)}`);
    return Promise.resolve([]);
  };
  return fn as unknown as Sql;
}

beforeEach(() => {
  vi.mocked(listOverdueAgentRuns).mockResolvedValue([overdueRun]);
  vi.mocked(listParkedAgentRuns).mockResolvedValue([]);
  vi.mocked(failAgentRun).mockResolvedValue(true);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('runTaskAgentWatchdog (deadline lane)', () => {
  it('cancels the sandbox exec of a deadline-failed run before settling its op row', async () => {
    const events: string[] = [];
    vi.mocked(sessionCancelExec).mockImplementation((sessionId, execId) => {
      events.push(`cancel:${sessionId}/${execId}`);
      return Promise.resolve(true);
    });

    const result = await runTaskAgentWatchdog(fakeSql(events));

    expect(result.failed).toBe(1);
    expect(sessionCancelExec).toHaveBeenCalledTimes(1);
    expect(sessionCancelExec).toHaveBeenCalledWith('pa-agent-1', 'exec-1');
    const cancelAt = events.indexOf('cancel:pa-agent-1/exec-1');
    const opSettleAt = events.findIndex((event) =>
      event.startsWith('sql:UPDATE app.sandbox_session_ops'),
    );
    expect(cancelAt).toBeGreaterThanOrEqual(0);
    expect(opSettleAt).toBeGreaterThan(cancelAt);
  });

  it('settles the run even when the spawner is unreachable', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(sessionCancelExec).mockRejectedValue(
      new TypeError('fetch failed'),
    );
    const events: string[] = [];

    const result = await runTaskAgentWatchdog(fakeSql(events));

    expect(result.failed).toBe(1);
    expect(
      events.some((event) =>
        event.startsWith('sql:UPDATE app.sandbox_session_ops'),
      ),
    ).toBe(true);
    // The slot is freed through the SAME release the host runs after a
    // settle — the seam that also wakes the org's parked runs.
    expect(releaseProjectAgentSessionSlot).toHaveBeenCalledWith(
      expect.anything(),
      { organizationId: 'org-1', agentId: 'agent-1' },
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('exec cancel failed for run run-1'),
      'fetch failed',
    );
  });

  it('leaves the exec alone when another settle already claimed the run', async () => {
    vi.mocked(failAgentRun).mockResolvedValue(false);
    const events: string[] = [];

    const result = await runTaskAgentWatchdog(fakeSql(events));

    expect(result.failed).toBe(0);
    expect(sessionCancelExec).not.toHaveBeenCalled();
  });
});
