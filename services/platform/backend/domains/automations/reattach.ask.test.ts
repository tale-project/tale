import type { PgBoss } from 'pg-boss';
import type { Sql } from 'postgres';
import { afterEach, describe, expect, it } from 'vitest';

import { setEnqueueBoss } from '../../jobs/enqueue.ts';
import { recoverAnsweredAskResumes } from './reattach.ts';

/**
 * Unit lock for the answered-ask resume waker (job-liveness class): a run
 * still parked on the asking exec whose ask is already answered has a lost
 * `automation.ask_resume`; the waker re-enqueues it. The precise scan (cursor
 * still on the asking exec, no result, ask answered past the staleness gate)
 * lives in the real-Postgres probe; this locks the re-enqueue payload.
 */

function scriptedSql(script: unknown[][]): Sql {
  let i = 0;
  const nextRows = (): unknown[] =>
    i < script.length ? (script[i++] ?? []) : [];
  const fn = (): Promise<unknown[]> => Promise.resolve(nextRows());
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

describe('recoverAnsweredAskResumes', () => {
  it('re-enqueues ask_resume for an answered ask still parked on the asking exec', async () => {
    const sent: SentJob[] = [];
    fakeBoss(sent);
    const sql = scriptedSql([[{ organizationId: 'org_1', askId: 'ask_1' }]]);

    const result = await recoverAnsweredAskResumes(sql);

    expect(result).toEqual({ examined: 1, requeued: 1 });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.name).toBe('automation.ask_resume');
    expect(sent[0]?.data).toEqual({ organizationId: 'org_1', askId: 'ask_1' });
  });

  it('does nothing when no answered ask is still parked', async () => {
    const sent: SentJob[] = [];
    fakeBoss(sent);
    const sql = scriptedSql([[]]);

    const result = await recoverAnsweredAskResumes(sql);

    expect(result).toEqual({ examined: 0, requeued: 0 });
    expect(sent).toHaveLength(0);
  });
});
