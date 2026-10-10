import type { Sql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';

import { beginRunInTx } from './store.ts';

vi.mock('./store.ts', async (original) => ({
  ...(await original<typeof import('./store.ts')>()),
  beginRunInTx: vi.fn(async () => ({ runId: 'new-occurrence', version: 1 })),
}));
vi.mock('./triggers.ts', () => ({ stampFired: vi.fn() }));
vi.mock('../tasks/delegated-start.ts', () => ({
  inPlaceStartRefusal: vi.fn(async () => null),
  automatedStartWindow: vi.fn(async () => ({ admitted: true })),
}));
vi.mock('../tasks/dependencies.ts', () => ({
  openTaskBlockerIds: vi.fn(async () => []),
}));

import {
  WAKE_SCAN_LIMIT,
  classifyOccurrence,
  fireDueProjectWakes,
  targetBlock,
} from './wakes.ts';

const READY = {
  kind: 'schedule',
  enabled: true,
  wakeOnSlotFreed: true,
  bound: true,
  lastSkipReason: null,
  lastFailureCode: null,
};

describe('targetBlock — the wake mirrors an explicit target state [AUTO-R33]', () => {
  it('lets an enabled, opted-in, bound schedule fire', () => {
    expect(targetBlock(READY)).toBeNull();
  });

  it('mirrors AUTO-R13’s pause as blocked, naming its cause (W8b)', () => {
    expect(
      targetBlock({
        ...READY,
        enabled: false,
        lastSkipReason: 'paused_after_failures',
        lastFailureCode: 'node_error',
      }),
    ).toEqual({
      outcome: 'blocked',
      reason: 'paused_after_failures:node_error',
    });
  });

  it.each([
    ['disabled by a person', { enabled: false }],
    ['opted out', { wakeOnSlotFreed: false }],
    ['unbound from the project', { bound: false }],
    ['no longer a schedule', { kind: 'webhook' }],
  ])('mirrors a target %s as target_disabled (W17)', (_case, change) => {
    expect(targetBlock({ ...READY, ...change })).toEqual({
      outcome: 'target_disabled',
      reason: null,
    });
  });
});

describe('classifyOccurrence — admitted or not, once the occurrence ended [AUTO-R33]', () => {
  it('records the manager an admitted occurrence started; attempts stay', () => {
    expect(
      classifyOccurrence({
        receipt: { taskId: 'task-M', agentId: 'agent-M' },
        attempts: 2,
        endedAt: 1_000,
      }),
    ).toEqual({
      outcome: 'admitted',
      managerTaskId: 'task-M',
      managerAgentId: 'agent-M',
    });
  });

  it('backs a not-admitted occurrence off from its end (W5, W7, W8)', () => {
    const ended = 10 * 60_000;
    const steps = [0, 1, 2].map((attempts) =>
      classifyOccurrence({ receipt: null, attempts, endedAt: ended }),
    );
    expect(steps).toEqual([
      { outcome: 'not_admitted', attempts: 1, notBefore: ended + 60_000 },
      { outcome: 'not_admitted', attempts: 2, notBefore: ended + 120_000 },
      { outcome: 'not_admitted', attempts: 3, notBefore: ended + 240_000 },
    ]);
  });

  it('keeps retrying at the hourly cap, never giving up (W8)', () => {
    const late = classifyOccurrence({
      receipt: null,
      attempts: 40,
      endedAt: 0,
    });
    expect(late).toEqual({
      outcome: 'not_admitted',
      attempts: 41,
      notBefore: 60 * 60_000,
    });
  });
});

describe('fireDueProjectWakes — a fair, bounded visit (#4540)', () => {
  it('claims the pending rows visited longest ago and stamps them before working them', async () => {
    const statements: { text: string; values: unknown[] }[] = [];
    const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
      statements.push({
        text: strings.join('?').replaceAll(/\s+/g, ' ').trim(),
        values,
      });
      return Promise.resolve([]);
    };
    const sql = Object.assign(tag, {
      begin: () => Promise.reject(new Error('no row to work')),
    });
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a stand-in for the postgres.js template function
    const result = await fireDueProjectWakes(sql as unknown as Sql);
    expect(result).toMatchObject({ examined: 0, fired: 0, failed: 0 });
    expect(statements).toHaveLength(1);
    const claim = statements[0]?.text ?? '';
    expect(claim).toContain('INSERT INTO app.project_wake_visits');
    expect(claim).toContain('ORDER BY v.visited_at_ms ASC NULLS FIRST');
    expect(claim).toContain('LIMIT ?');
    expect(claim).toContain('RETURNING');
    expect(statements[0]?.values).toContain(WAKE_SCAN_LIMIT);
  });

  it('works each claimed row in its own transaction: a failing row is counted and the next still runs', async () => {
    const tag = (strings: TemplateStringsArray) => {
      const text = strings.join('?');
      if (text.includes('INSERT INTO app.project_wake_visits')) {
        return Promise.resolve([
          { organizationId: 'org-1', projectId: 'p-1' },
          { organizationId: 'org-2', projectId: 'p-2' },
        ]);
      }
      if (text.includes('pg_try_advisory_xact_lock')) {
        return Promise.resolve([{ locked: false }]);
      }
      return Promise.resolve([]);
    };
    let begun = 0;
    const sql = Object.assign(tag, {
      begin: (callback: (tx: typeof tag) => Promise<unknown>) => {
        begun += 1;
        return begun === 1
          ? Promise.reject(new Error('row fault'))
          : callback(tag);
      },
    });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a stand-in for the postgres.js template function
    const result = await fireDueProjectWakes(sql as unknown as Sql);
    expect(result).toMatchObject({ examined: 2, failed: 1, busy: 1 });
    expect(logged).toHaveBeenCalledTimes(1);
    logged.mockRestore();
  });
});

