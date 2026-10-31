import type { Sql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AGENT_RUN_WAITING_REASONS } from '../../../lib/shared/agent-run-waiting.ts';
import { TASK_RUN_FAILURE_CODES } from '../../../lib/shared/task-run-failure.ts';
import {
  AGENT_RUN_FAILURE_LABELS,
  AGENT_RUN_PARK_LABELS,
  countedAgentRunWake,
  countFailedAgentRun,
  countParkedAgentRun,
  readAgentRunCounters,
} from './agent-run-counters.ts';

/** A postgres.js stand-in recording every statement it is handed. */
function recordingSql(rows: unknown[] = []): {
  sql: Sql;
  calls: { text: string; values: unknown[] }[];
} {
  const calls: { text: string; values: unknown[] }[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({
      text: strings.join('?').replaceAll(/\s+/g, ' ').trim(),
      values,
    });
    return Promise.resolve(rows);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { sql: tag as unknown as Sql, calls };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the running totals of agent runs’ parks, wakes and failures [TASK-R93]', () => {
  it('adds a park under its waiting reason, anything else under unknown', async () => {
    const { sql, calls } = recordingSql();
    await countParkedAgentRun(sql, 'host');
    await countParkedAgentRun(sql, undefined);
    // An id never becomes a label.
    await countParkedAgentRun(sql, 'org-1');
    expect(calls.map((call) => call.values)).toEqual([
      ['park', 'host', 1],
      ['park', 'unknown', 1],
      ['park', 'unknown', 1],
    ]);
    // One statement per event: an upsert that adds to the row.
    expect(calls[0]?.text).toBe(
      'INSERT INTO app.agent_run_counters AS c (event, label, total) VALUES (?, ?, ?) ON CONFLICT (event, label) DO UPDATE SET total = c.total + EXCLUDED.total',
    );
  });

  it('adds a failed run under its failure code, none or a foreign one under unknown', async () => {
    const { sql, calls } = recordingSql();
    await countFailedAgentRun(sql, 'resource_exhausted');
    await countFailedAgentRun(sql, null);
    await countFailedAgentRun(sql, 'teapot_overflow');
    expect(calls.map((call) => call.values)).toEqual([
      ['failure', 'resource_exhausted', 1],
      ['failure', 'unknown', 1],
      ['failure', 'unknown', 1],
    ]);
  });

  it('counts the runs a wake woke under its source, nothing for none, and a wake that threw as one failed wake', async () => {
    const { sql, calls } = recordingSql();
    await expect(
      countedAgentRunWake(sql, 'scheduled', async () => 1),
    ).resolves.toBe(1);
    await expect(
      countedAgentRunWake(sql, 'watchdog', async () => 0),
    ).resolves.toBe(0);
    await expect(
      countedAgentRunWake(sql, 'release', async () => {
        throw new Error('deadlock detected');
      }),
    ).rejects.toThrow('deadlock detected');
    expect(calls.map((call) => call.values)).toEqual([
      ['wake', 'scheduled', 1],
      ['wake_failure', 'release', 1],
    ]);
  });

  it('never fails the event it counts: a total it cannot write is logged', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
    const sql = (() =>
      Promise.reject(new Error('connection reset'))) as unknown as Sql;
    await expect(countParkedAgentRun(sql, 'host')).resolves.toBeUndefined();
    await expect(
      countedAgentRunWake(sql, 'release', async () => 2),
    ).resolves.toBe(2);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(String(warn.mock.calls[0]?.[0])).toContain('[metrics]');
  });

  it('labels only from closed sets', () => {
    expect(AGENT_RUN_PARK_LABELS).toEqual([
      ...AGENT_RUN_WAITING_REASONS,
      'unknown',
    ]);
    expect(AGENT_RUN_FAILURE_LABELS).toEqual([
      ...TASK_RUN_FAILURE_CODES,
      'unknown',
    ]);
    expect(AGENT_RUN_FAILURE_LABELS).toContain('resource_exhausted');
  });

  it('reads one event’s totals by label', async () => {
    const { sql, calls } = recordingSql([
      { label: 'host', total: '12' },
      { label: 'unknown', total: '1' },
    ]);
    await expect(readAgentRunCounters(sql, 'park')).resolves.toEqual(
      new Map([
        ['host', 12],
        ['unknown', 1],
      ]),
    );
    expect(calls[0]?.values).toEqual(['park']);
  });
});
