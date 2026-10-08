// @vitest-environment node

/**
 * Unit lock for the walker's progress write and the durable run lane's
 * payload bound (run-log class).
 *
 * `recordProgress` is ONE statement fenced by the walker's claim epoch and a
 * live status: the incoming node checkpoint is merged into the stored
 * `nodes` by the database, so the write never reads the row first and two
 * commits of one claim never drop each other's node (the real-Postgres
 * probe races two). Only the incoming checkpoint is bounded — never the
 * stored `nodes` it joins, since the bound is not idempotent — while
 * `checkpoint.output` (the executor's scope) and `effects` (the audit trail)
 * are stored whole. A write that matched nothing reads why: missing, ended,
 * or `stale` (another walker holds a newer claim). `detail` is capped
 * through the same helper on both the terminal and the parking door.
 */

import type { PgBoss } from 'pg-boss';
import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  MAX_RUN_DETAIL_CHARS,
  MAX_TRACE_FIELD_CHARS,
} from '../../core/automations/bound_run_payload.ts';
import type { NodeCheckpoint } from '../../core/automations/checkpoints.ts';
import { RUN_LEASE_MS } from '../../core/automations/liveness.ts';
import { setEnqueueBoss } from '../../jobs/enqueue.ts';
import { finishRun, recordProgress, suspendRun } from './store.ts';

beforeEach(() => {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- capture stub; the parking door only calls send()
  setEnqueueBoss({
    send: () => Promise.resolve('job-id'),
  } as unknown as PgBoss);
});

afterEach(() => {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- reset the module-level boss between tests
  setEnqueueBoss(null as unknown as PgBoss);
});

interface Statement {
  text: string;
  values: unknown[];
}

/** Scripted transactional `sql`: the fenced run write answers `written`
 * (empty = it matched nothing), the read that explains a miss answers
 * `current` (null = no such run). */