describe('manager worker independence [AUTO-R33]', () => {
  it.each(['settled', 'queued', 'running'])(
    'keeps only the manager card hold when its newest run is %s',
    async (status) => {
      vi.mocked(beginRunInTx).mockClear();
      const tag = (strings: TemplateStringsArray) => {
        const text = strings.join('?').replaceAll(/\s+/g, ' ').trim();
        if (text.includes('INSERT INTO app.project_wake_visits'))
          return Promise.resolve([
            { organizationId: 'org-1', projectId: 'p-1' },
          ]);
        if (text.includes('pg_try_advisory_xact_lock'))
          return Promise.resolve([{ locked: true }]);
        if (
          text.includes('FROM app.project_wakes') &&
          text.includes('FOR UPDATE')
        )
          return Promise.resolve([
            {
              organizationId: 'org-1',
              projectId: 'p-1',
              triggerId: 'trigger-1',
              signalSeq: 2,
              consumedSeq: 1,
              firedRunId: null,
              attempts: 0,
              notBefore: null,
              outcome: 'served',
              blockedReason: null,
              managerTaskId: 'manager-task',
              managerAgentId: 'manager-agent',
            },
          ]);
        if (text.includes('FROM app.automation_triggers t'))
          return Promise.resolve([
            {
              ...READY,
              id: 'trigger-1',
              name: 'dispatch',
              lastRunId: null,
              updatedAt: 1,
            },
          ]);
        if (text.includes('FROM app.tasks'))
          return Promise.resolve([
            {
              id: 'manager-task',
              status: 'todo',
              assigneeType: 'agent',
              assigneeId: 'manager-agent',
            },
          ]);
        if (text.includes('FROM app.project_agent_runs')) {
          // A different task is actively using this agent's worker 1. Only
          // the manager card's own live run may hold its schedule now.
          return Promise.resolve(
            text.includes('task_id =')
              ? [{ id: 'manager-run', status }]
              : [{ id: 'other-task-run', status: 'running' }],
          );
        }
        if (text.startsWith('UPDATE app.automation_triggers'))
          return Promise.resolve([{ id: 'trigger-1' }]);
        return Promise.resolve([]);
      };
      const sql = Object.assign(tag, {
        begin: (callback: (tx: typeof tag) => Promise<unknown>) =>
          callback(tag),
      });
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a stand-in for the postgres.js template function
      const result = await fireDueProjectWakes(sql as unknown as Sql);
      expect(result.failed).toBe(0);
      expect(result.fired).toBe(status === 'settled' ? 1 : 0);
      expect(beginRunInTx).toHaveBeenCalledTimes(status === 'settled' ? 1 : 0);
    },
  );
});
