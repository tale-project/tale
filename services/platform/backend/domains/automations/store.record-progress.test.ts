// @vitest-environment node

/**
 * Unit lock for the durable run lane's payload bound (run-log class): a
 * checkpoint's descriptive `trace` is bounded as it FIRST enters the row —
 * `recordProgress` bounds only the incoming entry, never the stored `nodes`
 * it merges into (the bound is not idempotent) — while `checkpoint.output`
 * (the executor's scope) and `effects` (the audit trail) are stored whole.
 * Regression: the helper ported from 0.4 had no caller here, so a forEach
 * over a large listing grew the row and every step's rewrite without a
 * ceiling. `detail` is capped through the same helper on both terminal and
 * parking doors.
 */

import type { PgBoss } from 'pg-boss';
import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  MAX_RUN_DETAIL_CHARS,
  MAX_TRACE_FIELD_CHARS,
} from '../../core/automations/bound_run_payload.ts';
import type { NodeCheckpoint } from '../../core/automations/checkpoints.ts';
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

/** Scripted transactional `sql`: the run read answers `row`, writes swallow. */
function fakeSql(row: Record<string, unknown>): {
  sql: Sql;
  statements: Statement[];
} {
  const statements: Statement[] = [];
  const fn = (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<unknown[]> => {
    const text = strings.join('?');
    statements.push({ text, values });
    return Promise.resolve(
      text.includes('FROM app.automation_runs') ? [row] : [],
    );
  };
  fn.unsafe = (text: string): { raw: string } => ({ raw: text });
  fn.json = (value: unknown): { json: unknown } => ({ json: value });
  fn.begin = (body: (tx: unknown) => Promise<unknown>): Promise<unknown> =>
    body(fn);
  return { sql: fn as unknown as Sql, statements };
}

const stored: NodeCheckpoint = {
  status: 'ok',
  output: { kept: 'k'.repeat(100_000) },
  trace: {
    node: 'earlier',
    type: 'connector',
    status: 'ok',
    // Already bounded once when it entered; must come back byte-identical.
    output: `${'k'.repeat(4096)}…(+95904 chars)`,
  },
  effects: [],
};

const runRow = (checkpoints: unknown) => ({
  id: 'run_1',
  organizationId: 'org_1',
  name: 'ops/list',
  version: 1,
  status: 'running',
  // A mock run: the live terminal audit row is another lock's concern.
  mode: 'mock',
  startedBy: 'user_1',
  checkpoints,
  claimEpoch: 1,
  chainSeq: 0,
});

function updateOf(statements: Statement[]): Statement {
  const update = statements.find((s) =>
    s.text.includes('UPDATE app.automation_runs'),
  );
  if (!update) throw new Error('no run update recorded');
  return update;
}

function jsonArg(statement: Statement, index: number): unknown {
  const value = statement.values[index];
  if (typeof value !== 'object' || value === null || !('json' in value)) {
    throw new Error(`value ${index} is not a json parameter`);
  }
  return (value as { json: unknown }).json;
}

describe('recordProgress', () => {
  it('bounds the incoming trace, stores output whole, leaves stored nodes alone', async () => {
    const big = 'x'.repeat(200_000);
    const fake = fakeSql(runRow({ nodes: { earlier: stored }, executions: 1 }));
    const result = await recordProgress(fake.sql, {
      organizationId: 'org_1',
      runId: 'run_1',
      epoch: 1,
      nodeId: 'list',
      checkpoint: {
        status: 'ok',
        output: { items: big },
        trace: { node: 'list', type: 'connector', status: 'ok', output: big },
        effects: [{ node: 'list', connector: 'imap-smtp', input: { big } }],
      } satisfies NodeCheckpoint,
      executions: 2,
    });

    expect(result).toEqual({ status: 'running' });
    const written = jsonArg(updateOf(fake.statements), 0) as {
      nodes: Record<string, NodeCheckpoint>;
      executions: number;
    };
    const list = written.nodes.list;
    expect(list).toBeDefined();
    // The executor's scope and the audit trail are untouched…
    expect(list?.output).toEqual({ items: big });
    expect(list?.effects).toEqual([
      { node: 'list', connector: 'imap-smtp', input: { big } },
    ]);
    // …the descriptive trace is bounded.
    expect(JSON.stringify(list?.trace.output).length).toBeLessThan(
      MAX_TRACE_FIELD_CHARS,
    );
    expect(list?.trace.output).toContain('(+195904 chars)');
    // The already-stored node is merged back byte-identical: bounding it a
    // second time would re-cut its marker and misreport the loss.
    expect(written.nodes.earlier).toEqual(stored);
    expect(written.executions).toBe(2);
  });

  it('stores an unrecognizable checkpoint as it came', async () => {
    const fake = fakeSql(runRow({ nodes: {}, executions: 0 }));
    await recordProgress(fake.sql, {
      organizationId: 'org_1',
      runId: 'run_1',
      epoch: 1,
      nodeId: 'odd',
      checkpoint: 'not a checkpoint',
      executions: 1,
    });
    const written = jsonArg(updateOf(fake.statements), 0) as {
      nodes: Record<string, unknown>;
    };
    expect(written.nodes.odd).toBe('not a checkpoint');
  });
});

describe('the detail cap', () => {
  const detail = 'd'.repeat(70_000);

  it('suspendRun caps detail through the shared helper', async () => {
    const fake = fakeSql(runRow({ nodes: {}, executions: 0 }));
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
    const fake = fakeSql(runRow({ nodes: { earlier: stored }, executions: 1 }));
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
    // parameter order is status, output, trace, effects, detail, checkpoints.
    expect(jsonArg(update, 2)).toEqual(trace);
  });
});
