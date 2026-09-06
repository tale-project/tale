// @vitest-environment node

import type { PgBoss } from 'pg-boss';
import type { Sql } from 'postgres';
import { afterEach, describe, expect, it } from 'vitest';

import { SANDBOX_AGENT_OP_KINDS } from '../../core/sandbox/session_constants.ts';
import { setEnqueueBoss } from '../../jobs/enqueue.ts';
import { recoverStalledTaskAgentTurns } from './reattach.ts';

/**
 * Unit lock for the running-turn sweep's listing predicate: a run with NO op
 * row is only "a start that died before writing one" once its run row has
 * been quiet past the staleness window. A restart-steer rotates the exec
 * (bumping `updated_at_ms`) and writes the new exec's op row only after
 * re-staging — in that gap the run is alive, and claiming it would enqueue a
 * second drive chain on an exec nobody has spawned yet. The real-Postgres
 * proof (a just-rotated op-less run is left alone, a stale one resumes) rides
 * `integration-check.ts`.
 */

function recordingSql(): { sql: Sql; statements: string[] } {
  const statements: string[] = [];
  const tag = (
    strings: TemplateStringsArray,
    ..._values: unknown[]
  ): Promise<unknown[]> => {
    statements.push(strings.join('?').replaceAll(/\s+/g, ' ').trim());
    return Promise.resolve([]);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a one-member stand-in for the postgres.js template function
  return { sql: tag as unknown as Sql, statements };
}

describe('recoverStalledTaskAgentTurns — the op-less arm ages on the run row', () => {
  it('requires the run row itself to be stale before an op-less run counts as abandoned', async () => {
    const { sql, statements } = recordingSql();
    const result = await recoverStalledTaskAgentTurns(sql, {
      probe: () => Promise.resolve({ state: 'running' as const }),
    });
    expect(result).toEqual({ examined: 0, resumed: 0 });
    const listing = statements.find((text) =>
      text.startsWith('SELECT r.id AS "runId"'),
    );
    expect(listing).toBeDefined();
    expect(listing).toContain("r.status = 'running'");
    // The two arms: an op-less run must ALSO be quiet on its run row; a run
    // with an op row is judged on the op's lease alone — and ONLY a run with
    // an op row: over a missing op every mark is NULL and greatest() folds
    // the coalesced zeros to 0, which reads as stale for every op-less run
    // and would swallow the age rule of the first arm.
    expect(listing).toContain('(op.id IS NULL AND r.updated_at_ms < ?)');
    expect(listing).toContain(
      'OR ( op.id IS NOT NULL AND greatest( op.started_at_ms,',
    );
    expect(listing).not.toMatch(/OR greatest\(/);
  });
});

/**
 * Unit lock for the stalled-turn re-attach's "missing op row" heal: the row
 * the sweep CREATES must carry the task lane's own op kind (`task-agent`).
 * The drive's upsert never rewrites `kind`, and the run-card read
 * (`getAgentRunSandboxOp`) and the metric folds are keyed on it — a row
 * filed under the 0.4 `agent-run` stayed invisible for the rest of the
 * recovered turn. The real-Postgres proof (row + run-card read) rides
 * `integration-check.ts`.
 */


interface Statement {
  text: string;
  values: unknown[];
}

/** A scripted `sql`: each tagged call answers the next scripted row set and
 * records its text + bound values; `begin` runs the callback on the same
 * recorder so the claim's transaction is visible too. */
function scriptedSql(script: unknown[][], statements: Statement[]): Sql {
  let i = 0;
  const fn = (strings: TemplateStringsArray, ...values: unknown[]) => {
    statements.push({ text: strings.join('?'), values });
    return Promise.resolve(i < script.length ? (script[i++] ?? []) : []);
  };
  Object.assign(fn, {
    begin: (cb: (tx: unknown) => unknown): unknown => cb(fn),
    json: (v: unknown): unknown => v,
    unsafe: (): Promise<unknown[]> => Promise.resolve([]),
  });
  return fn as unknown as Sql;
}

function fakeBoss(sent: { name: string; data: unknown }[]): void {
  const boss = {
    send: (name: string, data: unknown): Promise<string> => {
      sent.push({ name, data });
      return Promise.resolve('job-id');
    },
  };
  setEnqueueBoss(boss as unknown as PgBoss);
}

afterEach(() => {
  setEnqueueBoss(null as unknown as PgBoss);
});

describe('recoverStalledTaskAgentTurns — the missing-op-row heal', () => {
  it('creates the op row under the task lane kind the run-card read is keyed on', async () => {
    const sent: { name: string; data: unknown }[] = [];
    fakeBoss(sent);
    const statements: Statement[] = [];
    const sql = scriptedSql(
      [
        // 1: the stalled listing — one run whose start died before its op row
        [
          {
            runId: 'run_1',
            organizationId: 'org_1',
            taskId: 'task_1',
            agentId: 'agent_1',
            execId: 'exec_1',
            sessionId: 'pa-agent_1',
            harness: 'claude-code',
            deadlineAt: Date.now() + 3_600_000,
          },
        ],
        // 2: the claim's FOR UPDATE read — no row
        [],
        // 3: the INSERT (the insert IS the claim)
        [],
      ],
      statements,
    );

    const result = await recoverStalledTaskAgentTurns(sql, {
      probe: () => Promise.resolve({ state: 'running' as const }),
    });

    expect(result).toEqual({ examined: 1, resumed: 1 });
    const insert = statements.find((statement) =>
      statement.text.includes('INSERT INTO app.sandbox_session_ops'),
    );
    expect(insert).toBeDefined();
    expect(insert?.values).toContain('task-agent');
    expect(insert?.values).not.toContain('agent-run');
    // The vocabulary the metric folds and run-card read accept.
    expect(SANDBOX_AGENT_OP_KINDS).toContain('task-agent');
    expect(sent.map((job) => job.name)).toEqual(['task.agent_drive']);
  });
});
