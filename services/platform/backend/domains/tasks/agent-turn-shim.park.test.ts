// @vitest-environment node

/**
 * The turn host parks a run the sandbox host or its workspace's runtime
 * refused (`tasks/agent_runs:parkTaskAgentRunForCapacity`). The park counts
 * in the backend's metrics once its transaction committed, under the reason
 * it waits for; a park that matched no run counts nothing.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { releaseProjectAgentSessionSlot } from '../sandbox/sessions.ts';
import { agentTurnShimHandlers } from './agent-turn-shim.ts';

vi.mock('../sandbox/sessions.ts', async (original) => ({
  ...(await original<typeof import('../sandbox/sessions.ts')>()),
  releaseProjectAgentSessionSlot: vi.fn(async () => true),
}));

/** A statement {@link parkSql} recorded: the handle that ran it, and
 * whether a transaction was open then. */
type ParkSqlCall = {
  text: string;
  values: unknown[];
  on: 'root' | 'tx';
  open: boolean;
};

/** A database whose park matches the run when `parked`, recording every
 * statement; `begin` hands the park a transaction handle of its own. */
function parkSql(parked: boolean): {
  sql: Sql;
  calls: ParkSqlCall[];
} {
  const calls: ParkSqlCall[] = [];
  let open = false;
  const handle = (on: 'root' | 'tx') =>
    Object.assign(
      (strings: TemplateStringsArray, ...values: unknown[]) => {
        const text = strings.join('?').replaceAll(/\s+/g, ' ').trim();
        calls.push({ text, values, on, open });
        return Promise.resolve(
          parked && text.startsWith('UPDATE app.project_agent_runs SET status')
            ? [
                {
                  organizationId: 'org-1',
                  taskId: 'task-1',
                  agentId: 'agent-1',
                  execId: 'exec-1',
                  sessionId: 'pa-agent-1',
                },
              ]
            : [],
        );
      },
      { unsafe: (text: string) => text },
    );
  const tx = handle('tx');
  const sql = Object.assign(handle('root'), {
    begin: async (work: (tx: ReturnType<typeof handle>) => unknown) => {
      open = true;
      try {
        return await work(tx);
      } finally {
        open = false;
      }
    },
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { sql: sql as unknown as Sql, calls };
}

/** What the park added to the running totals, as `[event, label, by]`. Each
 * write ran on the root handle after the park's transaction settled: inside
 * it, a write that failed would abort the park (25P02). */
const counted = (calls: ParkSqlCall[]) =>
  calls.flatMap((call, index) => {
    if (!call.text.startsWith('INSERT INTO app.agent_run_counters')) return [];
    expect(call).toMatchObject({ on: 'root', open: false });
    expect(calls.slice(0, index).some((before) => before.on === 'tx')).toBe(
      true,
    );
    return [call.values];
  });

const PARK = 'tasks/agent_runs:parkTaskAgentRunForCapacity';

describe('the turn host’s park counts once it committed [TASK-R86]', () => {
  beforeEach(() => {
    vi.mocked(releaseProjectAgentSessionSlot).mockClear();
  });

  it.each([
    { args: { reason: 'host' }, label: 'host' },
    { args: { reason: 'exec_limit', execRefused: true }, label: 'exec_limit' },
    // A refusal with no wording of its own parks without a reason.
    { args: {}, label: 'unknown' },
  ])('a park for $label counts under $label', async ({ args, label }) => {
    const { sql, calls } = parkSql(true);
    await agentTurnShimHandlers(sql)[PARK]?.({
      runId: 'run-1',
      execId: 'exec-1',
      ...args,
    });
    expect(counted(calls)).toEqual([['park', label, 1]]);
    expect(releaseProjectAgentSessionSlot).toHaveBeenCalledOnce();
  });

  it('a park that matched no run counts nothing', async () => {
    // The run settled or moved to another exec meanwhile.
    const { sql, calls } = parkSql(false);
    await agentTurnShimHandlers(sql)[PARK]?.({
      runId: 'run-1',
      execId: 'exec-1',
      reason: 'host',
    });
    expect(counted(calls)).toEqual([]);
    expect(releaseProjectAgentSessionSlot).not.toHaveBeenCalled();
  });
});
