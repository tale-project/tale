import type { PgBoss } from 'pg-boss';
import type { Sql } from 'postgres';
import { afterEach, describe, expect, it } from 'vitest';

import { setEnqueueBoss } from '../../jobs/enqueue.ts';
import { recoverStuckQueuedTaskAgentRuns } from './reattach.ts';

/**
 * Unit lock for the queued-run waker (job-liveness class): a run stranded at
 * `queued` because its start job was lost must be re-kicked under a ROTATED
 * exec id (single-winner claim), never left for the 12-hour deadline.
 *
 * A scripted `sql` returns each query's rows in call order; a fake boss
 * captures the re-enqueue without a real queue. The real-Postgres proof (both
 * branches, the agent-gone fail, the stale gate) rides `integration-check.ts`.
 */

function scriptedSql(script: unknown[][]): Sql {
  let i = 0;
  const nextRows = (): unknown[] =>
    i < script.length ? (script[i++] ?? []) : [];
  const tag = (): Promise<unknown[]> => Promise.resolve(nextRows());
  const fn = (): Promise<unknown[]> => tag();
  Object.assign(fn, {
    begin: (cb: (tx: unknown) => unknown): unknown => cb(fn),
    json: (v: unknown): unknown => v,
    unsafe: (): Promise<unknown[]> => tag(),
  });
  return fn as unknown as Sql;
}

interface SentJob {
  name: string;
  data: Record<string, unknown>;
}

function fakeBoss(sent: SentJob[]): void {
  const boss = {
    send: (name: string, data: Record<string, unknown>): Promise<string> => {
      sent.push({ name, data });
      return Promise.resolve('job-id');
    },
  };
  setEnqueueBoss(boss as unknown as PgBoss);
}

afterEach(() => {
  setEnqueueBoss(null as unknown as PgBoss);
});

describe('recoverStuckQueuedTaskAgentRuns', () => {
  it('re-kicks a stranded queued run under a rotated exec id', async () => {
    const sent: SentJob[] = [];
    fakeBoss(sent);
    const sql = scriptedSql([
      // 1: the stale-queued listing
      [
        {
          runId: 'run_1',
          organizationId: 'org_1',
          execId: 'exec_old',
          agentPresent: true,
        },
      ],
      // 2: the single-winner CAS claim wins
      [{ id: 'run_1' }],
    ]);

    const result = await recoverStuckQueuedTaskAgentRuns(sql);

    expect(result).toEqual({ examined: 1, requeued: 1, failed: 0 });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.name).toBe('task.agent_turn');
    expect(sent[0]?.data.runId).toBe('run_1');
    expect(sent[0]?.data.organizationId).toBe('org_1');
    // The exec id is rotated so a lost-but-slow original start orphans itself.
    expect(sent[0]?.data.execId).not.toBe('exec_old');
    expect(typeof sent[0]?.data.execId).toBe('string');
  });

  it('does not re-kick when the claim is lost to a concurrent winner', async () => {
    const sent: SentJob[] = [];
    fakeBoss(sent);
    const sql = scriptedSql([
      [
        {
          runId: 'run_2',
          organizationId: 'org_1',
          execId: 'exec_old',
          agentPresent: true,
        },
      ],
      // The CAS returns no row — a live start or another sweep already claimed.
      [],
    ]);

    const result = await recoverStuckQueuedTaskAgentRuns(sql);

    expect(result).toEqual({ examined: 1, requeued: 0, failed: 0 });
    expect(sent).toHaveLength(0);
  });
});
