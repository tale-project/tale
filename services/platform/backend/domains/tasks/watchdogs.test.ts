// @vitest-environment node

/**
 * The deadline sweep must stop the PROCESS, not only its ledger: failing an
 * overdue run while its sandbox exec keeps running leaked the exec's compute
 * until the agent gave up on its own (its gateway key revoked, it ground on
 * auth errors), and a Retry could then start a second exec against the same
 * standing workspace. The sweep cancels the exec — best-effort, before the
 * op row is settled — and an unreachable spawner never keeps the run alive.
 *
 * A native run has no exec and no worker: its deadline fails the run and
 * tells its turn to end, and a separate sweep fails the native runs whose
 * turn is gone (`TASK-R34`).
 */

import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sessionCancelExec } from '../../core/node_only/sandbox/helpers/session_client.ts';
import { CHAT_GENERATION_STALE_MS } from '../chat/watchdogs.ts';
import { releaseProjectAgentSessionSlot } from '../sandbox/sessions.ts';
import {
  type AgentRunRow,
  failAgentRun,
  failAgentRunFromTurn,
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
  failAgentRunFromTurn: vi.fn(),
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
  engine: 'harness',
  threadId: null,
} as unknown as AgentRunRow;

const overdueNativeRun = {
  ...overdueRun,
  engine: 'native',
  threadId: 'thread-1',
} as unknown as AgentRunRow;

interface Statement {
  text: string;
  values: unknown[];
}

/** A native run the sweep finds with its turn gone. */
const LOST = [{ id: 'run-9', organizationId: 'org-1', execId: 'exec-9' }];

/** A recorder `sql`: every statement lands in `events` in call order, next
 * to the exec cancels the mock records — the order IS the contract. The
 * orphan backstop's read answers `orphaned`; the native sweep's read answers
 * `lost`; `statements` keeps each statement whole for the tests that read
 * its text and values. */
function fakeSql(
  events: string[],
  orphaned: Array<{ organizationId: string; agentId: string }> = [],
  more: {
    lost?: typeof LOST;
    statements?: Statement[];
  } = {},
): Sql {
  const fn = (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<unknown[]> => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    events.push(`sql:${text.slice(0, 36)}`);
    more.statements?.push({ text, values });
    if (text.includes('LEFT JOIN app.generations')) {
      return Promise.resolve(more.lost ?? []);
    }
    // The orphan backstop's read is the only SELECT answered with rows.
    return Promise.resolve(text.startsWith('SELECT DISTINCT') ? orphaned : []);
  };
  return fn as unknown as Sql;
}

beforeEach(() => {
  vi.mocked(listOverdueAgentRuns).mockResolvedValue([overdueRun]);
  vi.mocked(listParkedAgentRunOrganizations).mockResolvedValue([]);
  vi.mocked(failAgentRun).mockResolvedValue(true);
  vi.mocked(failAgentRunFromTurn).mockResolvedValue(true);
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

  it('goes on to the next organization when one organization’s wake fails [TASK-R25]', async () => {
    vi.mocked(listOverdueAgentRuns).mockResolvedValue([]);
    vi.mocked(listParkedAgentRunOrganizations).mockResolvedValue([
      { organizationId: 'org-broken' },
      { organizationId: 'org-next' },
    ]);
    let nextWoken = false;
    vi.mocked(wakeOrganizationParkedAgentRun).mockImplementation(
      async (_sql, org) => {
        if (org === 'org-broken') {
          throw Object.assign(new Error('duplicate key'), { code: '23505' });
        }
        if (nextWoken) return 0;
        nextWoken = true;
        return 1;
      },
    );
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await runTaskAgentWatchdog(fakeSql([]));

    expect(result.woken).toBe(1);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('org-broken'),
      expect.any(Error),
    );
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

describe('runTaskAgentWatchdog (deadline lane, native runs)', () => {
  it('fails a native run past its deadline without an exec to stop or a worker to free, and tells its turn to end', async () => {
    vi.mocked(listOverdueAgentRuns).mockResolvedValue([overdueNativeRun]);
    const statements: Statement[] = [];

    await expect(
      runTaskAgentWatchdog(fakeSql([], [], { statements })),
    ).resolves.toMatchObject({ failed: 1 });

    expect(failAgentRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ runId: 'run-1', failureCode: 'deadline' }),
    );
    expect(sessionCancelExec).not.toHaveBeenCalled();
    expect(releaseProjectAgentSessionSlot).not.toHaveBeenCalled();
    const flag = statements.find((statement) =>
      statement.text.includes('SET cancel_requested = true'),
    );
    expect(flag?.values).toEqual(['thread-1', 'org-1']);
  });
});

describe('runTaskAgentWatchdog (native runs whose turn is gone) [TASK-R34]', () => {
  beforeEach(() => {
    vi.mocked(listOverdueAgentRuns).mockResolvedValue([]);
  });

  it('fails each as interrupted, which retries, and ends any turn still running', async () => {
    const statements: Statement[] = [];

    await expect(
      runTaskAgentWatchdog(fakeSql([], [], { lost: LOST, statements })),
    ).resolves.toMatchObject({ failed: 1 });

    expect(failAgentRunFromTurn).toHaveBeenCalledWith(expect.anything(), {
      runId: 'run-9',
      execId: 'exec-9',
      error: 'the agent run was interrupted before it finished',
      failureCode: 'turn_crashed',
    });
    expect(
      statements.some((statement) =>
        statement.text.includes('SET cancel_requested = true'),
      ),
    ).toBe(true);
  });

  it('counts and flags only the runs this sweep won', async () => {
    vi.mocked(failAgentRunFromTurn).mockResolvedValue(false);
    const statements: Statement[] = [];

    await expect(
      runTaskAgentWatchdog(fakeSql([], [], { lost: LOST, statements })),
    ).resolves.toMatchObject({ failed: 0 });

    expect(
      statements.some((statement) =>
        statement.text.includes('SET cancel_requested = true'),
      ),
    ).toBe(false);
  });

  it('asks the three questions a native turn’s liveness is: no transcript, a turn that ended, a heartbeat gone silent', async () => {
    const statements: Statement[] = [];
    const before = Date.now();

    await runTaskAgentWatchdog(fakeSql([], [], { statements }));

    const list = statements.find((statement) =>
      statement.text.includes('LEFT JOIN app.generations'),
    );
    expect(list?.text).toContain(
      "r.engine = 'native' AND r.status = 'running'",
    );
    expect(list?.text).toContain('r.thread_id IS NULL');
    expect(list?.text).toContain('g.thread_id IS NULL');
    expect(list?.text).toContain('g.heartbeat_at_ms <');
    // The silence window is a chat reply's: every tool of a turn ends inside it.
    const horizons = (list?.values ?? []).filter(
      (value): value is number => typeof value === 'number',
    );
    expect(horizons).toHaveLength(4);
    expect(
      horizons.some(
        (horizon) =>
          Math.abs(before - CHAT_GENERATION_STALE_MS - horizon) < 5_000,
      ),
    ).toBe(true);
  });

  it('keeps a worker an idle release may take: only a harness run holds a standing session', async () => {
    const statements: Statement[] = [];

    await runTaskAgentWatchdog(fakeSql([], [], { statements }));

    const orphanRead = statements.find((statement) =>
      statement.text.startsWith('SELECT DISTINCT s.org_id'),
    );
    expect(orphanRead?.text).toContain("r.engine = 'harness'");
  });
});
