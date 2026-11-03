// @vitest-environment node

/**
 * Unit lock for a mock run's own state in its run row (AUTO-R81): what its
 * connector mocks wrote is committed with the outcome of the step that wrote
 * it. The walker's progress and parking writes replace the stored state when
 * a step changed it and keep it otherwise, in the one fenced statement that
 * commits the step, and both terminal doors drop it, since it ends with the
 * run. This pins the statements' shape.
 */

import type { PgBoss } from 'pg-boss';
import type { Sql, TransactionSql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { setEnqueueBoss } from '../../jobs/enqueue.ts';
import {
  cancelRunInTx,
  finishRun,
  recordProgress,
  suspendRun,
} from './store.ts';

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

/** Scripted transactional `sql`: the fenced run write answers `written`. */
function fakeSql(written: Record<string, unknown>[]): {
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
    if (text.includes('UPDATE app.automation_runs')) {
      return Promise.resolve(written);
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

function runUpdate(statements: Statement[]): Statement {
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

const mockState = {
  task: {
    state: { next: 43, tasks: [{ id: 'tsk_mock_42', title: 'Call back' }] },
    answers: { 'run_1:create:0:0': { id: 'tsk_mock_42' } },
  },
};

const keepsOrReplaces = "jsonb_build_object('mockState', ?::jsonb) END)";

describe('a mock run’s own state in its run row [AUTO-R81]', () => {
  it('commits the state a step changed with the step’s progress', async () => {
    const fake = fakeSql([{ status: 'running' }]);
    await recordProgress(fake.sql, {
      organizationId: 'org_1',
      runId: 'run_1',
      epoch: 1,
      executions: 2,
      mockState,
    });
    const update = runUpdate(fake.statements);
    // One fenced statement carries the step and the state together.
    expect(update.text).toContain('AND claim_epoch = ?');
    expect(update.text).toContain(keepsOrReplaces);
    // Bound twice: once to test for it, once as the value.
    expect(jsonValues(update)).toEqual([mockState, mockState]);
  });

  it('keeps the stored state when no step changed it', async () => {
    const fake = fakeSql([{ status: 'running' }]);
    await recordProgress(fake.sql, {
      organizationId: 'org_1',
      runId: 'run_1',
      epoch: 1,
      executions: 2,
    });
    const update = runUpdate(fake.statements);
    expect(jsonValues(update)).toEqual([]);
    // Only the cursor leaves the stored checkpoints: the state stays.
    expect(update.text).toContain("checkpoints - 'cursor'");
    expect(update.text).not.toContain("- 'mockState'");
  });

  it('commits the state a step changed with the park, and keeps it otherwise', async () => {
    const park = {
      organizationId: 'org_1',
      runId: 'run_1',
      epoch: 1,
      detail: 'repeat:poll',
      executions: 3,
      resumeInMs: 1000,
    };
    const changed = fakeSql([{ seq: 1 }]);
    await suspendRun(changed.sql, { ...park, mockState });
    const update = runUpdate(changed.statements);
    expect(update.text).toContain(keepsOrReplaces);
    expect(jsonValues(update)).toEqual([mockState, mockState]);

    const unchanged = fakeSql([{ seq: 1 }]);
    await suspendRun(unchanged.sql, park);
    const kept = runUpdate(unchanged.statements);
    expect(jsonValues(kept)).toEqual([]);
    expect(kept.text).not.toContain("- 'mockState'");
  });

  it('is dropped when the run finishes: only its steps stay', async () => {
    const fake = fakeSql([
      {
        name: 'ops/tasks',
        version: 1,
        mode: 'mock',
        startedBy: 'user_1',
        startedAt: 1_000,
      },
    ]);
    await finishRun(fake.sql, {
      organizationId: 'org_1',
      runId: 'run_1',
      epoch: 1,
      status: 'success',
      trace: [],
      effects: [],
      executions: 2,
    });
    const update = runUpdate(fake.statements);
    expect(update.text).toMatch(
      /checkpoints = jsonb_build_object\(\s*'nodes',[\s\S]*'executions', \?::int\),/,
    );
    expect(update.text).not.toContain('mockState');
  });

  it('is dropped when the run is cancelled: only its steps stay', async () => {
    const fake = fakeSql([
      { name: 'ops/tasks', version: 1, mode: 'mock', startedBy: 'user_1' },
    ]);
    const result = await cancelRunInTx(
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the scripted sql answers a transaction's calls too
      fake.sql as unknown as TransactionSql,
      'org_1',
      'run_1',
    );
    expect(result).toEqual({ cancelled: true, status: 'cancelled' });
    const update = runUpdate(fake.statements);
    expect(update.text).toContain("THEN checkpoints - 'mockState'");
  });
});
