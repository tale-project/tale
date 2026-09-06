import { afterEach, describe, expect, it } from 'vitest';

import { setEnqueueBoss } from '../../jobs/enqueue.ts';
import { recoverStuckDeferredSends } from './deferred-sends.ts';

/**
 * Unit lock for the deferred-send crash-recovery waker (job-liveness class):
 * a severed waiting row is re-polled with a per-send singletonKey (so a live
 * chain is never doubled) and a wedged claimed row is cleared. The stale-window
 * scan rides the real-Postgres probe in `integration-check.ts`.
 */

interface Statement {
  text: string;
  values: unknown[];
}

/** A scripted postgres.js tag: answers the statements in order and records
 * what each one asked, so a test can assert on the follow-up writes too. */
function scriptedSql(script: unknown[][]): {
  // oxlint-disable-next-line typescript/no-explicit-any -- test double for the postgres.js tag
  sql: any;
  statements: Statement[];
} {
  let i = 0;
  const statements: Statement[] = [];
  const nextRows = (): unknown[] =>
    i < script.length ? (script[i++] ?? []) : [];
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
    statements.push({ text: strings.join('?'), values });
    return Promise.resolve(nextRows());
  };
  return { sql, statements };
}

interface SentJob {
  name: string;
  data: Record<string, unknown>;
  options: { singletonKey?: string } | undefined;
}

afterEach(() => {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- reset the process-wide boss between tests
  setEnqueueBoss(null as never);
});

describe('recoverStuckDeferredSends', () => {
  it('re-polls severed waiting rows (singletonKey) and clears wedged claimed rows', async () => {
    const sent: SentJob[] = [];
    setEnqueueBoss({
      send: (
        name: string,
        data: Record<string, unknown>,
        options: { singletonKey?: string },
      ) => {
        sent.push({ name, data, options });
        return Promise.resolve('job-id');
      },
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only `send` is exercised
    } as never);
    const { sql, statements } = scriptedSql([
      // waiting rows the sever-recovery re-polls
      [{ id: 'wait_1' }, { id: 'wait_2' }],
      // claimed rows the wedge-recovery deletes
      [{ id: 'claim_1', organizationId: 'org_1', videoJobIds: ['job_1'] }],
      // the release of the cleared row's videos
      [],
    ]);

    const result = await recoverStuckDeferredSends(sql);

    expect(result).toEqual({ repolled: 2, cleared: 1 });
    // The wedged row's claimed videos go back to unbound (a job a persisted
    // user row carries is kept by the statement's own predicate) — bound to
    // a row that no longer exists they would stay hidden and unreapable.
    const release = statements.find((statement) =>
      statement.text.includes('message_bound_at_ms = NULL'),
    );
    expect(release?.values.slice(0, 2)).toEqual([['job_1'], 'org_1']);
    expect(sent).toHaveLength(2);
    expect(sent.every((job) => job.name === 'chat.deferred_send_poll')).toBe(
      true,
    );
    // The singletonKey is the send id — this is what dedups a live chain.
    expect(sent[0]?.data.deferredSendId).toBe('wait_1');
    expect(sent[0]?.options?.singletonKey).toBe('wait_1');
    expect(sent[1]?.options?.singletonKey).toBe('wait_2');
  });

  it('reports zero when nothing is stalled', async () => {
    const sent: SentJob[] = [];
    setEnqueueBoss({
      send: (name: string, data: Record<string, unknown>) => {
        sent.push({ name, data, options: undefined });
        return Promise.resolve('job-id');
      },
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only `send` is exercised
    } as never);
    const { sql } = scriptedSql([[], []]);

    const result = await recoverStuckDeferredSends(sql);

    expect(result).toEqual({ repolled: 0, cleared: 0 });
    expect(sent).toHaveLength(0);
  });
});
