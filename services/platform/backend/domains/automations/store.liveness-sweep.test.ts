// @vitest-environment node

/**
 * Unit lock for what wakes a run nobody is stepping.
 *
 * The sweep re-pokes only a run whose promise really lapsed, and re-checks
 * the promise in the write of each poke, so two sweeps that overlap poke a
 * run once. A running run whose lease lapsed — its walker died — is
 * recorded and its open views told; a queued or parked run that is overdue
 * gets the poke alone. A poll that finds its park due promises the claim of
 * the step it queues instead of reading overdue at once; a park on a write
 * that may already have happened is due only once a person decided. A
 * stopping process hands on exactly the runs it holds a lease on.
 */

import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../jobs/enqueue.ts', () => ({ addJobInTx: vi.fn() }));
vi.mock('../../realtime/outbox.ts', () => ({ emitHintInTx: vi.fn() }));

import {
  IN_DOUBT_POLL_MS,
  RUN_CLAIM_PROMISE_MS,
} from '../../core/automations/liveness.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import { instanceId } from '../../lib/instance.ts';
import { emitHintInTx } from '../../realtime/outbox.ts';
import {
  pollParkedRun,
  pokeParkedRun,
  releaseOwnedRunLeases,
  sweepOverdueRuns,
} from './store.ts';

interface Statement {
  text: string;
  values: unknown[];
  tx: number;
}

type Answer = (text: string, values: unknown[]) => unknown[] | Error;

/** Scripted `sql`: every statement is answered by `answer`; each `begin`
 * opens a numbered transaction the statements inside it carry. */
