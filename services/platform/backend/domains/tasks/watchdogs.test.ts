// @vitest-environment node

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { sessionCancelExec } from '../../core/node_only/sandbox/helpers/session_client.ts';
import { CHAT_GENERATION_STALE_MS } from '../chat/watchdogs.ts';
import { releaseProjectAgentSessionSlot } from '../sandbox/sessions.ts';
import {
  failAgentRun,
  failAgentRunFromTurn,
  listOverdueAgentRuns,
  listParkedAgentRunOrganizations,
  wakeOrganizationParkedAgentRun,
} from './agent-runs.ts';
import { runTaskAgentWatchdog } from './watchdogs.ts';

vi.mock('../../core/node_only/sandbox/helpers/session_client.ts', () => ({
  sessionCancelExec: vi.fn(async () => undefined),
}));
vi.mock('../sandbox/sessions.ts', () => ({
  releaseProjectAgentSessionSlot: vi.fn(async () => true),
}));
vi.mock('./agent-runs.ts', () => ({
  failAgentRun: vi.fn(),
  failAgentRunFromTurn: vi.fn(),
  listOverdueAgentRuns: vi.fn(),
  listParkedAgentRunOrganizations: vi.fn(),
  wakeOrganizationParkedAgentRun: vi.fn(),
}));

interface Statement {
  text: string;
  values: unknown[];
}

/** A pool answering the sweep's three lists and recording every statement. */
function fakeSql(
  lost: { id: string; organizationId: string; execId: string }[],
) {
  const statements: Statement[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replaceAll(/\s+/g, ' ').trim();
    statements.push({ text, values });
    if (text.includes('LEFT JOIN app.generations'))
      return Promise.resolve(lost);
    return Promise.resolve([]);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a tagged-template fake standing in for the pool
  return { sql: tag as unknown as Sql, statements };
}

const overdue = (engine: 'native' | 'harness') =>
  ({
    id: 'run-1',
    organizationId: 'org-1',
    execId: 'exec-1',
    sessionId: 'session-1',
    agentId: 'agent-1',
    engine,
    threadId: engine === 'native' ? 'thread-1' : null,
  }) as never;

beforeEach(() => {
  vi.mocked(sessionCancelExec).mockClear();
  vi.mocked(releaseProjectAgentSessionSlot).mockClear();
  vi.mocked(failAgentRun).mockReset().mockResolvedValue(true);
  vi.mocked(failAgentRunFromTurn).mockReset().mockResolvedValue(true);
  vi.mocked(listOverdueAgentRuns).mockReset().mockResolvedValue([]);
  vi.mocked(listParkedAgentRunOrganizations).mockReset().mockResolvedValue([]);
  vi.mocked(wakeOrganizationParkedAgentRun).mockReset().mockResolvedValue(0);
});

describe('the deadline sweep', () => {
  it('stops a harness run’s exec and gives its worker back', async () => {
    vi.mocked(listOverdueAgentRuns).mockResolvedValue([overdue('harness')]);
    const { sql } = fakeSql([]);

    await expect(runTaskAgentWatchdog(sql)).resolves.toMatchObject({
      failed: 1,
    });

    expect(sessionCancelExec).toHaveBeenCalledWith('session-1', 'exec-1');
    expect(releaseProjectAgentSessionSlot).toHaveBeenCalledWith(sql, {
      organizationId: 'org-1',
      agentId: 'agent-1',
    });
  });

  it('fails a native run past its deadline without an exec to stop or a worker to free, and tells its turn to end', async () => {
    vi.mocked(listOverdueAgentRuns).mockResolvedValue([overdue('native')]);
    const { sql, statements } = fakeSql([]);

    await expect(runTaskAgentWatchdog(sql)).resolves.toMatchObject({
      failed: 1,
    });

    expect(failAgentRun).toHaveBeenCalledWith(
      sql,
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

describe('the sweep of native runs whose turn is gone [TASK-R34]', () => {
  const LOST = [{ id: 'run-9', organizationId: 'org-1', execId: 'exec-9' }];

  it('fails each as interrupted, which retries, and ends any turn still running', async () => {
    const { sql, statements } = fakeSql(LOST);

    await expect(runTaskAgentWatchdog(sql)).resolves.toMatchObject({
      failed: 1,
    });

    expect(failAgentRunFromTurn).toHaveBeenCalledWith(sql, {
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
    const { sql, statements } = fakeSql(LOST);

    await expect(runTaskAgentWatchdog(sql)).resolves.toMatchObject({
      failed: 0,
    });

    expect(
      statements.some((statement) =>
        statement.text.includes('SET cancel_requested = true'),
      ),
    ).toBe(false);
  });

  it('asks the three questions a native turn’s liveness is: no transcript, a turn that ended, a heartbeat gone silent', async () => {
    const { sql, statements } = fakeSql([]);
    const before = Date.now();

    await runTaskAgentWatchdog(sql);

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
});