function fakeSql(
  written: Record<string, unknown>[],
  current: Record<string, unknown> | null = null,
): { sql: Sql; statements: Statement[] } {
  const statements: Statement[] = [];
  const fn = (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<unknown[]> => {
    const text = strings.join('?');
    statements.push({ text, values });
    if (text.includes('UPDATE app.automation_runs')) {
      return Promise.resolve(written);
    }
    if (text.includes('FROM app.automation_runs')) {
      return Promise.resolve(current === null ? [] : [current]);
    }
    return Promise.resolve([]);
  };
  fn.unsafe = (text: string): { raw: string } => ({ raw: text });
  fn.json = (value: unknown): { json: unknown } => ({ json: value });
  fn.begin = (body: (tx: unknown) => Promise<unknown>): Promise<unknown> =>
    body(fn);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a scripted tagged template standing in for postgres.js
  return { sql: fn as unknown as Sql, statements };
}

const stored: NodeCheckpoint = {
  status: 'ok',
  output: { kept: 'k'.repeat(100_000) },
  trace: {
    node: 'earlier',
    type: 'connector',
    status: 'ok',
    // Already bounded once when it entered; must never be sent back.
    output: `${'k'.repeat(4096)}…(+95904 chars)`,
  },
  effects: [],
};

function updateOf(statements: Statement[]): Statement {
  const update = statements.find((s) =>
    s.text.includes('UPDATE app.automation_runs'),
  );
  if (!update) throw new Error('no run update recorded');
  return update;
}

/** The JSON a jsonb parameter carries: bound pre-serialized, as a string. */
function jsonValues(statement: Statement): unknown[] {
  return statement.values.flatMap((value) =>
    typeof value === 'object' &&
    value !== null &&
    'json' in value &&
    typeof value.json === 'string'
      ? [JSON.parse(value.json)]
      : [],
  );
}

const progress = (
  sql: Sql,
  args: Partial<Parameters<typeof recordProgress>[1]> = {},
) =>
  recordProgress(sql, {
    organizationId: 'org_1',
    runId: 'run_1',
    epoch: 1,
    executions: 2,
    ...args,
  });

describe('recordProgress', () => {
  it('bounds the incoming trace, stores output whole, and merges it in the database', async () => {
    const big = 'x'.repeat(200_000);
    const fake = fakeSql([{ status: 'running' }]);
    const result = await progress(fake.sql, {
      nodeId: 'list',
      checkpoint: {
        status: 'ok',
        output: { items: big },
        trace: { node: 'list', type: 'connector', status: 'ok', output: big },
        effects: [{ node: 'list', connector: 'imap-smtp', input: { big } }],
      } satisfies NodeCheckpoint,
    });

    expect(result).toEqual({ status: 'running' });
    const update = updateOf(fake.statements);
    const [list] = jsonValues(update) as [NodeCheckpoint];
    // The executor's scope and the audit trail are untouched…
    expect(list.output).toEqual({ items: big });
    expect(list.effects).toEqual([
      { node: 'list', connector: 'imap-smtp', input: { big } },
    ]);
    // …the descriptive trace is bounded.
    expect(JSON.stringify(list.trace.output).length).toBeLessThan(
      MAX_TRACE_FIELD_CHARS,
    );
    expect(list.trace.output).toContain('(+195904 chars)');
    // The node joins the stored ones in the database, keyed by its id; the
    // stored nodes are never read, so they are never re-bounded or lost.
    expect(update.text).toContain("checkpoints -> 'nodes'");
    expect(update.text).toContain('jsonb_build_object(?::text, ?::jsonb)');
    expect(update.values).toContain('list');
    expect(JSON.stringify(update.values)).not.toContain('earlier');
    expect(update.values).toContain(2);
  });

  it('is one fenced statement: no read of the run before the write', async () => {
    const fake = fakeSql([{ status: 'running' }]);
    await progress(fake.sql, { nodeId: 'a', checkpoint: stored });
    const runStatements = fake.statements.filter((s) =>
      s.text.includes('app.automation_runs'),
    );
    expect(runStatements).toHaveLength(1);
    const [update] = runStatements;
    expect(update?.text).toContain('UPDATE app.automation_runs');
    expect(update?.text).toContain('AND claim_epoch = ?');
    expect(update?.text).toContain(
      "AND status IN ('queued', 'running', 'waiting')",
    );
    expect(update?.values).toEqual(
      expect.arrayContaining(['run_1', 'org_1', 1]),
    );
    // Keys the engine does not know survive: only the cursor is replaced.
    expect(update?.text).toContain("checkpoints - 'cursor'");
    // An open run view refetches.
    expect(
      fake.statements.some((s) => s.text.includes('app_realtime.outbox')),
    ).toBe(true);
  });

  it('renews the lease and the promise that mirrors it, never a released lease', async () => {
    const before = Date.now();
    const fake = fakeSql([{ status: 'running' }]);
    await progress(fake.sql);
    const update = updateOf(fake.statements);
    expect(update.text).toContain(
      'lease_expires_at_ms = CASE WHEN lease_expires_at_ms IS NULL THEN NULL',
    );
    const stamps = update.values.filter(
      (value): value is number =>
        typeof value === 'number' && value >= before + RUN_LEASE_MS,
    );
    expect(stamps).toHaveLength(2);
    expect(stamps[0]).toBeLessThanOrEqual(Date.now() + RUN_LEASE_MS);
  });

  it('stores an unrecognizable checkpoint as it came', async () => {
    const fake = fakeSql([{ status: 'running' }]);
    await progress(fake.sql, { nodeId: 'odd', checkpoint: 'not a checkpoint' });
    expect(jsonValues(updateOf(fake.statements))).toEqual(['not a checkpoint']);
  });

  it('replaces the cursor when one is given and drops it otherwise', async () => {
    const cursor = { node: 'loop', index: 3, passes: 0, outs: [1, 2, 3] };
    const withCursor = fakeSql([{ status: 'running' }]);
    await progress(withCursor.sql, { cursor });
    // Bound twice: once to test for it, once as the value.
    expect(jsonValues(updateOf(withCursor.statements))).toEqual([
      cursor,
      cursor,
    ]);

    const without = fakeSql([{ status: 'running' }]);
    await progress(without.sql);
    const update = updateOf(without.statements);
    expect(jsonValues(update)).toEqual([]);
    // The node key (twice), its checkpoint and the cursor (twice) bind as
    // SQL NULLs.
    expect(update.values.filter((value) => value === null)).toHaveLength(5);
  });

  it.each([
    ['stale', { status: 'running', claimEpoch: 2 }],
    ['cancelled', { status: 'cancelled', claimEpoch: 1 }],
    ['success', { status: 'success', claimEpoch: 1 }],
    ['missing', null],
  ] as const)(
    'answers %s when the fenced write matched nothing, and tells no view',
    async (expected, current) => {
      const fake = fakeSql([], current);
      await expect(
        progress(fake.sql, { nodeId: 'a', checkpoint: stored }),
      ).resolves.toEqual({ status: expected });
      const read = fake.statements.find((s) =>
        s.text.includes('FROM app.automation_runs'),
      );
      expect(read?.text).toContain('SELECT status, claim_epoch');
      expect(
        fake.statements.some((s) => s.text.includes('app_realtime.outbox')),
      ).toBe(false);
    },
  );
});

describe('the detail cap', () => {
  const detail = 'd'.repeat(70_000);

  it('suspendRun caps detail through the shared helper', async () => {
    const fake = fakeSql([{ seq: 1 }]);
    await suspendRun(fake.sql, {
      organizationId: 'org_1',
      runId: 'run_1',
      epoch: 1,
      detail,
      executions: 1,
      resumeInMs: 1000,
    });
    const written = updateOf(fake.statements).values[0];
    expect(typeof written).toBe('string');
    expect((written as string).length).toBe(MAX_RUN_DETAIL_CHARS);
    expect(written).toContain('[truncated from 70000 characters]');
  });

  it('finishRun caps detail and stores the assembled trace as given', async () => {
    const fake = fakeSql([
      {
        name: 'ops/list',
        version: 1,
        mode: 'mock',
        startedBy: 'user_1',
        startedAt: 1_000,
      },
    ]);
    const trace = [
      stored.trace,
      { node: 'fail', type: 'llm', status: 'error' },
    ];
    await finishRun(fake.sql, {
      organizationId: 'org_1',
      runId: 'run_1',
      epoch: 1,
      status: 'failed',
      trace,
      effects: [],
      detail,
      executions: 1,
    });
    const update = updateOf(fake.statements);
    const written = update.values.find(
      (value) => typeof value === 'string' && value.startsWith('ddd'),
    );
    expect((written as string).length).toBe(MAX_RUN_DETAIL_CHARS);
    // The trace was bounded when each entry first entered storage; the
    // parameter order is status, output, trace, effects, detail.
    expect(update.values[2]).toEqual({ json: trace });
  });
});