function fakeSql(answer: Answer): { sql: Sql; statements: Statement[] } {
  const statements: Statement[] = [];
  let tx = 0;
  let current = 0;
  const fn = (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<unknown[]> => {
    const text = strings.join('?');
    statements.push({ text, values, tx: current });
    const result = answer(text, values);
    return result instanceof Error
      ? Promise.reject(result)
      : Promise.resolve(result);
  };
  fn.unsafe = (text: string): { raw: string } => ({ raw: text });
  fn.json = (value: unknown): { json: unknown } => ({ json: value });
  fn.begin = async (body: (handle: unknown) => Promise<unknown>) => {
    tx += 1;
    current = tx;
    try {
      return await body(fn);
    } finally {
      current = 0;
    }
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a scripted tagged template standing in for postgres.js
  return { sql: fn as unknown as Sql, statements };
}

const eventKinds = (statements: Statement[]) =>
  statements
    .filter((s) => s.text.includes('INSERT INTO app.automation_run_events'))
    .map((s) => ({ runId: s.values[0], kind: s.values[3] }));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('sweepOverdueRuns', () => {
  const overdue = [
    {
      id: 'run_dead',
      orgId: 'org_1',
      owner: 'host-a:41:0.5.80:blue',
      leaseExpired: true,
    },
    { id: 'run_queued', orgId: 'org_1', owner: null, leaseExpired: false },
    { id: 'run_raced', orgId: 'org_2', owner: null, leaseExpired: false },
  ];

  it('pokes each overdue run once, re-checking the promise in its own write', async () => {
    const fake = fakeSql((text, values) => {
      if (text.includes('SELECT id, org_id')) return overdue;
      if (text.includes('UPDATE app.automation_runs')) {
        // Another sweep poked `run_raced` between the read and this write.
        return values.includes('run_raced') ? [] : [{ id: values[1] }];
      }
      return [];
    });
    await expect(sweepOverdueRuns(fake.sql)).resolves.toBe(2);

    const pokes = fake.statements.filter((s) =>
      s.text.includes('UPDATE app.automation_runs'),
    );
    expect(pokes).toHaveLength(3);
    for (const poke of pokes) {
      expect(poke.text).toContain(
        'AND wake_at_ms IS NOT NULL AND wake_at_ms < ?',
      );
      expect(poke.tx).toBeGreaterThan(0);
    }
    // Each poke is its own transaction.
    expect(new Set(pokes.map((poke) => poke.tx)).size).toBe(3);
    expect(vi.mocked(addJobInTx).mock.calls.map((call) => call[2])).toEqual([
      { organizationId: 'org_1', runId: 'run_dead' },
      { organizationId: 'org_1', runId: 'run_queued' },
    ]);
  });

  it('records a lapsed lease and tells open views, and only for that run', async () => {
    const fake = fakeSql((text, values) => {
      if (text.includes('SELECT id, org_id')) return overdue;
      if (text.includes('UPDATE app.automation_runs'))
        return [{ id: values[1] }];
      if (text.includes('INSERT INTO app.automation_run_events')) {
        return [{ id: 'event_1' }];
      }
      return [];
    });
    await sweepOverdueRuns(fake.sql);
    expect(eventKinds(fake.statements)).toEqual([
      { runId: 'run_dead', kind: 'lease_expired' },
    ]);
    const event = fake.statements.find((s) =>
      s.text.includes('INSERT INTO app.automation_run_events'),
    );
    expect(event?.values).toContainEqual({
      json: { owner: 'host-a:41:0.5.80:blue' },
    });
    expect(vi.mocked(emitHintInTx).mock.calls.map((call) => call[1])).toEqual([
      { orgId: 'org_1', entity: 'automation_run', entityId: 'run_dead' },
    ]);
  });

  it('reads a lapsed lease only on a running run whose lease is its own claim’s', async () => {
    const fake = fakeSql(() => []);
    await sweepOverdueRuns(fake.sql, 10);
    const [read] = fake.statements;
    expect(read?.text).toContain(
      "status = 'running' AND lease_epoch = claim_epoch",
    );
    expect(read?.values).toContain(10);
  });
});

describe('pollParkedRun', () => {
  const parked = (detail: string, checkpoints: unknown = { nodes: {} }) => ({
    id: 'run_1',
    status: 'waiting',
    chainSeq: 4,
    detail,
    checkpoints,
  });

  it('wakes a due park with the claim promise, never overdue', async () => {
    const before = Date.now();
    const fake = fakeSql((text) =>
      text.includes('FROM app.automation_runs') ? [parked('repeat:poll')] : [],
    );
    await expect(
      pollParkedRun(fake.sql, {
        organizationId: 'org_1',
        runId: 'run_1',
        seq: 4,
        pollMs: 5_000,
      }),
    ).resolves.toEqual({ due: true, rearmed: false });
    const wake = fake.statements.find((s) =>
      s.text.includes('UPDATE app.automation_runs'),
    );
    expect(wake?.values[0]).toBeGreaterThanOrEqual(
      before + RUN_CLAIM_PROMISE_MS,
    );
    expect(addJobInTx).toHaveBeenCalledWith(
      fake.sql,
      'automation.step',
      { organizationId: 'org_1', runId: 'run_1' },
      {},
    );
  });

  it.each([
    [false, { due: false, rearmed: true }, 'automation.poll'],
    [true, { due: true, rearmed: false }, 'automation.step'],
  ] as const)(
    'holds a park on a write that may have happened until a person decided (decided: %s)',
    async (decided, outcome, job) => {
      const fake = fakeSql((text) => {
        if (text.includes('FROM app.automation_runs')) {
          return [parked('in_doubt:send')];
        }
        if (text.includes('FROM app.automation_node_attempts')) {
          return [{ decided }];
        }
        return [];
      });
      await expect(
        pollParkedRun(fake.sql, {
          organizationId: 'org_1',
          runId: 'run_1',
          seq: 4,
          pollMs: 3_600_000,
        }),
      ).resolves.toEqual(outcome);
      const probe = fake.statements.find((s) =>
        s.text.includes('FROM app.automation_node_attempts'),
      );
      expect(probe?.text).toContain(
        "status = 'started' AND resolution IS NOT NULL",
      );
      expect(vi.mocked(addJobInTx).mock.calls[0]?.[1]).toBe(job);
    },
  );

  it('re-arms an undecided in-doubt park at the backstop interval, whatever its hop was given', async () => {
    const fake = fakeSql((text) => {
      if (text.includes('FROM app.automation_runs')) {
        return [parked('in_doubt:send')];
      }
      if (text.includes('FROM app.automation_node_attempts')) {
        return [{ decided: false }];
      }
      return [];
    });
    await pollParkedRun(fake.sql, {
      organizationId: 'org_1',
      runId: 'run_1',
      seq: 4,
      pollMs: 30_000,
    });
    expect(vi.mocked(addJobInTx).mock.calls[0]?.[2]).toEqual({
      organizationId: 'org_1',
      runId: 'run_1',
      seq: 4,
      pollMs: IN_DOUBT_POLL_MS,
    });
  });
});

describe('pokeParkedRun', () => {
  it('wakes a parked run only, with the claim promise', async () => {
    const before = Date.now();
    const fake = fakeSql((text) =>
      text.includes('UPDATE app.automation_runs') ? [{ id: 'run_1' }] : [],
    );
    await expect(
      pokeParkedRun(fake.sql, { organizationId: 'org_1', runId: 'run_1' }),
    ).resolves.toBe(true);
    const [poke] = fake.statements;
    expect(poke?.text).toContain("AND status = 'waiting'");
    expect(poke?.values[0]).toBeGreaterThanOrEqual(
      before + RUN_CLAIM_PROMISE_MS,
    );
    expect(addJobInTx).toHaveBeenCalledTimes(1);
  });
});

describe('releaseOwnedRunLeases', () => {
  it('hands on exactly the runs this process holds a lease on, one step each', async () => {
    const fake = fakeSql((text) => {
      if (text.includes('UPDATE app.automation_runs')) {
        return [
          { id: 'run_a', orgId: 'org_1' },
          { id: 'run_b', orgId: 'org_2' },
        ];
      }
      if (text.includes('INSERT INTO app.automation_run_events')) {
        return [{ id: 'event_1' }];
      }
      return [];
    });
    await expect(releaseOwnedRunLeases(fake.sql)).resolves.toBe(2);
    const release = fake.statements[0];
    expect(release?.text).toContain('lease_owner = ?');
    expect(release?.text).toContain('lease_epoch = claim_epoch');
    expect(release?.text).toContain("last_resume_reason = 'shutdown'");
    expect(release?.values).toContain(instanceId());
    expect(vi.mocked(addJobInTx).mock.calls.map((call) => call[2])).toEqual([
      { organizationId: 'org_1', runId: 'run_a' },
      { organizationId: 'org_2', runId: 'run_b' },
    ]);
    expect(eventKinds(fake.statements)).toEqual([
      { runId: 'run_a', kind: 'handed_off' },
      { runId: 'run_b', kind: 'handed_off' },
    ]);
    // Everything in one transaction: nothing released without its step.
    expect(new Set(fake.statements.map((s) => s.tx))).toEqual(new Set([1]));
  });

  it('releases the leases alone, overdue, when the hand-off cannot commit', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let writes = 0;
    const fake = fakeSql((text) => {
      if (text.includes('UPDATE app.automation_runs')) {
        writes += 1;
        return writes === 1
          ? [{ id: 'run_a', orgId: 'org_1' }]
          : [{ id: 'run_a' }];
      }
      if (text.includes('INSERT INTO app.automation_run_events')) {
        return new Error('the job queue is closing');
      }
      return [];
    });
    vi.mocked(addJobInTx).mockResolvedValueOnce('job_1');
    await expect(releaseOwnedRunLeases(fake.sql)).resolves.toBe(1);
    expect(warn).toHaveBeenCalledTimes(1);
    const fallback = fake.statements.at(-1);
    expect(fallback?.tx).toBe(0);
    expect(fallback?.text).toContain('lease_owner = NULL');
    expect(fallback?.values).toContain(instanceId());
  });
});
