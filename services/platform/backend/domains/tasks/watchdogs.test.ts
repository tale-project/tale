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
  listParkedAgentRunOrganizations,
  wakeOrganizationParkedAgentRun,
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
  listParkedAgentRunOrganizations: vi.fn(() => Promise.resolve([])),
  wakeOrganizationParkedAgentRun: vi.fn(() => Promise.resolve(0)),
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
function fakeSql(
  events: string[],
  orphaned: Array<{ organizationId: string; agentId: string }> = [],
): Sql {
  const fn = (strings: TemplateStringsArray): Promise<unknown[]> => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    events.push(`sql:${text.slice(0, 36)}`);
    // The orphan backstop's read is the only SELECT answered with rows.
    return Promise.resolve(text.startsWith('SELECT DISTINCT') ? orphaned : []);
  };
  return fn as unknown as Sql;
}

beforeEach(() => {
  vi.mocked(listOverdueAgentRuns).mockResolvedValue([overdueRun]);
  vi.mocked(listParkedAgentRunOrganizations).mockResolvedValue([]);
  vi.mocked(failAgentRun).mockResolvedValue(true);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('runTaskAgentWatchdog (parked runs)', () => {
  it('wakes up to four parked runs per organization a tick, stopping when none is left', async () => {
    vi.mocked(listOverdueAgentRuns).mockResolvedValue([]);
    vi.mocked(listParkedAgentRunOrganizations).mockResolvedValue([
      { organizationId: 'org-busy' },
      { organizationId: 'org-quiet' },
    ]);
    const remaining = new Map([
      ['org-busy', 6],
      ['org-quiet', 1],
    ]);
    vi.mocked(wakeOrganizationParkedAgentRun).mockImplementation(
      async (_sql, org) => {
        const left = remaining.get(org) ?? 0;
        if (left === 0) return 0;
        remaining.set(org, left - 1);
        return 1;
      },
    );

    const result = await runTaskAgentWatchdog(fakeSql([]));

    expect(result.woken).toBe(5);
    expect(remaining.get('org-busy')).toBe(2);
    expect(remaining.get('org-quiet')).toBe(0);
  });
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
    // Failed as what it is, so the task says "time limit", not "failed".
    expect(failAgentRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ runId: 'run-1', failureCode: 'deadline' }),
    );
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

describe('runTaskAgentWatchdog (parked lane)', () => {
  it('fails a run that waited for capacity past its deadline as a capacity failure', async () => {
    vi.mocked(listOverdueAgentRuns).mockResolvedValue([]);
    const parked = { id: 'run-parked', organizationId: 'org-1', execId: 'e-2' };
    const sql = ((strings: TemplateStringsArray) => {
      const text = strings.join('?').replace(/\s+/g, ' ').trim();
      return Promise.resolve(
        text.includes('waiting_for_capacity_at_ms IS NOT NULL') ? [parked] : [],
      );
    }) as unknown as Sql;

    const result = await runTaskAgentWatchdog(sql);

    expect(result.failed).toBe(1);
    expect(failAgentRun).toHaveBeenCalledWith(sql, {
      organizationId: 'org-1',
      runId: 'run-parked',
      execId: 'e-2',
      error:
        'the agent run waited for sandbox capacity past its time limit and was stopped',
      failureCode: 'park_deadline',
    });
  });
});

describe('runTaskAgentWatchdog (orphan backstop)', () => {
  it('releases a standing session that no live turn holds any more', async () => {
    // A settle deferred its release to a queued sibling that then died
    // before it started: nothing else ever frees the agent's slot.
    vi.mocked(listOverdueAgentRuns).mockResolvedValue([]);
    const events: string[] = [];

    const result = await runTaskAgentWatchdog(
      fakeSql(events, [{ organizationId: 'org-1', agentId: 'agent-9' }]),
    );

    expect(result.released).toBe(1);
    expect(releaseProjectAgentSessionSlot).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      { organizationId: 'org-1', agentId: 'agent-9' },
    );
    const read = events.find((event) =>
      event.startsWith('sql:SELECT DISTINCT'),
    );
    expect(read).toBeDefined();
  });

  it('counts nothing when every standing session still has a live owner', async () => {
    vi.mocked(listOverdueAgentRuns).mockResolvedValue([]);

    const result = await runTaskAgentWatchdog(fakeSql([]));

    expect(result.released).toBe(0);
    expect(releaseProjectAgentSessionSlot).not.toHaveBeenCalled();
  });
});
